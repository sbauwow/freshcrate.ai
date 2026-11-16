import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { hfFetchWithStatus, HUB_ORIGIN } from "@/lib/hub-fetch";
import { buildModelTorrent, type TorrentFileInput } from "@/lib/build-model-torrent";
import { isTorrentable, TORRENTABLE_LICENSES } from "@/lib/model-torrent-policy";

/**
 * Batch torrent builder for the allowlisted HF model catalog (plan Task 10).
 *
 * Selects the top-N (downloads DESC) torrentable models that have no
 * model_torrents row yet, then per model:
 *   (a) detail fetch  GET /api/models/{repo_id} — REJECT if `gated` is
 *       truthy (the LIST api carries no reliable gated field, so this is
 *       the belt+braces check against stale list data);
 *   (b) file tree     GET /api/models/{repo_id}/tree/main?recursive=true —
 *       keep weight/blob files only (.safetensors/.bin/.gguf/.ckpt/.onnx/
 *       .pth), dedupe paths, sum declared sizes; skip when the total
 *       exceeds the cap or there are no weight files;
 *   (c) content       GET https://huggingface.co/{repo_id}/resolve/main/
 *       {encoded path} with the token + Accept: application/x-binary,
 *       streaming response.body straight into buildModelTorrent — which
 *       aborts the WHOLE model on any declared-size mismatch (upstream
 *       changed mid-build), while the job itself continues with the next
 *       model;
 *   (d) upsert model_torrents + write models.size_mb.
 *
 * MEMORY/BOUND: piece hashing is O(1) over the streamed bytes (see
 * lib/build-model-torrent.ts) but a build can stream GBs and take minutes,
 * so the caller must not hold an HTTP request open for it: the cron route
 * runs this fire-and-forget (a detached loop whose rejection is caught and
 * logged so it can never crash the container) and answers {queued: N}
 * immediately. ?sync=1 opts into a blocking run for small dev batches, and
 * ?dry=1 always runs inline because its whole point is the would-build
 * list in the response. budgetMs bounds a run either way, and each model's
 * build is additionally raced against min(perModelTimeoutMs, remaining
 * budget) so one stalled weight stream cannot wedge the whole loop.
 *
 * This job never touches the local filesystem; local SQLite use is dev-only
 * (scripts/build-model-torrents.mjs). Prod data path is the Railway endpoint.
 */

export const BUILD_TOOL_VERSION = "lib/build-model-torrent";

/** Weight/blob file extensions worth torrenting (everything else is metadata). */
const WEIGHT_EXTENSIONS = [".safetensors", ".bin", ".gguf", ".ckpt", ".onnx", ".pth"];

const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_MODEL_MB = 20000;
const DEFAULT_BUDGET_MS = 240000;
/** Hard cap on one model's build; min()'d with the remaining run budget. */
const DEFAULT_PER_MODEL_TIMEOUT_MS = 600000;

export interface TorrentCandidate {
  id: number;
  repo_id: string;
  author: string;
  model_name: string;
  license: string;
  gated: number;
  downloads: number;
  size_mb: number | null;
}

export interface TorrentBuildSkip {
  repo_id: string;
  reason: string;
}

export interface TorrentWouldBuild {
  repo_id: string;
  file_count: number;
  total_bytes: number;
}

export interface BuildTorrentsResult {
  /** Candidates considered this run (selected rows, before per-model checks). */
  selected: number;
  /** Torrents actually built + upserted (0 in dry runs). */
  built: number;
  /** Dry runs only: candidates that passed every check and would be built. */
  wouldBuild: TorrentWouldBuild[];
  skipped: TorrentBuildSkip[];
  /** `${repo_id}: message` for unexpected per-model failures (job continues). */
  errors: string[];
  budgetExhausted: boolean;
  dryRun: boolean;
}

export interface BuildTorrentsOptions {
  /** Max models to process per run. Default 10. */
  limit?: number;
  /** Skip models whose weights total more than this many MB. Default 20000. */
  maxModelMb?: number;
  /** Stop starting new models once this many ms have elapsed. Default 240000. */
  budgetMs?: number;
  /**
   * Hard deadline for ONE model's build (stalled-stream guard): the build is
   * raced against min(perModelTimeoutMs, remaining budget) and a timeout is
   * recorded as that model's error so the loop moves on. Default 600000.
   */
  perModelTimeoutMs?: number;
  /** Optional Hugging Face token sent as a Bearer header. */
  token?: string;
  /** Select + policy-check only; no content downloads, no DB writes. */
  dryRun?: boolean;
  /** Preselected candidates (the fire-and-forget route pins these). */
  candidates?: TorrentCandidate[];
  /** Progress snapshot after each model settles. */
  onProgress?: (progress: BuildTorrentsResult) => void;
  /** Injectable clock for tests (default Date.now). */
  now?: () => number;
}

/** Detail endpoint payload — only the fields the job decides on. */
interface HfModelDetail {
  gated?: boolean | string;
  id?: string;
}

/** Recursive tree entry: flat list, `size` is the true content size even for
 * LFS-backed files (verified against the live Hub: size === lfs.size). */
interface HfTreeEntry {
  type?: string;
  path: string;
  size?: number;
  lfs?: { size?: number };
}

/**
 * Cheap synchronous pre-selection for the route: allowlisted license,
 * not gated, no model_torrents row yet, size under the cap (NULL = unknown,
 * still a candidate — the tree check decides), newest-downloads first.
 * selectTorrentCandidates re-runs isTorrentable in TS so the policy lib
 * stays authoritative over the SQL pre-filter.
 */
export function selectTorrentCandidates(
  db?: Database.Database,
  opts: { limit?: number; maxModelMb?: number } = {}
): TorrentCandidate[] {
  const database = db ?? getDb();
  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
  const maxModelMb = Math.max(1, opts.maxModelMb ?? DEFAULT_MAX_MODEL_MB);
  const licenses = [...TORRENTABLE_LICENSES];
  const placeholders = licenses.map(() => "?").join(", ");

  const rows = database
    .prepare(
      `SELECT m.id, m.repo_id, m.author, m.model_name, m.license, m.gated, m.downloads, m.size_mb
       FROM models m
       LEFT JOIN model_torrents t ON t.model_id = m.id
       WHERE t.model_id IS NULL
         AND m.gated = 0
         AND m.license IN (${placeholders})
         AND (m.size_mb IS NULL OR m.size_mb <= ?)
       ORDER BY m.downloads DESC, m.repo_id ASC
       LIMIT ?`
    )
    .all(...licenses, maxModelMb, limit) as TorrentCandidate[];

  // Belt+braces: the SQL is a pre-filter; the policy lib decides.
  return rows.filter((row) => isTorrentable({ license: row.license, gated: row.gated }).ok);
}

function weightUrl(repoId: string, filePath: string): string {
  return (
    `${HUB_ORIGIN}/${repoId}/resolve/main/` +
    filePath.split("/").map(encodeURIComponent).join("/")
  );
}

/**
 * Per-file content streamer: GETs the resolve URL and hands the raw
 * response.body to buildModelTorrent. The stream is consumed exactly once
 * per call (a fresh fetch per call keeps builds retryable). Non-200 (e.g.
 * a gated file's 403) aborts this model's build with the status recorded.
 * `signal` is the per-model deadline AbortSignal: if the model build times
 * out, an in-flight weight stream is torn down instead of holding the
 * socket until undici's default idle timeout.
 */
function makeContentSource(
  repoId: string,
  filePath: string,
  token?: string,
  signal?: AbortSignal
): TorrentFileInput["content"] {
  return async () => {
    const headers: Record<string, string> = { Accept: "application/x-binary" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(weightUrl(repoId, filePath), { headers, cache: "no-store", signal });
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`weight fetch failed for "${filePath}" (HTTP ${res.status})`);
    }
    // The stream must yield exactly the tree-declared size; lib/build-model-torrent
    // enforces that and aborts the model otherwise.
    return res.body as ReadableStream<Uint8Array>;
  };
}

/**
 * Run the batch: see module doc. Pass `candidates` to skip re-selection
 * (the fire-and-forget route path). Budget is checked between models, so
 * one over-budget model still completes — partial results, like
 * lib/refresh-models.
 */
export async function buildTorrentsForModels(
  db?: Database.Database,
  opts: BuildTorrentsOptions = {}
): Promise<BuildTorrentsResult> {
  const database = db ?? getDb();
  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
  const maxModelMb = Math.max(1, opts.maxModelMb ?? DEFAULT_MAX_MODEL_MB);
  const maxModelBytes = maxModelMb * 1024 * 1024;
  const budgetMs = Math.max(0, opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const dryRun = opts.dryRun ?? false;
  const now = opts.now ?? Date.now;
  const start = now();

  const candidates = opts.candidates
    ? opts.candidates.slice(0, limit)
    : selectTorrentCandidates(database, { limit, maxModelMb });

  const result: BuildTorrentsResult = {
    selected: candidates.length,
    built: 0,
    wouldBuild: [],
    skipped: [],
    errors: [],
    budgetExhausted: false,
    dryRun,
  };
  const report = () => opts.onProgress?.({ ...result, skipped: [...result.skipped], errors: [...result.errors] });

  const failureMsg = (status: number) => (status === 0 ? "network error" : `HTTP ${status}`);

  const upsertStmt = database.prepare(`
    INSERT INTO model_torrents (
      model_id, info_hash, display_name, total_bytes, file_count, metainfo, magnet, build_tool_version
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(model_id) DO UPDATE SET
      info_hash = excluded.info_hash,
      display_name = excluded.display_name,
      total_bytes = excluded.total_bytes,
      file_count = excluded.file_count,
      metainfo = excluded.metainfo,
      magnet = excluded.magnet,
      build_tool_version = excluded.build_tool_version
  `);
  const writeSizeStmt = database.prepare(
    `UPDATE models SET size_mb = ?, updated_at = datetime('now') WHERE id = ?`
  );
  const persist = database.transaction(
    (modelId: number, built: { infoHash: string; displayName: string; totalBytes: number; fileCount: number; metainfo: Buffer; magnet: string }) => {
      upsertStmt.run(
        modelId,
        built.infoHash,
        built.displayName,
        built.totalBytes,
        built.fileCount,
        built.metainfo,
        built.magnet,
        BUILD_TOOL_VERSION
      );
      writeSizeStmt.run(Math.round(built.totalBytes / (1024 * 1024)), modelId);
    }
  );

  for (const candidate of candidates) {
    const elapsedMs = now() - start;
    if (elapsedMs >= budgetMs) {
      result.budgetExhausted = true;
      report();
      break;
    }
    const { repo_id } = candidate;

    // Policy re-check (a preselected candidate could have aged past policy).
    const policy = isTorrentable({ license: candidate.license, gated: candidate.gated });
    if (!policy.ok) {
      result.skipped.push({ repo_id, reason: policy.reason ?? "not torrentable" });
      report();
      continue;
    }

    // (a) Detail endpoint: the LIST api has no gated field, so confirm here.
    const detail = await hfFetchWithStatus<HfModelDetail>(`/api/models/${repo_id}`, opts.token);
    if (!detail.data) {
      result.skipped.push({
        repo_id,
        reason: `detail fetch failed (${failureMsg(detail.status)}) — retried next run`,
      });
      report();
      continue;
    }
    if (detail.data.gated) {
      result.skipped.push({
        repo_id,
        reason: "gated model (per detail endpoint) — never torrentable",
      });
      report();
      continue;
    }

    // (b) File tree: weight/blob files only, deduped, declared sizes summed.
    const tree = await hfFetchWithStatus<HfTreeEntry[]>(
      `/api/models/${repo_id}/tree/main?recursive=true`,
      opts.token
    );
    if (!tree.data) {
      result.skipped.push({
        repo_id,
        reason: `file tree fetch failed (${failureMsg(tree.status)}) — retried next run`,
      });
      report();
      continue;
    }
    const seen = new Set<string>();
    const weightFiles: { path: string; size: number }[] = [];
    let totalBytes = 0;
    for (const entry of tree.data) {
      if (!entry || entry.type !== "file" || !entry.path) continue;
      if (seen.has(entry.path)) continue;
      const lower = entry.path.toLowerCase();
      if (!WEIGHT_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue;
      seen.add(entry.path);
      const declared =
        typeof entry.size === "number"
          ? entry.size
          : typeof entry.lfs?.size === "number"
            ? entry.lfs.size
            : 0;
      weightFiles.push({ path: entry.path, size: declared });
      totalBytes += declared;
    }
    if (weightFiles.length === 0) {
      result.skipped.push({ repo_id, reason: "no weight files (.safetensors/.bin/.gguf/.ckpt/.onnx/.pth) in repo" });
      report();
      continue;
    }
    if (totalBytes > maxModelBytes) {
      result.skipped.push({
        repo_id,
        reason: `weights total ${Math.ceil(totalBytes / (1024 * 1024))} MB exceeds cap ${maxModelMb} MB`,
      });
      report();
      continue;
    }

    if (dryRun) {
      // No downloads, no hashing, no writes — just the would-build plan.
      result.wouldBuild.push({ repo_id, file_count: weightFiles.length, total_bytes: totalBytes });
      report();
      continue;
    }

    // (c)+(d) Stream the weights through the metainfo builder and persist.
    // The budget is only checked BETWEEN models, so a stalled weight stream
    // (silent TCP stall, hung CDN response) must not wedge the loop until
    // undici's default idle timeout: race each build against a per-model
    // deadline of min(perModelTimeoutMs, remaining budget) measured from the
    // loop's budget check. The weight fetches carry the same deadline as an
    // AbortSignal so the dead socket is torn down when it fires.
    const timeoutMs = Math.min(
      Math.max(1, opts.perModelTimeoutMs ?? DEFAULT_PER_MODEL_TIMEOUT_MS),
      Math.max(1, budgetMs - elapsedMs)
    );
    const signal = AbortSignal.timeout(timeoutMs);
    const files: TorrentFileInput[] = weightFiles.map((file) => ({
      path: file.path,
      size: file.size,
      url: weightUrl(repo_id, file.path),
      content: makeContentSource(repo_id, file.path, opts.token, signal),
    }));
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const built = await Promise.race([
        buildModelTorrent({
          repoId: repo_id,
          displayName: candidate.model_name || repo_id,
          files,
          comment: `freshcrate.ai model torrent for ${repo_id} (web seeds: huggingface.co)`,
        }),
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(
            () => reject(new Error(`build timed out after ${timeoutMs}ms (stalled weight stream?)`)),
            timeoutMs
          );
        }),
      ]);
      const displayName = candidate.model_name || repo_id;
      persist(candidate.id, {
        infoHash: built.infoHash,
        displayName,
        totalBytes: built.totalBytes,
        fileCount: built.fileCount,
        metainfo: built.metainfo,
        magnet: built.magnet,
      });
      result.built += 1;
    } catch (err) {
      result.errors.push(`${repo_id}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
    report();
  }

  return result;
}

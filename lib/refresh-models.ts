import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { hfFetchWithStatus, HUB_ORIGIN } from "@/lib/hub-fetch";

export interface RefreshOptions {
  /** Number of 1000-entry downloads pages to pull (offset 0, 1000, ...). Default 3. */
  pages?: number;
  /** Optional Hugging Face token sent as a Bearer header. */
  token?: string;
  /** Skip DB writes (the endpoint's ?dry=1); pages are still fetched and counted. */
  dryRun?: boolean;
  /** Stop starting new pages once this many ms have elapsed. Default: no budget. */
  budgetMs?: number;
  /** Injectable sleep for tests (default real timer). */
  sleep?: (ms: number) => Promise<void>;
  /** Progress snapshot ({fetched, upserted, errors}) after each page settles. */
  onProgress?: (progress: RefreshResult) => void;
}

export interface RefreshResult {
  /** Total entries seen across all pages (trending overlap included). */
  fetched: number;
  /** Distinct repo_ids touched (a repo on two pages counts once). */
  upserted: number;
  errors: string[];
  /** True when the time budget ran out before every selected page was processed. */
  budgetExhausted: boolean;
}

interface HfModel {
  id: string;
  pipeline_tag?: string;
  tags?: string[];
  downloads?: number;
  likes?: number;
  trendingScore?: number;
  gated?: boolean | string;
  lastModified?: string;
}

const PAGE_SIZE = 1000;
const TRENDING_LIMIT = 200;
const RATE_LIMIT_SLEEP_MS = 60000;
const RATE_LIMIT_MAX_RETRIES = 2;
const DEFAULT_SLEEP = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function licenseFromTags(tags: string[] | undefined): string {
  const tag = (tags || []).find((t) => t.startsWith("license:"));
  return tag ? tag.slice("license:".length) : "unknown";
}

function splitRepoId(id: string): { author: string; model_name: string } {
  const slash = id.indexOf("/");
  if (slash === -1) return { author: "", model_name: id };
  return { author: id.slice(0, slash), model_name: id.slice(slash + 1) };
}

/**
 * Daily upsert of the Hugging Face models catalog: the top-N downloads pages
 * plus one trending page for freshness. Upserts never touch short_desc
 * (the HF list API has no description) or created_at; updated_at is set
 * explicitly on both insert and update.
 *
 * Mirrors refreshReleases' contract: the caller passes the DB explicitly
 * (the cron route passes getDb(); tests pass an in-memory DB) — omitted,
 * it falls back to the app singleton. budgetMs mirrors refresh-releases:
 * the check runs between work items so the endpoint returns a partial
 * result before its maxDuration, instead of being killed mid-request.
 */
export async function refreshModels(
  db?: Database.Database,
  opts: RefreshOptions = {}
): Promise<RefreshResult> {
  const database = db ?? getDb();
  const pages = Math.max(1, opts.pages ?? 3);
  const dryRun = opts.dryRun ?? false;
  const budgetMs = opts.budgetMs ?? Infinity;
  const start = Date.now();
  const outOfBudget = () => Date.now() - start >= budgetMs;
  const sleep = opts.sleep ?? DEFAULT_SLEEP;
  const errors: string[] = [];
  let fetched = 0;
  let budgetExhausted = false;
  const upsertedIds = new Set<string>();

  const upsertStmt = database.prepare(`
    INSERT INTO models (
      repo_id, author, model_name, pipeline_tag, license,
      downloads, likes, trending_score, gated, last_modified, hf_url, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(repo_id) DO UPDATE SET
      downloads = excluded.downloads,
      likes = excluded.likes,
      trending_score = excluded.trending_score,
      gated = excluded.gated,
      pipeline_tag = excluded.pipeline_tag,
      license = excluded.license,
      last_modified = excluded.last_modified,
      updated_at = datetime('now')
  `);

  // In dry-run the ids are still counted (what WOULD be upserted) but no
  // rows are written — the endpoint's ?dry=1 is a read-only rehearsal.
  const upsertPage = database.transaction((entries: HfModel[]) => {
    for (const m of entries) {
      const { author, model_name } = splitRepoId(m.id);
      if (!dryRun) {
        upsertStmt.run(
          m.id,
          author,
          model_name,
          m.pipeline_tag ?? "",
          licenseFromTags(m.tags),
          m.downloads ?? 0,
          m.likes ?? 0,
          m.trendingScore ?? 0,
          m.gated ? 1 : 0,
          m.lastModified ?? "",
          `${HUB_ORIGIN}/${m.id}`
        );
      }
      upsertedIds.add(m.id);
    }
  });

  const fetchPage = async (
    endpoint: string
  ): Promise<{ status: number; data: HfModel[] | null }> => {
    for (let attempt = 0; ; attempt++) {
      const res = await hfFetchWithStatus<HfModel[]>(endpoint, opts.token);
      if (res.data) return { status: res.status, data: res.data };
      if (res.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
        if (outOfBudget()) {
          // Out of budget: surface the 429 as a page error rather than
          // burning another 60s sleep inside the response window.
          return { status: res.status, data: null };
        }
        await sleep(RATE_LIMIT_SLEEP_MS);
        continue;
      }
      return { status: res.status, data: null };
    }
  };

  const failureMsg = (status: number) => (status === 0 ? "network error" : `HTTP ${status}`);

  // Emit the current snapshot so a deadline-racing caller can report partials
  // (each page is committed in its own transaction, so these are durable).
  const snapshot = (): RefreshResult => ({
    fetched,
    upserted: upsertedIds.size,
    errors: [...errors],
    budgetExhausted,
  });
  const report = () => opts.onProgress?.(snapshot());

  for (let page = 1; page <= pages; page++) {
    if (outOfBudget()) {
      budgetExhausted = true;
      report();
      break;
    }
    const offset = (page - 1) * PAGE_SIZE;
    const res = await fetchPage(
      `/api/models?sort=downloads&direction=-1&limit=${PAGE_SIZE}&offset=${offset}`
    );
    if (!res.data) {
      errors.push(`downloads page ${page}: ${failureMsg(res.status)}`);
      report();
      continue;
    }
    fetched += res.data.length;
    try {
      upsertPage(res.data);
    } catch (e) {
      errors.push(`downloads page ${page}: ${e instanceof Error ? e.message : String(e)}`);
    }
    report();
  }

  if (!budgetExhausted) {
    if (outOfBudget()) {
      budgetExhausted = true;
      report();
    } else {
      const trending = await fetchPage(
        `/api/models?sort=trendingScore&direction=-1&limit=${TRENDING_LIMIT}`
      );
      if (!trending.data) {
        errors.push(`trending page: ${failureMsg(trending.status)}`);
        report();
      } else {
        fetched += trending.data.length;
        try {
          upsertPage(trending.data);
        } catch (e) {
          errors.push(`trending page: ${e instanceof Error ? e.message : String(e)}`);
        }
        report();
      }
    }
  }

  return { fetched, upserted: upsertedIds.size, errors, budgetExhausted };
}

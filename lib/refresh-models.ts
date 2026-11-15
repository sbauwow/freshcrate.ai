import { getDb } from "@/lib/db";
import { hfFetchWithStatus, HUB_ORIGIN } from "@/lib/hub-fetch";

export interface RefreshOptions {
  /** Number of 1000-entry downloads pages to pull (offset 0, 1000, ...). Default 3. */
  pages?: number;
  /** Optional Hugging Face token sent as a Bearer header. */
  token?: string;
  /** Injectable sleep for tests (default real timer). */
  sleep?: (ms: number) => Promise<void>;
}

export interface RefreshResult {
  /** Total entries seen across all pages (trending overlap included). */
  fetched: number;
  /** Distinct repo_ids touched (a repo on two pages counts once). */
  upserted: number;
  errors: string[];
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
 */
export async function refreshModels(opts: RefreshOptions = {}): Promise<RefreshResult> {
  const db = getDb();
  const pages = Math.max(1, opts.pages ?? 3);
  const sleep = opts.sleep ?? DEFAULT_SLEEP;
  const errors: string[] = [];
  let fetched = 0;
  const upsertedIds = new Set<string>();

  const upsertStmt = db.prepare(`
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

  const upsertPage = db.transaction((entries: HfModel[]) => {
    for (const m of entries) {
      const { author, model_name } = splitRepoId(m.id);
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
        await sleep(RATE_LIMIT_SLEEP_MS);
        continue;
      }
      return { status: res.status, data: null };
    }
  };

  const failureMsg = (status: number) => (status === 0 ? "network error" : `HTTP ${status}`);

  for (let page = 1; page <= pages; page++) {
    const offset = (page - 1) * PAGE_SIZE;
    const res = await fetchPage(
      `/api/models?sort=downloads&direction=-1&limit=${PAGE_SIZE}&offset=${offset}`
    );
    if (!res.data) {
      errors.push(`downloads page ${page}: ${failureMsg(res.status)}`);
      continue;
    }
    fetched += res.data.length;
    try {
      upsertPage(res.data);
    } catch (e) {
      errors.push(`downloads page ${page}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const trending = await fetchPage(
    `/api/models?sort=trendingScore&direction=-1&limit=${TRENDING_LIMIT}`
  );
  if (!trending.data) {
    errors.push(`trending page: ${failureMsg(trending.status)}`);
  } else {
    fetched += trending.data.length;
    try {
      upsertPage(trending.data);
    } catch (e) {
      errors.push(`trending page: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { fetched, upserted: upsertedIds.size, errors };
}

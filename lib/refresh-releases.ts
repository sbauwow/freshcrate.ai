import type Database from "better-sqlite3";

export interface RefreshOptions {
  limit?: number;
  concurrency?: number;
  token?: string;
  dryRun?: boolean;
  /** Partition the catalog by `id % shards`; process only partition `shard`. */
  shard?: number;
  shards?: number;
  /** Stop starting new projects once this many ms have elapsed. */
  budgetMs?: number;
  /** Return this long after the budget even if some projects are still in flight. */
  graceMs?: number;
}

export interface RefreshResult {
  checked: number;
  updated: number;
  unchanged: number;
  skipped: number;
  hasMore: boolean;
  /** True when the time budget ran out before every selected project was processed. */
  budgetExhausted: boolean;
  /** Projects still in flight when the hard deadline returned the result. */
  stuck: number;
  durationMs: number;
}

interface ProjectRow {
  id: number;
  name: string;
  repo_url: string;
  latest_release_at: string | null;
}

interface StoredRelease {
  id: number;
  version: string;
  created_at: string;
}

interface GithubRelease {
  tag_name?: string;
  body?: string;
  published_at?: string;
}

interface GithubRepo {
  pushed_at?: string;
  default_branch?: string;
}

const GH_TIMEOUT_MS = 10000;
const DEFAULT_GRACE_MS = 25000;

const SYNTHETIC_VERSION_RE = /^[^@\s]+@\d{4}-\d{2}-\d{2}$/;
const isSynthetic = (v: string | undefined) => SYNTHETIC_VERSION_RE.test(v || "");

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function urgencyFromAge(dateStr: string): string {
  if (!dateStr) return "Low";
  const days = (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 7) return "High";
  if (days < 30) return "Medium";
  return "Low";
}

async function ghFetch<T>(endpoint: string, token?: string): Promise<T | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "freshcrate-refresh-releases",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // A plain timer instead of AbortSignal.timeout: on 10-20 handlers hung for hours
  // past that 10s signal. Non-OK bodies are cancelled so they don't pin sockets.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.github.com${endpoint}`, {
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refreshes the latest-release row for a batch of projects. Selects the
 * staleest projects first (oldest stored release date). Falls back to
 * `pushed_at` on the default branch when a project has no GitHub release.
 *
 * Synthetic (`branch@date`) versions are updated in place so a daily cron
 * does not bloat the releases table with one row per day.
 */
export async function refreshReleases(
  db: Database.Database,
  opts: RefreshOptions = {}
): Promise<RefreshResult> {
  const limit = opts.limit ?? 500;
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  const token = opts.token;
  const dryRun = opts.dryRun ?? false;
  const shards = Math.max(1, opts.shards ?? 1);
  const shard = Math.min(Math.max(0, opts.shard ?? 0), shards - 1);
  const budgetMs = opts.budgetMs ?? Infinity;
  const start = Date.now();

  const projects = db.prepare(`
    SELECT p.id, p.name, p.repo_url,
      (SELECT MAX(created_at) FROM releases WHERE project_id = p.id) as latest_release_at
    FROM projects p
    WHERE p.repo_url LIKE '%github.com%' AND p.id % ? = ?
    ORDER BY latest_release_at ASC
    LIMIT ?
  `).all(shards, shard, limit) as ProjectRow[];

  const totalGh = (db.prepare(
    "SELECT COUNT(*) as c FROM projects WHERE repo_url LIKE '%github.com%' AND id % ? = ?"
  ).get(shards, shard) as { c: number }).c;

  const latestReleaseStmt = db.prepare(
    "SELECT id, version, created_at FROM releases WHERE project_id = ? ORDER BY created_at DESC LIMIT 1"
  );
  const insertReleaseStmt = db.prepare(
    "INSERT INTO releases (project_id, version, changes, urgency, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const updateReleaseStmt = db.prepare(
    "UPDATE releases SET version = ?, changes = ?, urgency = ?, created_at = ? WHERE id = ?"
  );

  const counters = { checked: 0, updated: 0, unchanged: 0, skipped: 0 };

  async function processProject(project: ProjectRow): Promise<void> {
    const gh = parseGithubUrl(project.repo_url);
    if (!gh) { counters.skipped++; return; }
    counters.checked++;

    const slug = `${gh.owner}/${gh.repo}`;

    let version: string;
    let changes: string;
    let releaseDate: string;

    try {
      const release = await ghFetch<GithubRelease>(`/repos/${slug}/releases/latest`, token);

      if (release && release.tag_name) {
        version = release.tag_name;
        changes = (release.body || "").slice(0, 500).replace(/\r\n/g, " ").replace(/\n/g, " ");
        releaseDate = release.published_at || new Date().toISOString();
      } else {
        const repo = await ghFetch<GithubRepo>(`/repos/${slug}`, token);
        if (!repo || !repo.pushed_at) {
          counters.skipped++;
          return;
        }
        const branch = repo.default_branch || "main";
        const date = repo.pushed_at.slice(0, 10);
        version = `${branch}@${date}`;
        changes = `Latest activity on ${branch} branch`;
        releaseDate = repo.pushed_at;
      }

      const stored = latestReleaseStmt.get(project.id) as StoredRelease | undefined;
      if (stored && stored.version === version) {
        counters.unchanged++;
        return;
      }

      const replaceInPlace = !!stored && isSynthetic(stored.version) && isSynthetic(version);

      if (!dryRun) {
        if (replaceInPlace && stored) {
          updateReleaseStmt.run(
            version,
            changes || `Latest release: ${version}`,
            urgencyFromAge(releaseDate),
            releaseDate,
            stored.id
          );
        } else {
          insertReleaseStmt.run(
            project.id,
            version,
            changes || `Latest release: ${version}`,
            urgencyFromAge(releaseDate),
            releaseDate
          );
        }
      }
      counters.updated++;
    } catch {
      counters.skipped++;
    }
  }

  let cursor = 0;
  let budgetExhausted = false;
  const inFlight = new Set<string>();
  async function worker(): Promise<void> {
    while (cursor < projects.length) {
      if (Date.now() - start >= budgetMs) { budgetExhausted = true; return; }
      const project = projects[cursor++];
      inFlight.add(project.repo_url);
      try {
        await processProject(project);
      } finally {
        inFlight.delete(project.repo_url);
      }
    }
  }
  const workers = Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Hard deadline: a promise that never settles must not hold the response open
  // (10-20: 9 of 12 shard calls hung until the client gave up, never logging).
  let stuck = 0;
  if (Number.isFinite(budgetMs)) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"deadline">((resolve) => {
      timer = setTimeout(() => resolve("deadline"), budgetMs + (opts.graceMs ?? DEFAULT_GRACE_MS));
    });
    const outcome = await Promise.race([workers.then(() => "done" as const), deadline]);
    clearTimeout(timer);
    if (outcome === "deadline") {
      budgetExhausted = true;
      stuck = inFlight.size;
      console.warn(`[refresh-releases] hard deadline hit, ${stuck} stuck: ${[...inFlight].join(" ")}`);
    }
  } else {
    await workers;
  }

  return {
    ...counters,
    hasMore: budgetExhausted || (projects.length === limit && totalGh > limit),
    budgetExhausted,
    stuck,
    durationMs: Date.now() - start,
  };
}

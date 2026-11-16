# HuggingFace Model Listings + Torrent Downloads — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

> **Status:** Implemented via subagent-driven waves (Tasks 1–12). All commits live on branch `plan/hf-models-and-torrents` — pending push, merge, deploy, and user steps (GitHub Actions secrets/cron enablement).

**Goal:** Add HuggingFace model listings as a first-class content type on freshcrate.ai, and let visitors download open-licensed model weights via BitTorrent — without freshcrate ever hosting weight payloads.

**Architecture:** Two new tables (`models`, `model_torrents`) fed by a daily GitHub-Actions refresh that mirrors the existing `refresh-releases` pipeline. Model pages live under `/models`. Torrent integration is **metainfo-only**: a scheduled job builds `.torrent` files whose web-seed URLs point at the HF CDN (`/resolve/main/` per file), so freshcrate serves KB-sized metainfo + magnet links while the swarm fetches bytes straight from HuggingFace. License policy gates which models are torrentable.

**Tech Stack:** HF Hub REST API (`huggingface.co/api/models`, no auth for public metadata; optional `HF_TOKEN`), better-sqlite3 + numbered SQL migrations, `create-torrent` + `parse-torrent` (npm — repo is npm/lockfile, do not add yarn), GitHub Actions cron, vitest in-memory DB harness.

**Repo conventions this plan follows** (AGENTS.md + dev-workflow): TDD with `createTestDb()`/`_setDb()`, plain numbered SQL migrations (next = 030), FTS via SQL triggers (never hand-maintained), typed queries in `lib/queries.ts`, admin/robots conventions for new public pages, vitest red-baseline discipline (diff vs baseline, never zero).

---

## Phase 1 — Model listings

### Task 1: Migration `030_models.sql` — ✅ complete

**Objective:** Create the `models` table + its own FTS index with sync triggers (mirrors `002_fts5_search.sql` / `012_readme_text_fts.sql` pattern).

**Files:**
- Create: `migrations/030_models.sql`
- Test: `tests/migrations.test.ts` (extend existing migration smoke test)

**Step 1: Write failing test**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createTestDb } from "../tests/setup";

describe("migration 030 models", () => {
  it("creates models table with hub identity + stats", () => {
    const db = createTestDb();
    const cols = db.prepare("PRAGMA table_info(models)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("repo_id");
    expect(names).toContain("downloads");
    expect(names).toContain("license");
    expect(names).toContain("gated");
  });
  it("model_fts syncs on insert via trigger", () => {
    const db = createTestDb();
    db.prepare(`INSERT INTO models (repo_id, author, model_name, short_desc, license, downloads)
                VALUES ('acme/tiny-llama','acme','tiny-llama','a tiny test model','mit',5)`).run();
    const hit = db.prepare("SELECT repo_id FROM models_fts WHERE models_fts MATCH 'tiny'").all();
    expect(hit).toHaveLength(1);
  });
});
```

**Step 2: Run** `npx vitest run tests/migrations.test.ts` — Expected: FAIL (no `models` table).

**Step 3: Write the migration**

```sql
-- 030: HuggingFace model listings
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL UNIQUE,            -- 'author/name' (HF canonical id)
  author TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  short_desc TEXT NOT NULL DEFAULT '',     -- cardData summary or pipeline_tag-derived
  pipeline_tag TEXT NOT NULL DEFAULT '',   -- text-generation, embedding, etc.
  license TEXT NOT NULL DEFAULT 'unknown', -- from cardData tags ('license:mit')
  downloads INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  trending_score INTEGER NOT NULL DEFAULT 0,
  gated INTEGER NOT NULL DEFAULT 0,        -- 1 = auth-walled on HF (never torrentable)
  size_mb INTEGER,                         -- sum of weight-file sizes, NULL until computed
  hf_url TEXT NOT NULL DEFAULT '',
  last_modified TEXT NOT NULL DEFAULT '',  -- HF lastModified (upstream, like releases.created_at)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_models_downloads ON models(downloads DESC);
CREATE INDEX IF NOT EXISTS idx_models_trending ON models(trending_score DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS models_fts USING fts5(
  repo_id, model_name, short_desc, author, content='models', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS models_ai AFTER INSERT ON models BEGIN
  INSERT INTO models_fts(rowid, repo_id, model_name, short_desc, author)
  VALUES (new.id, new.repo_id, new.model_name, new.short_desc, new.author);
END;
CREATE TRIGGER IF NOT EXISTS models_ad AFTER DELETE ON models BEGIN
  INSERT INTO models_fts(models_fts, rowid, repo_id, model_name, short_desc, author)
  VALUES ('delete', old.id, old.repo_id, old.model_name, old.short_desc, old.author);
END;
CREATE TRIGGER IF NOT EXISTS models_au AFTER UPDATE ON models BEGIN
  INSERT INTO models_fts(models_fts, rowid, repo_id, model_name, short_desc, author)
  VALUES ('delete', old.id, old.repo_id, old.model_name, old.short_desc, old.author);
  INSERT INTO models_fts(rowid, repo_id, model_name, short_desc, author)
  VALUES (new.id, new.repo_id, new.model_name, new.short_desc, new.author);
END;
```

**Step 4:** `npx vitest run tests/migrations.test.ts` — PASS. **Step 5:** commit `feat: migration 030 models + models_fts`.

### Task 2: Migration `031_model_torrents.sql` — ✅ complete

**Objective:** Torrent metainfo store. Metainfo bytes live in the DB (KBs each); weights never do.

**Files:** Create `migrations/031_model_torrents.sql`; extend `tests/migrations.test.ts`.

**Step 1: Failing test** — asserts table exists, `info_hash` UNIQUE, FK to models with `ON DELETE CASCADE`, and that a torrent row can round-trip a BLOB.

**Step 2-4: Migration**

```sql
-- 031: model torrent metainfo (metainfo only — weights stay on HF CDN web seeds)
CREATE TABLE IF NOT EXISTS model_torrents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL UNIQUE REFERENCES models(id) ON DELETE CASCADE,
  info_hash TEXT NOT NULL UNIQUE,          -- v1 btih, hex
  display_name TEXT NOT NULL,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  metainfo BLOB NOT NULL,                  -- the .torrent file bytes
  magnet TEXT NOT NULL DEFAULT '',
  build_tool_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Step 5:** commit `feat: migration 031 model_torrents`.

### Task 3: `lib/hub-fetch.ts` — HF Hub fetch helper — ✅ complete

**Objective:** Mirror `ghFetch` (exported from `lib/refresh-releases.ts`) for the Hub: timeout, null-on-failure, optional token.

**Files:** Create `lib/hub-fetch.ts`; Test: `tests/hub-fetch.test.ts`.

**Step 1: Failing test** (mock `global.fetch`):

```ts
it("returns null on non-200", async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
  expect(await hfFetch("/api/models/nope")).toBeNull();
});
it("returns parsed json on 200 and prefixes the hub origin", async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ x: 1 }) } as Response);
  expect(await hfFetch("/api/models/acme/tiny")).toEqual({ x: 1 });
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("https://huggingface.co/api/models"), expect.anything());
});
```

**Step 2:** fail → **Step 3:** implement `hfFetch<T>(endpoint: string, token?: string): Promise<T | null>` (AbortController 20s, `Accept: application/json`, `Authorization: Bearer` only when token provided). **Step 4:** pass. **Step 5:** commit `feat: hub fetch helper`.

### Task 4: `lib/refresh-models.ts` — the refresh pipeline — ✅ complete

**Objective:** Daily upsert from the Hub, mirroring `refreshReleases` shape (`RefreshOptions`/`RefreshResult`, worker pool).

**Files:** Create `lib/refresh-models.ts`; Test: `tests/refresh-models.test.ts`.

**Behaviour spec:**
1. `refreshModels({ pages?: number })`: fetch `GET /api/models?sort=downloads&direction=-1&limit=1000&offset=N` for N in 0..pages-1 (default 3 → top 3000 by downloads), then one page `sort=trendingScore` for freshness. Respect a `Retry-After` on 429 (rate-limit: back off 60s, max 2 retries).
2. Map each entry: `repo_id` (id), split author/name, `pipeline_tag`, license extracted from `tags` (`license:*` prefix), `downloads`, `likes`, `trendingScore`, `gated`, `lastModified`, `hf_url = https://huggingface.co/{id}`.
3. Upsert on `repo_id` (`INSERT ... ON CONFLICT(repo_id) DO UPDATE` stats fields + `updated_at`); **never** overwrite `short_desc` if HF sends none and we already have one.
4. Result: `{ fetched, upserted, errors: string[] }`.

**Tests** (mock fetch returning fixture pages): upsert-idempotency (run twice → still one row per repo_id, downloads updated), license extraction from tags, gated flag passthrough, short_desc preservation rule.

**Step 5:** commit `feat: model refresh pipeline`.

### Task 5: Cron workflow `.github/workflows/refresh-models.yml` — ✅ complete

**Objective:** Daily refresh job, mirroring `refresh-releases.yml` (copy its structure: `schedule: cron`, `workflow_dispatch`, node setup, `HF_TOKEN` from secrets as optional env).

**Files:** Create `.github/workflows/refresh-models.yml`; Create `scripts/refresh-models.mjs` (thin CLI: `refreshModels()` → console summary; exits non-zero on hard failure).

**Verify:** `gh workflow run refresh-models.yml` then `gh run list --workflow=refresh-models.yml --limit 1` shows green. Baseline: daily, ~1-2 min.

**Commit:** `feat: daily hf model refresh cron`.

### Task 6: `/models` index page + `/api/models` route — ✅ complete

**Objective:** Public browse surface: SSR index (top by downloads + trending, license/pipeline filters) + JSON API.

**Files:**
- Create: `app/models/page.tsx` (SSR; queries via `lib/queries.ts` `listModels({ sort, license, pipeline, limit })`)
- Create: `app/api/models/route.ts` (GET; same params; JSON)
- Modify: `lib/queries.ts` (add `listModels`, `getModel`)
- Modify: `app/layout.tsx` nav (add "Models" link)
- Modify: `app/robots.ts` / sitemap source: include `/models` + model pages
- Test: `tests/api-models.test.ts` (route handler + `NextRequest` per house style: 200 shape, filters, 404-empty)

**Commit:** `feat: /models browse page + API`.

### Task 7: Model detail page `/models/[repoId]/page.tsx` — ✅ complete

**Objective:** Detail page: stats (downloads/likes), license badge, pipeline tag, HF link, file-size summary when known, and the Torrent section (Task 12 fills it) or, for gated models, a "weights are auth-walled upstream — not redistributable" note. `generateMetadata` for SEO; `export const dynamic = "force-dynamic"` is NOT needed (SSR by default is fine), robots indexable.

**Files:** Create `app/models/[repoId]/page.tsx` (repoId = `author%2Fname` decoded — mirror how `/projects/[name]` handles encoded slashes); Test: `tests/model-page.test.ts` (renders 404 for unknown, renders stats for seeded row).

**Commit:** `feat: model detail page`.

### Task 8: Metrics exposure — ✅ complete

**Objective:** Add `models` count to `/api/metrics` → `content` block (one line in the metrics route + one test), so future checks track listing growth without an ssh read.

**Files:** Modify the metrics route (`app/api/metrics/route.ts`); Test: extend its test. **Commit:** `feat: metrics models count`.

---

## Phase 2 — Torrent downloads

### Policy (decided up front, encoded in code + a test)

- **Allowlist licenses** for torrent generation: `mit, apache-2.0, bsd-2-clause, bsd-3-clause, wtfpl, cc-by-4.0, cc-by-sa-4.0, cc0-1.0, openrail, bigscience-openrail-m, artistic-2.0` — stored in `lib/model-torrent-policy.ts` as `TORRENTABLE_LICENSES`.
- **Hard exclusions**: `gated = 1`; license not in allowlist (covers Llama/Gemma/Qwen community licenses with redistribution conditions); models with no weight files (config-only).
- **Payload rule**: freshcrate stores only metainfo; web seeds point at `https://huggingface.co/{repo_id}/resolve/main/{path}`. Takedown contact: `AGENTS.md` lists the abuse path — add a "report torrent" mailto on the model page footer (static string, no new infra).

### Task 9: `npm i create-torrent parse-torrent` + `lib/bencode-helpers.test.ts` — ✅ complete

**Objective:** Dependencies in (repo uses npm + lockfile — never yarn), plus a round-trip test that a generated torrent parses back with a stable v1 infohash and the HF web seeds intact.

**Step 1: Failing test**

```ts
import { buildModelTorrent } from "../lib/build-model-torrent";
it("produces a parseable torrent with hf web seeds", async () => {
  const t = await buildModelTorrent({
    repoId: "acme/tiny", displayName: "tiny",
    files: [{ path: "model.safetensors", size: 1024, url: "https://huggingface.co/acme/tiny/resolve/main/model.safetensors" }],
  });
  expect(t.infoHash).toMatch(/^[0-9a-f]{40}$/);
  expect(t.metainfo.length).toBeGreaterThan(50);
  expect(t.magnet).toContain(`magnet:?xt=urn:btih:${t.infoHash}`);
});
```

**Step 2:** fail (module missing) → **Step 3: implement `lib/build-model-torrent.ts`**

```ts
import createTorrent from "create-torrent";
import parseTorrent from "parse-torrent";

export interface TorrentFileInput { path: string; size: number; url: string }
export interface BuiltTorrent { infoHash: string; metainfo: Buffer; magnet: string; totalBytes: number; fileCount: number }

export async function buildModelTorrent(input: {
  repoId: string; displayName: string; files: TorrentFileInput[];
}): Promise<BuiltTorrent> {
  const files = input.files.map((f) => ({ length: f.size, path: f.path }));
  const metainfo = await createTorrent({ info: { name: input.displayName }, files, urlList: input.files.map((f) => f.url) } as never, { name: input.displayName });
  const parsed = parseTorrent(metainfo);
  const magnet = `magnet:?xt=urn:btih:${parsed.infoHash}&dn=${encodeURIComponent(input.displayName)}` +
    input.files.map((f) => `&ws=${encodeURIComponent(f.url)}`).join("");
  return { infoHash: parsed.infoHash, metainfo, magnet, totalBytes: input.files.reduce((a, f) => a + f.size, 0), fileCount: input.files.length };
}
```

(Adjust to the actual `create-torrent` v2 call signature during implementation; the test pins the contract, not the call shape.)

**Step 4:** pass → **Step 5:** commit `feat: torrent metainfo builder`.

### Task 10: `scripts/build-model-torrents.mjs` — the batch builder — ✅ complete

**Objective:** Weekly batch: top `N` (default 50) allowlisted models by downloads → fetch file trees → build torrents → upsert `model_torrents`.

**Files:** Create `scripts/build-model-torrents.mjs`; Test: `tests/build-model-torrents.test.ts` (mock fetch: file tree with one weight + one README + one gated model → assert only the permissive model gets a torrent, README/config excluded from files, `size_mb` written back to `models`).

**Behaviour:** file tree via `GET /api/models/{repo_id}/tree/main?recursive=true`; keep weight/blob files (`*.safetensors, *.bin, *.gguf, *.ckpt, *.onnx, *.pth`), drop tiny metadata files; per-file web seed `https://huggingface.co/{repo_id}/resolve/main/{encodedPath}`; skip + record reason when license/gated policy fails; write `models.size_mb` while there. Hard cap total built per run (default 50) and total bytes inspected — the job must finish < GitHub Actions 10 min default.

**Commit:** `feat: weekly torrent build job` + workflow `build-model-torrents.yml` (weekly, `workflow_dispatch`).

### Task 11: `/api/models/[repoId]/torrent` route — ✅ complete

**Objective:** Serve the `.torrent` bytes: `Content-Type: application/x-bittorrent`, `Content-Disposition: attachment; filename="<name>.torrent"`; 404 when not built; 403-with-reason JSON for gated models (so the UI can explain).

**Files:** Create `app/api/models/[repoId]/torrent/route.ts`; Test: `tests/api-model-torrent.test.ts` (200 + headers for built, 404 for unbuilt, 403 gated). **Commit:** `feat: torrent download endpoint`.

### Task 12: Model page torrent section + magnet link — ✅ complete (lands with the feat commit of this wave)

**Objective:** On the detail page: "Download via BitTorrent" block — magnet link (primary), `.torrent` file link (secondary), total size + file count, "weights are fetched from HuggingFace via web seeds; freshcrate hosts no model weights" caption, report-torrent mailto. Gated models: explanatory note instead.

**Files:** Modify `app/models/[repoId]/page.tsx` (+ a small `components/torrent-box.tsx`); Test: extend model-page test (magnet href present for built, policy note for gated). **Commit:** `feat: torrent box on model pages`.

---

## Phase 3 — Roadmap (NOT in this plan's scope)

- Unified search (projects + models in one FTS query, weighted tabs)
- HF datasets + Spaces listings (schema reuse: `models` is deliberately generic — a `source` column variant later)
- Submission pipeline extension: `/submit` accepts an HF repo id → review queue → refresh picks it up
- Per-model page analytics (page_views already generic on `path`)
- Sponsored model slots (the monetization path discussed 2026-11-15)
- Optional home-server seeder for top-10 models (needs disk planning: 18G free is not enough for even one 7B model — web seeds make the swarm functional without it; only pursue for "keeping seeds alive" optics)

## Explicit non-goals (YAGNI)

- No weight mirroring/hosting on Railway or the home server (payload rule above)
- No auth/walled downloads; no torrent of gated or restricted-license models, ever
- No unified global search in v1 (separate nav entry is the whole v1 UX)
- No DHT tracker operation — public trackers/DEX via magnet + web seeds only

## Baseline discipline

- Full suite + `npx tsc --noEmit` diffed against the permanent red baseline; only NEW failures block.
- Deploy = `railway up --detach`; verify via `/api/metrics` uptime reset + `migrations` count rising by the shipped migrations (30 → 32 after Phase 1; 30 → 33 if 031 ships with it).

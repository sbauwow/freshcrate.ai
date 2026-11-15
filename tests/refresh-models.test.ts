import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup";
import { refreshModels } from "@/lib/refresh-models";

interface HfEntry {
  id: string;
  likes?: number;
  downloads?: number;
  trendingScore?: number;
  tags?: string[];
  pipeline_tag?: string;
  gated?: boolean | string;
  lastModified?: string;
}

const downloadsUrl = (offset: number) =>
  `https://huggingface.co/api/models?sort=downloads&direction=-1&limit=1000&offset=${offset}`;
const trendingUrl =
  "https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=200";

function entry(id: string, over: Partial<HfEntry> = {}): HfEntry {
  return {
    id,
    likes: 10,
    downloads: 100,
    tags: ["license:mit", "transformers"],
    pipeline_tag: "text-generation",
    ...over,
  };
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Routes fetch calls by exact URL. Each mapped URL holds a list of responses
 * served in order; the last one repeats for any further calls to that URL.
 * Unmapped URLs get an empty 200 page.
 */
function routeMap(map: Record<string, Response[]>) {
  const served: Record<string, number> = {};
  return (url: string): Response => {
    for (const key of Object.keys(map)) {
      if (url === key) {
        const list = map[key];
        const i = served[key] ?? 0;
        served[key] = i + 1;
        return list[Math.min(i, list.length - 1)];
      }
    }
    return jsonResp([]);
  };
}

function mockHub(route: (url: string) => Response) {
  const calls: { url: string; authorization?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = url.toString();
      calls.push({
        url: u,
        authorization: (init?.headers as Record<string, string>)?.Authorization,
      });
      return route(u);
    })
  );
  return calls;
}

const instantSleep = async () => {};

describe("refreshModels", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("upserts idempotently across two runs and dedupes the trending overlap", async () => {
    const page1 = [entry("org/a"), entry("org/b")];
    const trending = [entry("org/a", { trendingScore: 99 })];
    let calls = mockHub(
      routeMap({
        [downloadsUrl(0)]: [jsonResp(page1)],
        [trendingUrl]: [jsonResp(trending)],
      })
    );

    const r1 = await refreshModels({ pages: 1, sleep: instantSleep });
    expect(r1.errors).toEqual([]);
    expect(r1.fetched).toBe(3); // 2 downloads-page entries + 1 trending entry seen
    expect(r1.upserted).toBe(2); // org/a seen twice counts once

    const urls = calls.map((c) => c.url);
    expect(urls).toContain(downloadsUrl(0));
    expect(urls).toContain(trendingUrl);
    expect(urls.every((u) => u.startsWith("https://huggingface.co/"))).toBe(true);

    let rows = db
      .prepare(
        "SELECT repo_id, downloads, trending_score, license, pipeline_tag, hf_url, author, model_name FROM models ORDER BY repo_id"
      )
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.repo_id === "org/a")!;
    expect(a.downloads).toBe(100);
    expect(a.trending_score).toBe(99); // trending page refreshed it
    expect(a.license).toBe("mit");
    expect(a.pipeline_tag).toBe("text-generation");
    expect(a.author).toBe("org");
    expect(a.model_name).toBe("a");
    expect(a.hf_url).toBe("https://huggingface.co/org/a");
    const b = rows.find((r) => r.repo_id === "org/b")!;
    expect(b.trending_score).toBe(0);

    // FTS stayed in sync — 2 rows, no duplicates from the update trigger
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM models_fts").get() as { c: number }).c
    ).toBe(2);

    // Second run: same repos, downloads bumped — must UPDATE, not duplicate
    const page1b = [entry("org/a", { downloads: 500 }), entry("org/b")];
    const trendingB = [entry("org/a", { trendingScore: 99, downloads: 500 })];
    calls = mockHub(
      routeMap({
        [downloadsUrl(0)]: [jsonResp(page1b)],
        [trendingUrl]: [jsonResp(trendingB)],
      })
    );

    const createdBefore = (
      db.prepare("SELECT created_at FROM models WHERE repo_id = 'org/a'").get() as {
        created_at: string;
      }
    ).created_at;

    const r2 = await refreshModels({ pages: 1, sleep: instantSleep });
    expect(r2.errors).toEqual([]);
    expect(r2.upserted).toBe(2);

    rows = db
      .prepare("SELECT repo_id, downloads, created_at FROM models ORDER BY repo_id")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2); // still one row per repo_id
    const a2 = rows.find((r) => r.repo_id === "org/a")!;
    expect(a2.downloads).toBe(500); // updated
    expect(a2.created_at).toBe(createdBefore); // untouched
  });

  it("extracts license from the first license: tag, else unknown", async () => {
    mockHub(
      routeMap({
        [downloadsUrl(0)]: [
          jsonResp([
            entry("x/with-license", { tags: ["license:mit", "other"] }),
            entry("x/no-license", { tags: ["transformers", "region:us"] }),
            entry("x/two-licenses", { tags: ["license:apache-2.0", "license:mit"] }),
          ]),
        ],
        [trendingUrl]: [jsonResp([])],
      })
    );

    const r = await refreshModels({ pages: 1, sleep: instantSleep });
    expect(r.errors).toEqual([]);

    const rows = db
      .prepare("SELECT repo_id, license FROM models")
      .all() as Array<{ repo_id: string; license: string }>;
    const lic = Object.fromEntries(rows.map((r) => [r.repo_id, r.license]));
    expect(lic["x/with-license"]).toBe("mit");
    expect(lic["x/no-license"]).toBe("unknown");
    expect(lic["x/two-licenses"]).toBe("apache-2.0"); // first license: tag wins
  });

  it("maps gated truthiness to 1/0", async () => {
    mockHub(
      routeMap({
        [downloadsUrl(0)]: [
          jsonResp([
            entry("y/gated", { gated: true }),
            entry("y/open"),
            entry("y/auto", { gated: "auto" }),
          ]),
        ],
        [trendingUrl]: [jsonResp([])],
      })
    );

    const r = await refreshModels({ pages: 1, sleep: instantSleep });
    expect(r.errors).toEqual([]);

    const rows = db
      .prepare("SELECT repo_id, gated FROM models")
      .all() as Array<{ repo_id: string; gated: number }>;
    const gated = Object.fromEntries(rows.map((r) => [r.repo_id, r.gated]));
    expect(gated["y/gated"]).toBe(1);
    expect(gated["y/open"]).toBe(0);
    expect(gated["y/auto"]).toBe(1);
  });

  it("never clobbers a pre-set short_desc", async () => {
    db.prepare("INSERT INTO models (repo_id, short_desc) VALUES (?, ?)").run(
      "z/manual",
      "hand-written blurb"
    );
    mockHub(
      routeMap({
        [downloadsUrl(0)]: [
          jsonResp([entry("z/manual"), entry("z/fresh")]),
        ],
        [trendingUrl]: [jsonResp([])],
      })
    );

    const r = await refreshModels({ pages: 1, sleep: instantSleep });
    expect(r.errors).toEqual([]);

    const rows = db
      .prepare("SELECT repo_id, short_desc FROM models")
      .all() as Array<{ repo_id: string; short_desc: string }>;
    const sd = Object.fromEntries(rows.map((r) => [r.repo_id, r.short_desc]));
    expect(sd["z/manual"]).toBe("hand-written blurb");
    expect(sd["z/fresh"]).toBe("");
  });

  it("retries a 429 page after a 60s sleep and succeeds on the second attempt", async () => {
    const page1 = [entry("w/one"), entry("w/two")];
    mockHub(
      routeMap({
        [downloadsUrl(0)]: [jsonResp("rate limited", 429), jsonResp(page1)],
        [trendingUrl]: [jsonResp([])],
      })
    );
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
    };

    const r = await refreshModels({ pages: 1, sleep });
    expect(r.errors).toEqual([]);
    expect(r.fetched).toBe(2);
    expect(sleeps).toEqual([60000]);
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM models").get() as { c: number }).c
    ).toBe(2);
  });

  it("collects a failed page error and still processes the other pages", async () => {
    const page1 = [entry("v/ok")];
    const trending = [entry("v/trendy")];
    mockHub(
      routeMap({
        [downloadsUrl(0)]: [jsonResp(page1)],
        [downloadsUrl(1000)]: [jsonResp("boom", 500)], // always fails
        [trendingUrl]: [jsonResp(trending)],
      })
    );

    const r = await refreshModels({ pages: 2, sleep: instantSleep });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^downloads page 2: /);
    expect(r.fetched).toBe(2); // page 1 + trending still processed
    expect(r.upserted).toBe(2);
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM models").get() as { c: number }).c
    ).toBe(2);
  });

  it("passes the bearer token through to every request when provided", async () => {
    const calls = mockHub(
      routeMap({
        [downloadsUrl(0)]: [jsonResp([entry("t/one")])],
        [trendingUrl]: [jsonResp([])],
      })
    );

    await refreshModels({ pages: 1, token: "hf_test_token", sleep: instantSleep });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.authorization === "Bearer hf_test_token")).toBe(true);
  });
});

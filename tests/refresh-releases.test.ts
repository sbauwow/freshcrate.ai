import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb, insertTestProject } from "./setup";
import { refreshReleases } from "@/lib/refresh-releases";

function seed(db: Database.Database, n: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(insertTestProject(db, {
      name: `proj-${i}`,
      repo_url: `https://github.com/owner/proj-${i}`,
      version: "v0.0.1",
    }));
  }
  return ids;
}

function mockGithub(delayMs = 0) {
  const fetched: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetched.push(url);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return new Response(
      JSON.stringify({ tag_name: "v1.0.0", body: "notes", published_at: "2026-10-01T00:00:00Z" }),
      { status: 200 }
    );
  }));
  return fetched;
}

describe("refreshReleases sharding", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("processes only projects whose id falls in the requested shard", async () => {
    const ids = seed(db, 10);
    const fetched = mockGithub();

    const result = await refreshReleases(db, { limit: 100, shard: 1, shards: 3, dryRun: true });

    const expected = ids.filter((id) => id % 3 === 1).map((id) => `proj-${ids.indexOf(id)}`);
    expect(result.checked).toBe(expected.length);
    expect(fetched.map((u) => u.match(/proj-\d+/)![0]).sort()).toEqual(expected.sort());
    expect(result.hasMore).toBe(false);
  });

  it("covers every project exactly once across all shards", async () => {
    seed(db, 11);
    const fetched = mockGithub();

    let checked = 0;
    for (let shard = 0; shard < 4; shard++) {
      checked += (await refreshReleases(db, { limit: 100, shard, shards: 4, dryRun: true })).checked;
    }

    expect(checked).toBe(11);
    expect(new Set(fetched).size).toBe(11);
  });

  it("defaults to the whole catalog when no shard is given", async () => {
    seed(db, 5);
    mockGithub();
    const result = await refreshReleases(db, { limit: 100, dryRun: true });
    expect(result.checked).toBe(5);
  });
});

describe("refreshReleases time budget", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("stops starting new projects once the budget is spent and reports hasMore", async () => {
    seed(db, 20);
    mockGithub(30);

    const result = await refreshReleases(db, { limit: 100, concurrency: 1, budgetMs: 70, dryRun: true });

    expect(result.budgetExhausted).toBe(true);
    expect(result.hasMore).toBe(true);
    expect(result.checked).toBeGreaterThan(0);
    expect(result.checked).toBeLessThan(20);
  });

  it("does not flag the budget when everything finishes in time", async () => {
    seed(db, 3);
    mockGithub();
    const result = await refreshReleases(db, { limit: 100, budgetMs: 60_000, dryRun: true });
    expect(result.budgetExhausted).toBe(false);
    expect(result.checked).toBe(3);
  });
});

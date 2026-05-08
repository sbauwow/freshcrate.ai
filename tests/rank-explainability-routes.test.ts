import { beforeEach, afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { createTestDb, insertTestProject, _resetDb } from "./setup";
import { GET as getSearch } from "@/app/api/search/route";
import { GET as getProject } from "@/app/api/projects/[name]/route";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  _resetDb();
});

describe("rank explainability API routes", () => {
  it("returns rank breakdown data from /api/search", async () => {
    const id = insertTestProject(db, {
      name: "api-search-rank",
      short_desc: "vector agent helper",
      description: "vector agent helper",
      tags: ["vector", "agent"],
      repo_url: "https://github.com/test/api-search-rank",
    });

    db.prepare("UPDATE projects SET stars = 110, forks = 12, verified = 1, verification_json = '{\"score\":88}', created_at = datetime('now', '-160 days') WHERE id = ?").run(id);
    db.prepare("UPDATE releases SET created_at = datetime('now', '-6 days') WHERE project_id = ?").run(id);

    const response = await getSearch(new NextRequest("http://localhost/api/search?q=vector"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.projects[0].rank_breakdown).toBeDefined();
    expect(body.projects[0].rank_breakdown.topFactors.length).toBeGreaterThan(0);
  });

  it("returns rank breakdown data from /api/projects/[name]", async () => {
    const id = insertTestProject(db, {
      name: "api-project-rank",
      short_desc: "verified orchestration tool",
      description: "verified orchestration tool",
      tags: ["agent"],
      repo_url: "https://github.com/test/api-project-rank",
    });

    db.prepare("UPDATE projects SET stars = 150, forks = 25, verified = 1, verification_json = '{\"score\":92}', created_at = datetime('now', '-140 days') WHERE id = ?").run(id);
    db.prepare("UPDATE releases SET created_at = datetime('now', '-3 days') WHERE project_id = ?").run(id);

    const response = await getProject(
      new NextRequest("http://localhost/api/projects/api-project-rank"),
      { params: Promise.resolve({ name: "api-project-rank" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rank_breakdown).toBeDefined();
    expect(body.rank_breakdown.factors.map((factor: { key: string }) => factor.key)).toEqual(
      expect.arrayContaining(["verification", "recency", "adoption", "cadence"])
    );
  });
});

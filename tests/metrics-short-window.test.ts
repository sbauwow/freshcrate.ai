import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { createTestDb, _resetDb, insertTestProject } from "./setup";
import { GET } from "@/app/api/metrics/route";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  _resetDb();
});

describe("metrics short-window analytics", () => {
  it("exposes traffic_1h and traffic_since_boot windows in the metrics route", () => {
    const routePath = path.join(process.cwd(), "app", "api", "metrics", "route.ts");
    const route = fs.readFileSync(routePath, "utf8");

    expect(route).toContain("traffic_1h");
    expect(route).toContain("traffic_since_boot");
    expect(route).toContain("getTrafficWindowSummary(db, 1 / 24)");
    expect(route).toContain("getTrafficWindowSummary(db, uptimeSeconds / 86400)");
  });
});

describe("metrics content block", () => {
  it("reports a models count matching seeded rows alongside the existing counts", async () => {
    insertTestProject(db, { name: "pkg-alpha", version: "1.0.0" });
    db.prepare("INSERT INTO models (repo_id, author, model_name) VALUES (?, ?, ?)").run(
      "acme/whisper-tiny",
      "acme",
      "whisper-tiny"
    );
    db.prepare("INSERT INTO models (repo_id, author, model_name) VALUES (?, ?, ?)").run(
      "acme/qwen-tiny",
      "acme",
      "qwen-tiny"
    );

    const res = await GET();
    const json = await res.json();

    expect(json.content.models).toBe(2);
    expect(json.content.projects).toBe(1);

    // Backward-compatible shape: the analytics check parses these keys, so the
    // models key must be additive and every pre-existing key must survive.
    expect(Object.keys(json.content)).toEqual(
      expect.arrayContaining(["projects", "releases", "tags", "verified", "avg_releases_per_project", "models"])
    );
    expect(typeof json.content.releases).toBe("number");
    expect(typeof json.content.tags).toBe("number");
    expect(typeof json.content.verified).toBe("number");
    expect(typeof json.content.avg_releases_per_project).toBe("number");
  });
});

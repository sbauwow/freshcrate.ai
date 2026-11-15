import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import Database from "better-sqlite3";
import { createTestDb, _resetDb } from "./setup";
import { GET } from "@/app/api/models/route";

let db: Database.Database;

function insertModel(
  overrides: Partial<{
    repo_id: string;
    author: string;
    model_name: string;
    short_desc: string;
    pipeline_tag: string;
    license: string;
    downloads: number;
    likes: number;
    trending_score: number;
    gated: number;
    size_mb: number | null;
    hf_url: string;
    last_modified: string;
  }> = {}
): number {
  const data = {
    repo_id: overrides.repo_id ?? "acme/whisper-tiny",
    author: overrides.author ?? "acme",
    model_name: overrides.model_name ?? "whisper-tiny",
    short_desc: overrides.short_desc ?? "tiny speech recognition model",
    pipeline_tag: overrides.pipeline_tag ?? "automatic-speech-recognition",
    license: overrides.license ?? "apache-2.0",
    downloads: overrides.downloads ?? 1000,
    likes: overrides.likes ?? 10,
    trending_score: overrides.trending_score ?? 0,
    gated: overrides.gated ?? 0,
    size_mb: overrides.size_mb ?? 16,
    hf_url: overrides.hf_url ?? `https://huggingface.co/${overrides.repo_id ?? "acme/whisper-tiny"}`,
    last_modified: overrides.last_modified ?? "2026-11-01T00:00:00.000Z",
  };

  const result = db
    .prepare(
      `INSERT INTO models (repo_id, author, model_name, short_desc, pipeline_tag, license, downloads, likes, trending_score, gated, size_mb, hf_url, last_modified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.repo_id,
      data.author,
      data.model_name,
      data.short_desc,
      data.pipeline_tag,
      data.license,
      data.downloads,
      data.likes,
      data.trending_score,
      data.gated,
      data.size_mb,
      data.hf_url,
      data.last_modified
    );

  return result.lastInsertRowid as number;
}

function req(query = ""): NextRequest {
  return new NextRequest(`https://www.freshcrate.ai/api/models${query}`);
}

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  _resetDb();
});

describe("GET /api/models", () => {
  it("returns 200 with {models, total} on an empty database", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ models: [], total: 0 });
  });

  it("returns seeded models with total count", async () => {
    insertModel({ repo_id: "a/one", downloads: 500 });
    insertModel({ repo_id: "b/two", downloads: 900 });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.models).toHaveLength(2);
    // default sort: downloads desc
    expect(data.models[0].repo_id).toBe("b/two");
    expect(data.models[0]).toMatchObject({
      repo_id: "b/two",
      author: "acme",
      model_name: "whisper-tiny",
      downloads: 900,
    });
  });

  it("respects limit and offset", async () => {
    for (let i = 0; i < 4; i++) {
      insertModel({ repo_id: `acme/m-${i}`, downloads: 1000 - i });
    }

    const res = await GET(req("?limit=2&offset=2"));
    const data = await res.json();
    expect(data.total).toBe(4);
    expect(data.models).toHaveLength(2);
    expect(data.models.map((m: { repo_id: string }) => m.repo_id)).toEqual(["acme/m-2", "acme/m-3"]);
  });

  it("sorts by likes", async () => {
    insertModel({ repo_id: "a/one", likes: 5 });
    insertModel({ repo_id: "b/two", likes: 50 });

    const res = await GET(req("?sort=likes"));
    const data = await res.json();
    expect(data.models[0].repo_id).toBe("b/two");
  });

  it("filters by license and pipeline", async () => {
    insertModel({ repo_id: "a/hit", license: "mit", pipeline_tag: "text-generation" });
    insertModel({ repo_id: "b/miss", license: "apache-2.0", pipeline_tag: "text-generation" });

    const res = await GET(req("?license=mit&pipeline=text-generation"));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.models[0].repo_id).toBe("a/hit");
  });

  it("returns 400 for a bad limit", async () => {
    for (const bad of ["0", "-5", "abc", "1001"]) {
      const res = await GET(req(`?limit=${bad}`));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/limit/i);
    }
  });

  it("returns 400 for a bad offset", async () => {
    for (const bad of ["-1", "xyz"]) {
      const res = await GET(req(`?offset=${bad}`));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/offset/i);
    }
  });

  it("returns 400 for an unknown sort", async () => {
    const res = await GET(req("?sort=bogus"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/sort/i);
  });
});

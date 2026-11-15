import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, _resetDb } from "./setup";
import { listModels, getModel, getModelFilterOptions } from "@/lib/queries";

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

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  _resetDb();
});

describe("listModels", () => {
  it("returns empty models and zero total on an empty database", () => {
    expect(listModels()).toEqual({ models: [], total: 0 });
  });

  it("defaults to downloads desc sort", () => {
    insertModel({ repo_id: "a/low", downloads: 10 });
    insertModel({ repo_id: "b/high", downloads: 900 });
    insertModel({ repo_id: "c/mid", downloads: 100 });

    const { models, total } = listModels();
    expect(total).toBe(3);
    expect(models.map((m) => m.repo_id)).toEqual(["b/high", "c/mid", "a/low"]);
  });

  it("sorts by trending, likes, and updated", () => {
    insertModel({ repo_id: "a/one", downloads: 100, likes: 1, trending_score: 5, last_modified: "2026-10-01T00:00:00Z" });
    insertModel({ repo_id: "b/two", downloads: 100, likes: 30, trending_score: 50, last_modified: "2026-11-10T00:00:00Z" });
    insertModel({ repo_id: "c/three", downloads: 100, likes: 10, trending_score: 20, last_modified: "2026-11-05T00:00:00Z" });

    expect(listModels({ sort: "trending" }).models.map((m) => m.repo_id)).toEqual(["b/two", "c/three", "a/one"]);
    expect(listModels({ sort: "likes" }).models.map((m) => m.repo_id)).toEqual(["b/two", "c/three", "a/one"]);
    expect(listModels({ sort: "updated" }).models.map((m) => m.repo_id)).toEqual(["b/two", "c/three", "a/one"]);
  });

  it("filters by license", () => {
    insertModel({ repo_id: "a/apache", license: "apache-2.0" });
    insertModel({ repo_id: "b/mit", license: "mit" });

    const { models, total } = listModels({ license: "apache-2.0" });
    expect(total).toBe(1);
    expect(models).toHaveLength(1);
    expect(models[0].repo_id).toBe("a/apache");
  });

  it("filters by pipeline tag", () => {
    insertModel({ repo_id: "a/asr", pipeline_tag: "automatic-speech-recognition" });
    insertModel({ repo_id: "b/txt", pipeline_tag: "text-generation" });

    const { models, total } = listModels({ pipeline: "text-generation" });
    expect(total).toBe(1);
    expect(models[0].repo_id).toBe("b/txt");
  });

  it("combines license and pipeline filters and reflects them in total", () => {
    insertModel({ repo_id: "a/hit", license: "mit", pipeline_tag: "text-generation" });
    insertModel({ repo_id: "b/license-miss", license: "apache-2.0", pipeline_tag: "text-generation" });
    insertModel({ repo_id: "c/pipeline-miss", license: "mit", pipeline_tag: "text2image" });

    const { models, total } = listModels({ license: "mit", pipeline: "text-generation" });
    expect(total).toBe(1);
    expect(models[0].repo_id).toBe("a/hit");
  });

  it("paginates with limit and offset", () => {
    for (let i = 0; i < 5; i++) {
      insertModel({ repo_id: `acme/m-${i}`, downloads: 1000 - i });
    }

    const page1 = listModels({ limit: 2, offset: 0 });
    expect(page1.total).toBe(5);
    expect(page1.models).toHaveLength(2);

    const page2 = listModels({ limit: 2, offset: 2 });
    expect(page2.models).toHaveLength(2);

    const page3 = listModels({ limit: 2, offset: 4 });
    expect(page3.models).toHaveLength(1);
  });
});

describe("getModel", () => {
  it("returns the row for an exact repoId match", () => {
    insertModel({ repo_id: "acme/whisper-tiny", downloads: 1234, likes: 42 });

    const model = getModel("acme/whisper-tiny");
    expect(model).not.toBeNull();
    expect(model!.repo_id).toBe("acme/whisper-tiny");
    expect(model!.downloads).toBe(1234);
    expect(model!.likes).toBe(42);
    expect(model!.author).toBe("acme");
    expect(model!.model_name).toBe("whisper-tiny");
  });

  it("matches repoId case-sensitively as stored", () => {
    insertModel({ repo_id: "Acme/Whisper-Tiny" });

    expect(getModel("acme/whisper-tiny")).toBeNull();
    expect(getModel("Acme/Whisper-Tiny")).not.toBeNull();
  });

  it("returns null on miss", () => {
    insertModel({ repo_id: "acme/whisper-tiny" });
    expect(getModel("acme/does-not-exist")).toBeNull();
    expect(getModel("no-slash-at-all")).toBeNull();
  });
});

describe("getModelFilterOptions", () => {
  it("returns license and pipeline facets with counts", () => {
    insertModel({ repo_id: "a/1", license: "apache-2.0", pipeline_tag: "text-generation" });
    insertModel({ repo_id: "a/2", license: "apache-2.0", pipeline_tag: "text-generation" });
    insertModel({ repo_id: "a/3", license: "mit", pipeline_tag: "automatic-speech-recognition" });

    const options = getModelFilterOptions();
    expect(options.licenses).toEqual([
      { license: "apache-2.0", count: 2 },
      { license: "mit", count: 1 },
    ]);
    expect(options.pipelines).toEqual([
      { pipeline_tag: "text-generation", count: 2 },
      { pipeline_tag: "automatic-speech-recognition", count: 1 },
    ]);
  });

  it("returns empty facet lists on an empty database", () => {
    expect(getModelFilterOptions()).toEqual({ licenses: [], pipelines: [] });
  });
});

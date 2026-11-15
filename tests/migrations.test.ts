import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, _resetDb } from "./setup";

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
    gated: number;
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
    gated: overrides.gated ?? 0,
  };

  const result = db
    .prepare(
      `INSERT INTO models (repo_id, author, model_name, short_desc, pipeline_tag, license, downloads, likes, gated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      data.gated
    );

  return result.lastInsertRowid as number;
}

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  _resetDb();
});

describe("migration 030: models + models_fts", () => {
  it("creates the models table with expected columns", () => {
    const cols = db.prepare("PRAGMA table_info(models)").all() as Array<{
      name: string;
    }>;
    const names = cols.map((c) => c.name);

    for (const expected of [
      "id",
      "repo_id",
      "author",
      "model_name",
      "short_desc",
      "pipeline_tag",
      "license",
      "downloads",
      "likes",
      "trending_score",
      "gated",
      "size_mb",
      "hf_url",
      "last_modified",
      "created_at",
      "updated_at",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("enforces repo_id uniqueness", () => {
    insertModel({ repo_id: "acme/dupe" });
    expect(() => insertModel({ repo_id: "acme/dupe" })).toThrow(/UNIQUE/);
  });

  it("inserting a model makes it findable via models_fts MATCH", () => {
    insertModel({ repo_id: "acme/whisper-tiny", short_desc: "tiny speech recognition model" });

    const rows = db
      .prepare("SELECT repo_id FROM models_fts WHERE models_fts MATCH ?")
      .all("whisper") as Array<{ repo_id: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].repo_id).toBe("acme/whisper-tiny");
  });

  it("updating a model keeps models_fts in sync (old tokens gone, new found)", () => {
    const id = insertModel({ short_desc: "tiny speech recognition model" });

    db.prepare("UPDATE models SET short_desc = ?, model_name = ? WHERE id = ?").run(
      "large language model for code",
      "codellama",
      id
    );

    const oldHits = db
      .prepare("SELECT rowid FROM models_fts WHERE models_fts MATCH ?")
      .all("speech") as unknown[];
    expect(oldHits).toHaveLength(0);

    const newHits = db
      .prepare("SELECT rowid FROM models_fts WHERE models_fts MATCH ?")
      .all("codellama") as unknown[];
    expect(newHits).toHaveLength(1);
  });
});

describe("migration 031: model_torrents", () => {
  it("creates model_torrents with the expected columns", () => {
    const cols = db.prepare("PRAGMA table_info(model_torrents)").all() as Array<{
      name: string;
    }>;
    const names = cols.map((c) => c.name);

    for (const expected of [
      "id",
      "model_id",
      "info_hash",
      "display_name",
      "total_bytes",
      "file_count",
      "metainfo",
      "magnet",
      "build_tool_version",
      "created_at",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("enforces info_hash uniqueness", () => {
    const modelId = insertModel();
    const insertTorrent = db.prepare(
      `INSERT INTO model_torrents (model_id, info_hash, display_name, metainfo)
       VALUES (?, ?, ?, ?)`
    );

    insertTorrent.run(modelId, "a".repeat(40), "whisper-tiny.gguf", Buffer.from("d8:announce"));
    expect(() =>
      insertTorrent.run(modelId + 1, "a".repeat(40), "other.gguf", Buffer.from("d8:announce"))
    ).toThrow(/UNIQUE/);
  });

  it("round-trips a BLOB metainfo for a model's torrent", () => {
    const modelId = insertModel();
    const metainfo = Buffer.from("d4:infod6:lengthi1234ee", "utf8");

    db.prepare(
      `INSERT INTO model_torrents (model_id, info_hash, display_name, total_bytes, file_count, metainfo, magnet)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(modelId, "b".repeat(40), "whisper-tiny-q4.gguf", 1234, 1, metainfo, "magnet:?xt=urn:btih:" + "b".repeat(40));

    const row = db
      .prepare(
        `SELECT t.info_hash, t.metainfo, t.display_name, m.repo_id
         FROM model_torrents t JOIN models m ON m.id = t.model_id
         WHERE t.model_id = ?`
      )
      .get(modelId) as { info_hash: string; metainfo: Buffer; display_name: string; repo_id: string };

    expect(row.info_hash).toBe("b".repeat(40));
    expect(Buffer.from(row.metainfo).toString("utf8")).toBe(metainfo.toString("utf8"));
    expect(row.display_name).toBe("whisper-tiny-q4.gguf");
    expect(row.repo_id).toBe("acme/whisper-tiny");
  });

  it("deleting the model cascades the torrent row", () => {
    const modelId = insertModel();
    db.prepare(
      "INSERT INTO model_torrents (model_id, info_hash, display_name, metainfo) VALUES (?, ?, ?, ?)"
    ).run(modelId, "c".repeat(40), "whisper-tiny.gguf", Buffer.from("d8:announce"));

    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM model_torrents").get() as { n: number }).n
    ).toBe(1);

    db.prepare("DELETE FROM models WHERE id = ?").run(modelId);

    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM model_torrents").get() as { n: number }).n
    ).toBe(0);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { createTestDb, _resetDb } from "./setup";
import { getModel, getModelTorrent } from "@/lib/queries";
import ModelPage, { generateMetadata, decodeRepoId } from "@/app/models/[repoId]/page";

// ModelPage reads the locale cookie via next/headers; there is no request scope
// under vitest, so stub cookies() (no locale cookie set -> English copy).
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

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
    downloads: overrides.downloads ?? 1234,
    likes: overrides.likes ?? 42,
    trending_score: overrides.trending_score ?? 7,
    gated: overrides.gated ?? 0,
    size_mb: overrides.size_mb !== undefined ? overrides.size_mb : 16,
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

describe("model detail page data", () => {
  it("returns null for an unknown repoId (page must 404 via notFound)", () => {
    insertModel({ repo_id: "acme/whisper-tiny" });
    expect(getModel("acme/does-not-exist")).toBeNull();
  });

  it("returns stats for a seeded row", () => {
    insertModel({ repo_id: "acme/whisper-tiny", downloads: 1234, likes: 42, size_mb: 16 });
    const model = getModel("acme/whisper-tiny");
    expect(model).toMatchObject({
      repo_id: "acme/whisper-tiny",
      author: "acme",
      model_name: "whisper-tiny",
      downloads: 1234,
      likes: 42,
      license: "apache-2.0",
      pipeline_tag: "automatic-speech-recognition",
      size_mb: 16,
    });
    expect(model!.hf_url).toBe("https://huggingface.co/acme/whisper-tiny");
    expect(model!.last_modified).toBe("2026-11-01T00:00:00.000Z");
  });

  it("stores gated=1 so the page gated-note branch has data", () => {
    insertModel({ repo_id: "acme/gated-model", gated: 1 });
    expect(getModel("acme/gated-model")!.gated).toBe(1);
  });

  it("handles a null size and empty last_modified without crashing", () => {
    insertModel({ repo_id: "acme/no-size", size_mb: null, last_modified: "" });
    const model = getModel("acme/no-size");
    expect(model!.size_mb).toBeNull();
    expect(model!.last_modified).toBe("");
  });
});

describe("getModelTorrent", () => {
  it("returns null when no torrent exists for the model (Wave G pending)", () => {
    const modelId = insertModel({ repo_id: "acme/whisper-tiny" });
    expect(getModelTorrent(modelId)).toBeNull();
  });

  it("returns the torrent row when one exists", () => {
    const modelId = insertModel({ repo_id: "acme/whisper-tiny" });
    db.prepare(
      `INSERT INTO model_torrents (model_id, info_hash, display_name, total_bytes, file_count, metainfo, magnet)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(modelId, "a".repeat(40), "whisper-tiny-torrent", 16000000, 3, Buffer.from("bencoded"), "magnet:?xt=urn:btih:" + "a".repeat(40));

    const torrent = getModelTorrent(modelId);
    expect(torrent).toMatchObject({
      info_hash: "a".repeat(40),
      display_name: "whisper-tiny-torrent",
      file_count: 3,
    });
  });
});

describe("model pages house structure", () => {
  const detailPage = fs.readFileSync(
    path.join(process.cwd(), "app", "models", "[repoId]", "page.tsx"),
    "utf-8"
  );
  const browsePage = fs.readFileSync(path.join(process.cwd(), "app", "models", "page.tsx"), "utf-8");

  it("404s via notFound() when the model is missing (mirrors projects)", () => {
    expect(detailPage).toContain("notFound()");
    expect(detailPage).toContain("getModel(");
  });

  it("decodes the repoId param like /author and /tag (repoIds contain a slash)", () => {
    expect(detailPage).toContain("decodeURIComponent(");
    expect(detailPage).toContain("params: Promise<{ repoId: string }>");
  });

  it("generates metadata from model_name + author with short_desc/pipeline fallback", () => {
    expect(detailPage).toContain("generateMetadata");
    expect(detailPage).toContain("model_name");
    expect(detailPage).toContain("short_desc ||");
    expect(detailPage).toContain("pipeline_tag");
  });

  it("renders the stats row, license badge, pipeline tag, size, hf_url link, and last_modified", () => {
    expect(detailPage).toContain("toLocaleString()");
    expect(detailPage).toContain("m.hf_url");
    expect(detailPage).toContain('rel="noopener noreferrer"');
    expect(detailPage).toContain("size_mb");
    expect(detailPage).toContain("last_modified");
  });

  it("renders the gated note only when gated=1", () => {
    expect(detailPage).toContain("m.gated === 1");
    expect(detailPage).toContain("gated");
  });

  it("keeps a torrent section placeholder (Wave G fills it)", () => {
    expect(detailPage).toContain("TODO(Wave G)");
    expect(detailPage).toContain("getModelTorrent(");
  });

  it("browse page: empty state, trending section, filters, and pagination (locale-routed)", () => {
    expect(browsePage).toContain("emptyNotIndexedTitle");
    expect(browsePage).toContain("trendingNow");
    expect(browsePage).toContain("license");
    expect(browsePage).toContain("pipeline");
    expect(browsePage).toContain("t.next");
  });

  it("routes all /models pages copy through the modelsPage locale section", () => {
    expect(browsePage).toContain("getCopy(locale).modelsPage");
    expect(detailPage).toContain("getCopy(locale).modelsPage");
    const i18n = fs.readFileSync(path.join(process.cwd(), "lib", "i18n.ts"), "utf-8");
    expect(i18n).toContain("modelsPage");
  });
});

describe("malformed repoId guard", () => {
  it("decodeRepoId('a%2') falls back to the raw segment instead of throwing URIError", () => {
    expect(() => decodeURIComponent("a%2")).toThrow(URIError);
    expect(decodeRepoId("a%2")).toBe("a%2");
  });

  it("a page render with repoId 'a%2' hits notFound(), not a 500", async () => {
    insertModel({ repo_id: "acme/whisper-tiny" });
    const params = Promise.resolve({ repoId: "a%2" });
    // notFound() throws the Next.js 404 sentinel; a URIError escaping the decode
    // guard would surface as an unhandled 500 instead.
    await expect(ModelPage({ params })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK/);
    await expect(ModelPage({ params })).rejects.not.toThrow(/URI malformed/);
  });

  it("generateMetadata survives repoId 'a%2' and marks it noindex", async () => {
    const md = await generateMetadata({ params: Promise.resolve({ repoId: "a%2" }) });
    expect((md.robots as { index?: boolean }).index).toBe(false);
    expect(String(md.title)).toContain("Model not found");
  });
});

describe("robots + sitemap include models", () => {
  it("static robots.txt already allows /models (Allow: /)", () => {
    const robots = fs.readFileSync(path.join(process.cwd(), "public", "robots.txt"), "utf-8");
    expect(robots).toContain("Allow: /");
    expect(robots).not.toContain("Disallow: /models");
  });

  it("sitemap.ts emits /models and per-model URLs", () => {
    const sitemap = fs.readFileSync(path.join(process.cwd(), "app", "sitemap.ts"), "utf-8");
    expect(sitemap).toContain("/models");
    expect(sitemap).toContain("listModels");
    expect(sitemap).toContain("encodeURIComponent(m.repo_id)");
  });
});

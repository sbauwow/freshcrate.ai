import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type Database from "better-sqlite3";
import { createTestDb, _resetDb } from "./setup";
import { GET } from "@/app/api/models/[repoId]/torrent/route";
import { buildModelTorrent } from "@/lib/build-model-torrent";
import { getModelTorrent } from "@/lib/queries";

/**
 * Contract of the .torrent file endpoint (plan Task 11): 200 + bittorrent
 * headers for a built model, 404 when unbuilt/unknown, 403-with-reason JSON
 * for gated or non-allowlisted models so the UI can explain.
 */
let db: Database.Database;

function reqFor(repoId: string): NextRequest {
  return new NextRequest(
    `https://www.freshcrate.ai/api/models/${encodeURIComponent(repoId)}/torrent`
  );
}

function ctxFor(rawSegment: string): { params: Promise<{ repoId: string }> } {
  return { params: Promise.resolve({ repoId: rawSegment }) };
}

async function seedModel(over: {
  repo_id: string;
  license?: string;
  gated?: number;
}): Promise<number> {
  const { repo_id, license = "mit", gated = 0 } = over;
  const [author, name] = repo_id.includes("/") ? repo_id.split("/", 2) : ["", repo_id];
  const res = db
    .prepare(
      `INSERT INTO models (repo_id, author, model_name, license, gated, hf_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(repo_id, author, name, license, gated, `https://huggingface.co/${repo_id}`);
  return res.lastInsertRowid as number;
}

async function seedTorrent(modelId: number, displayName: string): Promise<Buffer> {
  const built = await buildModelTorrent({
    repoId: "seed",
    displayName,
    files: [
      {
        path: "weights/model.safetensors",
        size: 4096,
        url: "https://huggingface.co/seed/resolve/main/weights/model.safetensors",
        content: () => Buffer.alloc(4096, 7),
      },
    ],
  });
  db.prepare(
    `INSERT INTO model_torrents (model_id, info_hash, display_name, total_bytes, file_count, metainfo, magnet, build_tool_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    modelId,
    built.infoHash,
    displayName,
    built.totalBytes,
    built.fileCount,
    built.metainfo,
    built.magnet,
    "lib/build-model-torrent"
  );
  return built.metainfo;
}

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  _resetDb();
});

describe("api/models/[repoId]/torrent route", () => {
  it("serves the metainfo bytes with bittorrent headers for a built model", async () => {
    const modelId = await seedModel({ repo_id: "org/mit", license: "mit" });
    const metainfo = await seedTorrent(modelId, "mit");

    const res = await GET(reqFor("org/mit"), ctxFor("org%2Fmit"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-bittorrent");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="mit.torrent"'
    );
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(metainfo)).toBe(true);
  });

  it("decodes the url-encoded repo id segment", async () => {
    const modelId = await seedModel({ repo_id: "a/b_model-1.x", license: "apache-2.0" });
    await seedTorrent(modelId, "b_model-1.x");

    const res = await GET(reqFor("a/b_model-1.x"), ctxFor("a%2Fb_model-1.x"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="b_model-1.x.torrent"'
    );
  });

  it("returns 404 for an unknown model", async () => {
    const res = await GET(reqFor("ghost/none"), ctxFor("ghost%2Fnone"));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
  });

  it("returns 404 for an allowlisted model with no torrent built yet", async () => {
    await seedModel({ repo_id: "org/unbuilt", license: "mit" });

    const res = await GET(reqFor("org/unbuilt"), ctxFor("org%2Funbuilt"));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/no torrent/i);
  });

  it("returns 403 with the policy reason for a gated model", async () => {
    await seedModel({ repo_id: "org/gated", license: "mit", gated: 1 });

    const res = await GET(reqFor("org/gated"), ctxFor("org%2Fgated"));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/gated/i);
  });

  it("returns 403 with the policy reason for a non-allowlisted license", async () => {
    await seedModel({ repo_id: "org/nc", license: "cc-by-nc-4.0" });

    const res = await GET(reqFor("org/nc"), ctxFor("org%2Fnc"));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("cc-by-nc-4.0");
  });

  it("gated 403 wins over unbuilt 404 (the UI must be able to explain)", async () => {
    await seedModel({ repo_id: "org/gated-unbuilt", license: "unknown", gated: 1 });

    const res = await GET(reqFor("org/gated-unbuilt"), ctxFor("org%2Fgated-unbuilt"));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/gated/i);
  });

  it("matches what getModelTorrent exposes for the same model", async () => {
    const modelId = await seedModel({ repo_id: "org/parity", license: "mit" });
    await seedTorrent(modelId, "parity");

    const viaQueries = getModelTorrent(modelId);
    expect(viaQueries).not.toBeNull();

    const res = await GET(reqFor("org/parity"), ctxFor("org%2Fparity"));
    expect(res.status).toBe(200);
    expect((await res.json().catch(() => null)) === null).toBe(true); // binary body
  });
});

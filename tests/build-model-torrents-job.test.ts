import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup";
import {
  buildTorrentsForModels,
  selectTorrentCandidates,
  BUILD_TOOL_VERSION,
} from "@/lib/build-model-torrents-job";
import { hfFetchWithStatus } from "@/lib/hub-fetch";
import type { HfFetchResult } from "@/lib/hub-fetch";

/**
 * The job's Hub calls are mocked at the two seams the lib itself uses:
 * hfFetchWithStatus (detail + file tree) and global fetch (the resolve/main
 * content streams, which return deterministic Buffer-backed ReadableStreams).
 * Torrent hashing runs for real via lib/build-model-torrent.
 */
vi.mock("@/lib/hub-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hub-fetch")>();
  return { ...actual, hfFetchWithStatus: vi.fn() };
});

const hfMock = vi.mocked(hfFetchWithStatus);

const HF_ORIGIN = "https://huggingface.co";

// ---------- fixtures ----------

function patternBuf(size: number, seed = 0): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = (i + seed) % 251;
  return buf;
}

function streamResponse(buf: Buffer): Response {
  const CHUNK = 1 << 14;
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= buf.length) {
        controller.close();
        return;
      }
      const take = Math.min(CHUNK, buf.length - offset);
      controller.enqueue(new Uint8Array(buf.subarray(offset, offset + take)));
      offset += take;
    },
  });
  return new Response(stream, { status: 200 });
}

interface HubRoute {
  status: number;
  data: unknown;
}

/** Route hfFetchWithStatus by endpoint; unmapped endpoints return status 0. */
function mockHub(map: Record<string, HubRoute>) {
  const calls: { endpoint: string; token?: string }[] = [];
  hfMock.mockImplementation(async (endpoint: string, token?: string) => {
    calls.push({ endpoint, token });
    const hit = map[endpoint];
    if (!hit) return { status: 0, data: null } as HfFetchResult<never>;
    return { status: hit.status, data: hit.data ?? null } as HfFetchResult<never>;
  });
  return calls;
}

const detailEndpoint = (repoId: string) => `/api/models/${repoId}`;
const treeEndpoint = (repoId: string) => `/api/models/${repoId}/tree/main?recursive=true`;
const resolveUrl = (repoId: string, path: string) =>
  `${HF_ORIGIN}/${repoId}/resolve/main/${path.split("/").map(encodeURIComponent).join("/")}`;

function treeEntry(path: string, size: number): Record<string, unknown> {
  return { type: "file", oid: `git-${path}`, size, path, lfs: { size, pointerSize: 134 } };
}

function detailOk(): HubRoute {
  return { status: 200, data: { id: "x", gated: false, tags: ["license:mit"] } };
}

function seedModel(
  db: Database.Database,
  over: {
    repo_id: string;
    license?: string;
    gated?: number;
    downloads?: number;
    size_mb?: number | null;
  }
): number {
  const { repo_id, license = "mit", gated = 0, downloads = 0, size_mb = null } = over;
  const [author, name] = repo_id.includes("/") ? repo_id.split("/", 2) : ["", repo_id];
  const res = db
    .prepare(
      `INSERT INTO models (repo_id, author, model_name, license, downloads, gated, size_mb, hf_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(repo_id, author, name, license, downloads, gated, size_mb, `${HF_ORIGIN}/${repo_id}`);
  return res.lastInsertRowid as number;
}

function insertTorrentRow(db: Database.Database, modelId: number): void {
  db.prepare(
    `INSERT INTO model_torrents (model_id, info_hash, display_name, total_bytes, file_count, metainfo, magnet, build_tool_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(modelId, "0".repeat(40), "existing", 1, 1, Buffer.from("d4:infod4:zer e"), "magnet:?xt=urn:btih:" + "0".repeat(40), "legacy");
}

const MB = 1024 * 1024;

// ---------- tests ----------

describe("selectTorrentCandidates", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createTestDb();
  });

  it("keeps only allowlisted, non-gated, unbuilt, under-cap models, downloads DESC", () => {
    seedModel(db, { repo_id: "org/nc", license: "cc-by-nc-4.0", downloads: 600 });
    seedModel(db, { repo_id: "org/unknown", license: "unknown", downloads: 700 });
    seedModel(db, { repo_id: "org/gated", license: "mit", gated: 1, downloads: 800 });
    const builtId = seedModel(db, { repo_id: "org/built", license: "mit", downloads: 900 });
    insertTorrentRow(db, builtId);
    seedModel(db, { repo_id: "org/huge", license: "mit", size_mb: 25000, downloads: 850 });
    seedModel(db, { repo_id: "org/mit", license: "mit", downloads: 500 });
    seedModel(db, { repo_id: "org/apache", license: "apache-2.0", downloads: 400 });
    seedModel(db, { repo_id: "org/nullsize", license: "bsd-3-clause", size_mb: null, downloads: 300 });

    const picked = selectTorrentCandidates(db, { limit: 10, maxModelMb: 20000 });

    expect(picked.map((m) => m.repo_id)).toEqual(["org/mit", "org/apache", "org/nullsize"]);
  });

  it("respects the limit and deterministic ordering", () => {
    seedModel(db, { repo_id: "org/a", downloads: 100 });
    seedModel(db, { repo_id: "org/b", downloads: 300 });
    seedModel(db, { repo_id: "org/c", downloads: 200 });

    const picked = selectTorrentCandidates(db, { limit: 2, maxModelMb: 20000 });
    expect(picked.map((m) => m.repo_id)).toEqual(["org/b", "org/c"]);
  });

  it("re-selects models whose size_mb is known and under the cap", () => {
    seedModel(db, { repo_id: "org/small", size_mb: 42, downloads: 10 });
    const picked = selectTorrentCandidates(db, { limit: 10, maxModelMb: 20000 });
    expect(picked.map((m) => m.repo_id)).toEqual(["org/small"]);
  });
});

describe("buildTorrentsForModels", () => {
  let db: Database.Database;
  const savedFetch = global.fetch;

  beforeEach(() => {
    db = createTestDb();
    hfMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = savedFetch;
  });

  function mockResolve(
    contents: Record<string, Buffer>,
    opts: { log?: { url: string; authorization?: string; accept?: string }[] } = {}
  ): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = url.toString();
        const headers = (init?.headers ?? {}) as Record<string, string>;
        opts.log?.push({ url: u, authorization: headers.Authorization, accept: headers.Accept });
        const hit = Object.keys(contents).find((key) => key === u);
        if (!hit) return new Response("nope", { status: 404 });
        return streamResponse(contents[hit]);
      })
    );
  }

  it("builds a torrent from the filtered weight files and upserts it + size_mb", async () => {
    const modelId = seedModel(db, { repo_id: "org/mit", license: "mit", downloads: 99 });
    mockHub({
      [detailEndpoint("org/mit")]: detailOk(),
      [treeEndpoint("org/mit")]: {
        status: 200,
        data: [
          treeEntry("README.md", 500),
          treeEntry("config.json", 700),
          treeEntry("model-00001-of-00002.safetensors", 3 * MB),
          treeEntry("model-00002-of-00002.safetensors", 2 * MB),
        ],
      },
    });
    const fetchLog: { url: string; authorization?: string; accept?: string }[] = [];
    mockResolve(
      {
        [resolveUrl("org/mit", "model-00001-of-00002.safetensors")]: patternBuf(3 * MB, 1),
        [resolveUrl("org/mit", "model-00002-of-00002.safetensors")]: patternBuf(2 * MB, 2),
      },
      { log: fetchLog }
    );

    const result = await buildTorrentsForModels(db, { token: "hf_test_token" });

    expect(result.built).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.budgetExhausted).toBe(false);

    // Detail + tree went through hfFetchWithStatus with the token; only the
    // two weight files (not README/config) were streamed.
    expect(hfMock.mock.calls.map((c) => c[0])).toEqual([
      detailEndpoint("org/mit"),
      treeEndpoint("org/mit"),
    ]);
    expect(hfMock.mock.calls.every((c) => c[1] === "hf_test_token")).toBe(true);
    expect(fetchLog.map((c) => c.url)).toEqual([
      resolveUrl("org/mit", "model-00001-of-00002.safetensors"),
      resolveUrl("org/mit", "model-00002-of-00002.safetensors"),
    ]);
    expect(fetchLog.every((c) => c.authorization === "Bearer hf_test_token")).toBe(true);
    expect(fetchLog.every((c) => c.accept === "application/x-binary")).toBe(true);

    const row = db
      .prepare(
        `SELECT model_id, info_hash, display_name, total_bytes, file_count, magnet, metainfo, build_tool_version
         FROM model_torrents WHERE model_id = ?`
      )
      .get(modelId) as Record<string, unknown>;
    expect(row.model_id).toBe(modelId);
    expect(row.info_hash).toMatch(/^[0-9a-f]{40}$/);
    expect(row.display_name).toBe("mit");
    expect(row.total_bytes).toBe(5 * MB);
    expect(row.file_count).toBe(2);
    expect((row.magnet as string).startsWith(`magnet:?xt=urn:btih:${row.info_hash}`)).toBe(true);
    expect((row.metainfo as Buffer).subarray(0, 1).toString()).toBe("d");
    expect(row.build_tool_version).toBe(BUILD_TOOL_VERSION);

    const sizeMb = (db.prepare("SELECT size_mb FROM models WHERE id = ?").get(modelId) as { size_mb: number })
      .size_mb;
    expect(sizeMb).toBe(Math.round((5 * MB) / MB));
  });

  it("rejects a model that turns gated at the detail endpoint (belt+braces vs list data)", async () => {
    seedModel(db, { repo_id: "org/late-gated", license: "mit", downloads: 10 });
    mockHub({
      [detailEndpoint("org/late-gated")]: {
        status: 200,
        data: { id: "org/late-gated", gated: "auto" },
      },
      [treeEndpoint("org/late-gated")]: { status: 200, data: [treeEntry("m.safetensors", 100)] },
    });

    const result = await buildTorrentsForModels(db, {});

    expect(result.built).toBe(0);
    expect(result.skipped).toEqual([
      { repo_id: "org/late-gated", reason: expect.stringMatching(/gated/i) },
    ]);
    const rows = db.prepare("SELECT COUNT(*) AS c FROM model_torrents").get() as { c: number };
    expect(rows.c).toBe(0);
  });

  it("records a skip when detail or tree fetches fail and keeps the job going", async () => {
    seedModel(db, { repo_id: "org/net-fail", license: "mit", downloads: 30 });
    seedModel(db, { repo_id: "org/http-404", license: "mit", downloads: 20 });
    mockHub({
      [detailEndpoint("org/net-fail")]: { status: 0, data: null },
      [detailEndpoint("org/http-404")]: { status: 404, data: null },
      [treeEndpoint("org/http-404")]: { status: 200, data: [treeEntry("m.bin", 10)] },
    });

    const result = await buildTorrentsForModels(db, {});

    expect(result.built).toBe(0);
    expect(result.skipped).toEqual([
      { repo_id: "org/net-fail", reason: expect.stringMatching(/detail/i) },
      { repo_id: "org/http-404", reason: expect.stringMatching(/detail/i) },
    ]);
  });

  it("filters the tree to weight extensions and dedupes repeated paths", async () => {
    seedModel(db, { repo_id: "org/mixed", license: "mit", downloads: 10 });
    mockHub({
      [detailEndpoint("org/mixed")]: detailOk(),
      [treeEndpoint("org/mixed")]: {
        status: 200,
        data: [
          treeEntry("README.md", 500),
          treeEntry("config.json", 700),
          treeEntry("model.safetensors", 4096),
          { type: "file", oid: "dup", size: 4096, path: "model.safetensors" },
          treeEntry("sub/model.gguf", 2048),
          treeEntry("weights/foo.onnx", 1024),
          treeEntry("legacy/old.ckpt", 512),
          treeEntry("pytorch_model.bin", 256),
          treeEntry("params.pth", 128),
          { type: "directory", path: "sub", size: 0 },
        ],
      },
    });
    const fetchLog: { url: string }[] = [];
    mockResolve(
      {
        [resolveUrl("org/mixed", "model.safetensors")]: patternBuf(4096, 3),
        [resolveUrl("org/mixed", "sub/model.gguf")]: patternBuf(2048, 4),
        [resolveUrl("org/mixed", "weights/foo.onnx")]: patternBuf(1024, 5),
        [resolveUrl("org/mixed", "legacy/old.ckpt")]: patternBuf(512, 6),
        [resolveUrl("org/mixed", "pytorch_model.bin")]: patternBuf(256, 7),
        [resolveUrl("org/mixed", "params.pth")]: patternBuf(128, 8),
      },
      { log: fetchLog }
    );

    const result = await buildTorrentsForModels(db, {});

    expect(result.built).toBe(1);
    expect(fetchLog.map((c) => c.url)).toEqual([
      resolveUrl("org/mixed", "model.safetensors"),
      resolveUrl("org/mixed", "sub/model.gguf"),
      resolveUrl("org/mixed", "weights/foo.onnx"),
      resolveUrl("org/mixed", "legacy/old.ckpt"),
      resolveUrl("org/mixed", "pytorch_model.bin"),
      resolveUrl("org/mixed", "params.pth"),
    ]);
    const row = db.prepare("SELECT file_count, total_bytes FROM model_torrents").get() as {
      file_count: number;
      total_bytes: number;
    };
    expect(row.file_count).toBe(6);
    expect(row.total_bytes).toBe(4096 + 2048 + 1024 + 512 + 256 + 128);
  });

  it("skips when the tree has no weight files or the weights exceed the size cap", async () => {
    seedModel(db, { repo_id: "org/no-weights", license: "mit", downloads: 30 });
    seedModel(db, { repo_id: "org/too-big", license: "mit", downloads: 20 });
    mockHub({
      [detailEndpoint("org/no-weights")]: detailOk(),
      [treeEndpoint("org/no-weights")]: {
        status: 200,
        data: [treeEntry("README.md", 500), treeEntry("config.json", 700)],
      },
      [detailEndpoint("org/too-big")]: detailOk(),
      [treeEndpoint("org/too-big")]: {
        status: 200,
        data: [treeEntry("big.safetensors", 3 * MB)],
      },
    });

    const result = await buildTorrentsForModels(db, { maxModelMb: 2 });

    expect(result.built).toBe(0);
    expect(result.skipped).toEqual([
      { repo_id: "org/no-weights", reason: expect.stringMatching(/no weight file/i) },
      { repo_id: "org/too-big", reason: expect.stringMatching(/exceed/i) },
    ]);
  });

  it("aborts a size-mismatched model without killing the job", async () => {
    seedModel(db, { repo_id: "org/under", license: "mit", downloads: 30 });
    seedModel(db, { repo_id: "org/over", license: "mit", downloads: 20 });
    seedModel(db, { repo_id: "org/good", license: "mit", downloads: 10 });
    mockHub({
      [detailEndpoint("org/under")]: detailOk(),
      [treeEndpoint("org/under")]: { status: 200, data: [treeEntry("a.safetensors", 1000)] },
      [detailEndpoint("org/over")]: detailOk(),
      [treeEndpoint("org/over")]: { status: 200, data: [treeEntry("b.safetensors", 1000)] },
      [detailEndpoint("org/good")]: detailOk(),
      [treeEndpoint("org/good")]: { status: 200, data: [treeEntry("c.safetensors", 1000)] },
    });
    mockResolve({
      [resolveUrl("org/under", "a.safetensors")]: patternBuf(500, 9), // truncated stream
      [resolveUrl("org/over", "b.safetensors")]: patternBuf(1100, 10), // over-long stream
      [resolveUrl("org/good", "c.safetensors")]: patternBuf(1000, 11),
    });

    const result = await buildTorrentsForModels(db, {});

    expect(result.built).toBe(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/^org\/under: .*size mismatch/i);
    expect(result.errors[1]).toMatch(/^org\/over: .*size mismatch/i);

    const built = db
      .prepare("SELECT m.repo_id FROM model_torrents t JOIN models m ON m.id = t.model_id")
      .all() as Array<{ repo_id: string }>;
    expect(built.map((r) => r.repo_id)).toEqual(["org/good"]);
  });

  it("records an error when a resolve fetch fails, without killing the job", async () => {
    seedModel(db, { repo_id: "org/forbidden", license: "mit", downloads: 5 });
    mockHub({
      [detailEndpoint("org/forbidden")]: detailOk(),
      [treeEndpoint("org/forbidden")]: { status: 200, data: [treeEntry("x.safetensors", 64)] },
    });
    // No resolve mapping -> the fetch mock returns 404 (gated-file style).
    mockResolve({});

    const result = await buildTorrentsForModels(db, {});

    expect(result.built).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^org\/forbidden: .*HTTP 404/);
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM model_torrents").get() as { c: number }).c
    ).toBe(0);
  });

  it("dry mode runs selection + detail/tree checks but fetches no content and writes nothing", async () => {
    seedModel(db, { repo_id: "org/dry", license: "mit", downloads: 10 });
    mockHub({
      [detailEndpoint("org/dry")]: detailOk(),
      [treeEndpoint("org/dry")]: {
        status: 200,
        data: [treeEntry("w.safetensors", 2048), treeEntry("x.gguf", 1024)],
      },
    });
    const fetchLog: { url: string }[] = [];
    mockResolve({ "anything": Buffer.alloc(1) }, { log: fetchLog });

    const result = await buildTorrentsForModels(db, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.built).toBe(0);
    expect(result.wouldBuild).toEqual([
      { repo_id: "org/dry", file_count: 2, total_bytes: 2048 + 1024 },
    ]);
    expect(fetchLog).toEqual([]);
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM model_torrents").get() as { c: number }).c
    ).toBe(0);
    expect(
      (db.prepare("SELECT size_mb FROM models WHERE repo_id = 'org/dry'").get() as { size_mb: number | null })
        .size_mb
    ).toBeNull();
  });

  it("stops at the budget with partial results and reports progress", async () => {
    seedModel(db, { repo_id: "org/one", license: "mit", downloads: 30 });
    seedModel(db, { repo_id: "org/two", license: "mit", downloads: 20 });
    seedModel(db, { repo_id: "org/three", license: "mit", downloads: 10 });
    const map: Record<string, HubRoute> = {};
    for (const repo of ["org/one", "org/two", "org/three"]) {
      map[detailEndpoint(repo)] = detailOk();
      map[treeEndpoint(repo)] = { status: 200, data: [treeEntry("w.safetensors", 1000)] };
    }
    mockHub(map);
    mockResolve({
      [resolveUrl("org/one", "w.safetensors")]: patternBuf(1000, 12),
      [resolveUrl("org/two", "w.safetensors")]: patternBuf(1000, 13),
      [resolveUrl("org/three", "w.safetensors")]: patternBuf(1000, 14),
    });

    // Injected clock: start=0, models 1 and 2 pass their checks (1, 2 < 5000),
    // after model 2 elapses past the budget (5001) the loop stops with
    // model 3 unbuilt.
    let tick = 0;
    const clock = [0, 1, 2, 5001];
    const progress: unknown[] = [];

    const result = await buildTorrentsForModels(db, {
      budgetMs: 5000,
      now: () => clock[Math.min(tick++, clock.length - 1)],
      onProgress: (p) => progress.push(p),
    });

    expect(result.selected).toBe(3);
    expect(result.built).toBe(2);
    expect(result.budgetExhausted).toBe(true);
    expect(progress.length).toBeGreaterThan(0);
    const built = db
      .prepare("SELECT m.repo_id FROM model_torrents t JOIN models m ON m.id = t.model_id")
      .all() as Array<{ repo_id: string }>;
    expect(built.map((r) => r.repo_id)).toEqual(["org/one", "org/two"]);
  });

  it("builds nothing and reports budgetExhausted when the budget is already spent", async () => {
    seedModel(db, { repo_id: "org/none", license: "mit", downloads: 1 });
    const hubCalls = mockHub({});
    mockResolve({});

    const result = await buildTorrentsForModels(db, { budgetMs: 0 });

    expect(result.built).toBe(0);
    expect(result.budgetExhausted).toBe(true);
    expect(hubCalls).toEqual([]);
  });

  it("uses preselected candidates when provided (fire-and-forget route path)", async () => {
    const modelId = seedModel(db, { repo_id: "org/pre", license: "mit", downloads: 1 });
    const candidates = selectTorrentCandidates(db, { limit: 10, maxModelMb: 20000 });
    mockHub({
      [detailEndpoint("org/pre")]: detailOk(),
      [treeEndpoint("org/pre")]: { status: 200, data: [treeEntry("p.safetensors", 512)] },
    });
    mockResolve({ [resolveUrl("org/pre", "p.safetensors")]: patternBuf(512, 15) });

    const result = await buildTorrentsForModels(db, { candidates });

    expect(result.selected).toBe(1);
    expect(result.built).toBe(1);
    expect(
      (db.prepare("SELECT model_id FROM model_torrents").get() as { model_id: number }).model_id
    ).toBe(modelId);
  });
});

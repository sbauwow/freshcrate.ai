import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import Database from "better-sqlite3";
import { createTestDb, _resetDb } from "./setup";
import { GET, POST } from "@/app/api/cron/build-model-torrents/route";
import {
  selectTorrentCandidates,
  buildTorrentsForModels,
} from "@/lib/build-model-torrents-job";
import type { TorrentCandidate } from "@/lib/build-model-torrents-job";

// The route must never hit the real Hugging Face Hub in tests; the job's own
// behavior is covered by tests/build-model-torrents-job.test.ts — this file
// tests the route contract only (secret gate + query-param forwarding +
// fire-and-forget vs sync modes).
vi.mock("@/lib/build-model-torrents-job", () => ({
  selectTorrentCandidates: vi.fn(),
  buildTorrentsForModels: vi.fn(),
}));

const selectMock = vi.mocked(selectTorrentCandidates);
const buildMock = vi.mocked(buildTorrentsForModels);

const CANDIDATES: TorrentCandidate[] = [
  {
    id: 1,
    repo_id: "org/mit",
    author: "org",
    model_name: "mit",
    license: "mit",
    gated: 0,
    downloads: 100,
    size_mb: null,
  },
];

let db: Database.Database;
const savedCronSecret = process.env.CRON_SECRET;
const savedHfToken = process.env.HF_TOKEN;

function req(
  query = "",
  method: "GET" | "POST" = "GET",
  auth?: string
): NextRequest {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers.authorization = auth;
  return new NextRequest(
    `https://www.freshcrate.ai/api/cron/build-model-torrents${query}`,
    { method, headers }
  );
}

beforeEach(() => {
  db = createTestDb();
  selectMock.mockReset().mockReturnValue([...CANDIDATES]);
  buildMock.mockReset().mockResolvedValue({
    selected: CANDIDATES.length,
    built: 1,
    wouldBuild: [],
    skipped: [],
    errors: [],
    budgetExhausted: false,
    dryRun: false,
  });
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.HF_TOKEN;
});

afterEach(() => {
  _resetDb();
  if (savedCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedCronSecret;
  if (savedHfToken === undefined) delete process.env.HF_TOKEN;
  else process.env.HF_TOKEN = savedHfToken;
});

describe("api/cron/build-model-torrents route", () => {
  it("returns 503 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(req("?dry=1"));

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/CRON_SECRET/);
    expect(selectMock).not.toHaveBeenCalled();
    expect(buildMock).not.toHaveBeenCalled();
  });

  it("returns 401 on a wrong bearer token and runs nothing", async () => {
    const res = await GET(req("", "GET", "Bearer wrong-secret"));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(selectMock).not.toHaveBeenCalled();
    expect(buildMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the authorization header is missing", async () => {
    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("queues a fire-and-forget build and answers with the candidate count", async () => {
    let resolveBuild!: (v: Awaited<ReturnType<typeof buildTorrentsForModels>>) => void;
    buildMock.mockReturnValue(
      new Promise((resolve) => {
        resolveBuild = resolve;
      })
    );

    const res = await GET(req("", "GET", "Bearer test-cron-secret"));
    const body = await res.json();

    // The response is sent while the (streaming, potentially minutes-long)
    // build is still running.
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, mode: "queued", queued: 1, dryRun: false });
    expect(body.built).toBeUndefined();
    expect(buildMock).toHaveBeenCalledTimes(1);

    resolveBuild({
      selected: 1,
      built: 1,
      wouldBuild: [],
      skipped: [],
      errors: [],
      budgetExhausted: false,
      dryRun: false,
    });
    // Let the background continuation settle; nothing should throw.
    await new Promise((r) => setTimeout(r, 0));
  });

  it("does not fail the request when the background build rejects", async () => {
    buildMock.mockRejectedValue(new Error("background boom"));

    const res = await GET(req("", "GET", "Bearer test-cron-secret"));

    // The catch-all around the detached loop must keep the rejection from
    // surfacing as an unhandled rejection that would crash the container.
    expect(res.status).toBe(200);
    expect((await res.json()).queued).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
  });

  it("passes the test DB, defaults and preselected candidates to the job", async () => {
    const res = await GET(req("", "GET", "Bearer test-cron-secret"));

    expect(res.status).toBe(200);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(selectMock.mock.calls[0][0]).toBe(db); // explicit test DB
    expect(selectMock.mock.calls[0][1]).toEqual({ limit: 10, maxModelMb: 20000 });
    expect(buildMock.mock.calls[0][0]).toBe(db);
    expect(buildMock.mock.calls[0][1]).toMatchObject({
      limit: 10,
      maxModelMb: 20000,
      budgetMs: 240000,
      token: undefined,
      dryRun: false,
    });
    expect(buildMock.mock.calls[0]?.[1]?.candidates).toEqual(CANDIDATES);
  });

  it("passes HF_TOKEN through as the job token", async () => {
    process.env.HF_TOKEN = "hf_test_token";

    const res = await GET(req("", "GET", "Bearer test-cron-secret"));

    expect(res.status).toBe(200);
    expect(buildMock.mock.calls[0][1]).toMatchObject({ token: "hf_test_token" });
  });

  it("maps limit/max_model_mb/budget_ms params into the job opts", async () => {
    const res = await GET(
      req("?limit=3&max_model_mb=5000&budget_ms=120000", "GET", "Bearer test-cron-secret")
    );

    expect(res.status).toBe(200);
    expect(selectMock.mock.calls[0][1]).toEqual({ limit: 3, maxModelMb: 5000 });
    expect(buildMock.mock.calls[0][1]).toMatchObject({
      limit: 3,
      maxModelMb: 5000,
      budgetMs: 120000,
    });
  });

  it("dry=1 runs the job synchronously and returns the would-build list", async () => {
    buildMock.mockResolvedValue({
      selected: 1,
      built: 0,
      wouldBuild: [{ repo_id: "org/mit", file_count: 2, total_bytes: 3072 }],
      skipped: [],
      errors: [],
      budgetExhausted: false,
      dryRun: true,
    });

    const res = await GET(req("?dry=1", "GET", "Bearer test-cron-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.mode).toBe("sync");
    expect(body.dryRun).toBe(true);
    expect(body.wouldBuild).toEqual([
      { repo_id: "org/mit", file_count: 2, total_bytes: 3072 },
    ]);
    expect(buildMock.mock.calls[0][1]).toMatchObject({ dryRun: true });
  });

  it("sync=1 awaits the full build result", async () => {
    const res = await GET(req("?sync=1", "GET", "Bearer test-cron-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, mode: "sync", built: 1 });
  });

  it("POST shares the same contract as GET", async () => {
    const res = await POST(req("?dry=1", "POST", "Bearer test-cron-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("sync");
    expect(buildMock).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("returns 500 with the error message when candidate selection throws", async () => {
    selectMock.mockImplementation(() => {
      throw new Error("db locked");
    });

    const res = await GET(req("", "GET", "Bearer test-cron-secret"));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("db locked");
    expect(buildMock).not.toHaveBeenCalled();
  });
});

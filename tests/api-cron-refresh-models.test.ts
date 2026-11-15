import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import Database from "better-sqlite3";
import { createTestDb, _resetDb } from "./setup";
import { GET, POST } from "@/app/api/cron/refresh-models/route";
import { refreshModels } from "@/lib/refresh-models";

// The route must never hit the real Hugging Face Hub in tests; the lib's own
// behavior is covered by tests/refresh-models.test.ts — this file tests the
// route contract only (secret gate + query-param forwarding).
vi.mock("@/lib/refresh-models", () => ({
  refreshModels: vi.fn(),
}));

const refreshModelsMock = vi.mocked(refreshModels);

const MOCK_RESULT = { fetched: 0, upserted: 0, errors: [], budgetExhausted: false };

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
    `https://www.freshcrate.ai/api/cron/refresh-models${query}`,
    { method, headers }
  );
}

beforeEach(() => {
  db = createTestDb();
  refreshModelsMock.mockReset();
  refreshModelsMock.mockResolvedValue({ ...MOCK_RESULT });
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

describe("api/cron/refresh-models route", () => {
  it("returns 503 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(req("?dry=1"));

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/CRON_SECRET/);
    expect(refreshModelsMock).not.toHaveBeenCalled();
  });

  it("returns 401 on a wrong bearer token and runs nothing", async () => {
    const res = await GET(req("", "GET", "Bearer wrong-secret"));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(refreshModelsMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the authorization header is missing", async () => {
    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(refreshModelsMock).not.toHaveBeenCalled();
  });

  it("returns ok on a valid secret and forwards the defaults", async () => {
    const res = await GET(req("", "GET", "Bearer test-cron-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.fetched).toBe(0);
    expect(body.budgetExhausted).toBe(false);
    expect(refreshModelsMock).toHaveBeenCalledTimes(1);
    expect(refreshModelsMock.mock.calls[0][0]).toBe(db); // explicit test DB
    expect(refreshModelsMock.mock.calls[0][1]).toEqual({
      pages: 3,
      token: undefined,
      dryRun: false,
      budgetMs: 240000,
    });
  });

  it("passes HF_TOKEN through as the lib token", async () => {
    process.env.HF_TOKEN = "hf_test_token";

    const res = await GET(req("", "GET", "Bearer test-cron-secret"));

    expect(res.status).toBe(200);
    expect(refreshModelsMock.mock.calls[0][1]).toMatchObject({
      token: "hf_test_token",
    });
  });

  it("maps dry=1 to dryRun:true and parses pages/budget_ms params", async () => {
    const res = await GET(
      req("?dry=1&pages=5&budget_ms=120000", "GET", "Bearer test-cron-secret")
    );

    expect(res.status).toBe(200);
    expect(refreshModelsMock.mock.calls[0][1]).toMatchObject({
      dryRun: true,
      pages: 5,
      budgetMs: 120000,
    });
  });

  it("POST shares the same contract as GET", async () => {
    const res = await POST(req("?dry=1", "POST", "Bearer test-cron-secret"));

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(refreshModelsMock).toHaveBeenCalledTimes(1);
    expect(refreshModelsMock.mock.calls[0][1]).toMatchObject({
      dryRun: true,
      pages: 3,
      budgetMs: 240000,
    });
  });

  it("returns 500 with the error message when refreshModels throws", async () => {
    refreshModelsMock.mockRejectedValue(new Error("hub down"));

    const res = await GET(req("", "GET", "Bearer test-cron-secret"));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("hub down");
  });
});

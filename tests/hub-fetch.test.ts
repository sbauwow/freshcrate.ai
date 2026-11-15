import { describe, it, expect, afterEach, vi } from "vitest";
import { hfFetch, HUB_ORIGIN } from "@/lib/hub-fetch";

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("hfFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed JSON on a 200 response", async () => {
    const payload = [{ id: "org/model", downloads: 5 }];
    mockFetch(async () =>
      new Response(JSON.stringify(payload), { status: 200 })
    );

    const result = await hfFetch<typeof payload>("/api/models?limit=1");
    expect(result).toEqual(payload);
  });

  it("returns null on a non-200 response", async () => {
    mockFetch(async () => new Response("rate limited", { status: 429 }));

    const result = await hfFetch<{ id: string }>("/api/models?limit=1");
    expect(result).toBeNull();
  });

  it("returns null when fetch rejects", async () => {
    mockFetch(async () => {
      throw new Error("network down");
    });

    const result = await hfFetch<{ id: string }>("/api/models?limit=1");
    expect(result).toBeNull();
  });

  it("sends an Authorization Bearer header only when a token is provided", async () => {
    const fn = mockFetch(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await hfFetch("/api/models?limit=1", "hf_test_token");
    const headersWithToken = fn.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headersWithToken.Authorization).toBe("Bearer hf_test_token");

    await hfFetch("/api/models?limit=1");
    const headersNoToken = fn.mock.calls[1][1]?.headers as Record<string, string>;
    expect(headersNoToken.Authorization).toBeUndefined();
  });

  it("prefixes the endpoint with HUB_ORIGIN", async () => {
    const fn = mockFetch(async () =>
      new Response(JSON.stringify([]), { status: 200 })
    );

    await hfFetch("/api/models?limit=1");
    expect(fn.mock.calls[0][0]).toBe(`${HUB_ORIGIN}/api/models?limit=1`);
    expect(HUB_ORIGIN).toBe("https://huggingface.co");
  });
});

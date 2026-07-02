import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy, shouldReturnGone } from "@/proxy";

describe("proxy gone-path gates", () => {
  it("returns gone for phantom project docs paths", () => {
    expect(shouldReturnGone("/projects/foo/docs/readme")).toBe(true);
    expect(shouldReturnGone("/projects/foo/.github/workflows/ci.yml")).toBe(true);
    expect(shouldReturnGone("/projects/foo/README-install")).toBe(true);
  });

  it("returns gone for hostile scanner probe paths", () => {
    expect(shouldReturnGone("/.env")).toBe(true);
    expect(shouldReturnGone("/.env.production")).toBe(true);
    expect(shouldReturnGone("/.git/config")).toBe(true);
    expect(shouldReturnGone("/wp-admin/install.php")).toBe(true);
    expect(shouldReturnGone("/wp-login.php")).toBe(true);
    expect(shouldReturnGone("/xmlrpc.php")).toBe(true);
    expect(shouldReturnGone("/adminer.php")).toBe(true);
  });

  it("does not catch legitimate app routes", () => {
    expect(shouldReturnGone("/")).toBe(false);
    expect(shouldReturnGone("/browse")).toBe(false);
    expect(shouldReturnGone("/search")).toBe(false);
    expect(shouldReturnGone("/projects/jcodemunch-mcp")).toBe(false);
    expect(shouldReturnGone("/projects/foo.md")).toBe(false);
  });
});

describe("proxy spoofed-chrome gate", () => {
  const SPOOFED_UA = "Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.100 Safari/537.36";

  it("429s chrome UAs that send neither sec-ch-ua nor sec-fetch headers", () => {
    const res = proxy(
      new NextRequest("https://www.freshcrate.ai/projects/foo", {
        headers: { "user-agent": SPOOFED_UA, accept: "text/html" },
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("x-fc-gate")).toBe("spoofed-ua");
  });

  it("passes real chrome traffic that sends client hints", () => {
    const res = proxy(
      new NextRequest("https://www.freshcrate.ai/projects/foo", {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
          accept: "text/html",
          "accept-language": "en-US,en;q=0.9",
          "sec-ch-ua": '"Chromium";v="133", "Not(A:Brand";v="24"',
          "sec-fetch-mode": "navigate",
        },
      }),
    );
    expect(res.status).not.toBe(429);
  });
});

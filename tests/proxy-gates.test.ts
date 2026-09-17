import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy, shouldReturnGone, scopedRedirectTarget } from "@/proxy";

describe("proxy gone-path gates", () => {
  it("returns gone for any multi-segment /projects/<x>/<y> phantom path", () => {
    expect(shouldReturnGone("/projects/foo/docs/readme")).toBe(true);
    expect(shouldReturnGone("/projects/foo/.github/workflows/ci.yml")).toBe(true);
    expect(shouldReturnGone("/projects/foo/README-install")).toBe(true);
    // README-relative leaks observed in production logs:
    expect(shouldReturnGone("/projects/docs/mc-square.md")).toBe(true);
    expect(shouldReturnGone("/projects/examples/multimodal_chat.py")).toBe(true);
    expect(shouldReturnGone("/projects/js/packages/phoenix-mcp/README.md")).toBe(true);
    expect(shouldReturnGone("/projects/foo.yaml.example")).toBe(true);
  });

  it("returns gone for hostile scanner probe paths (incl. non-root)", () => {
    expect(shouldReturnGone("/.env")).toBe(true);
    expect(shouldReturnGone("/.env.production")).toBe(true);
    expect(shouldReturnGone("/app/.env")).toBe(true);
    expect(shouldReturnGone("/.git/config")).toBe(true);
    expect(shouldReturnGone("/wp-admin/install.php")).toBe(true);
    expect(shouldReturnGone("/wp-login.php")).toBe(true);
    expect(shouldReturnGone("/xmlrpc.php")).toBe(true);
    expect(shouldReturnGone("/adminer.php")).toBe(true);
    // Newly covered: arbitrary PHP, wp-config, /var/www, deep .env
    expect(shouldReturnGone("/x.php")).toBe(true);
    expect(shouldReturnGone("/var/www/html/wp-config.php")).toBe(true);
    expect(shouldReturnGone("/wp-content/plugins/hellopress/wp_filemanager.php")).toBe(true);
    expect(shouldReturnGone("/this_is_a_new_hello_world.php")).toBe(true);
  });

  it("does not catch legitimate app routes", () => {
    expect(shouldReturnGone("/")).toBe(false);
    expect(shouldReturnGone("/browse")).toBe(false);
    expect(shouldReturnGone("/search")).toBe(false);
    expect(shouldReturnGone("/projects/jcodemunch-mcp")).toBe(false);
    expect(shouldReturnGone("/projects/foo.md")).toBe(false);
    // Project names that merely contain probe-ish substrings must survive:
    expect(shouldReturnGone("/projects/xmlrpc-client")).toBe(false);
    expect(shouldReturnGone("/projects/adminer-ui")).toBe(false);
    expect(shouldReturnGone("/projects/wp-config-helper")).toBe(false);
    expect(shouldReturnGone("/author/N2")).toBe(false);
    expect(shouldReturnGone("/tag/typescript")).toBe(false);
  });
});

describe("scoped-name canonicalization", () => {
  it("maps raw-slash scoped names to the encoded single segment", () => {
    expect(scopedRedirectTarget("/projects/@vercel/detect-agent")).toBe(
      "/projects/%40vercel%2Fdetect-agent",
    );
    expect(scopedRedirectTarget("/projects/@nodeloom/sdk")).toBe("/projects/%40nodeloom%2Fsdk");
  });

  it("ignores non-scoped and deeper paths", () => {
    expect(scopedRedirectTarget("/projects/plain-name")).toBeNull();
    expect(scopedRedirectTarget("/projects/@scope/pkg/extra")).toBeNull();
  });

  it("proxy 308-redirects raw scoped names before the phantom gate", () => {
    const res = proxy(
      new NextRequest("https://www.freshcrate.ai/projects/@vercel/detect-agent", {
        headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
      }),
    );
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toContain("/projects/%40vercel%2Fdetect-agent");
  });
});

describe("markdown alternate Link header", () => {
  const CHROME = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    accept: "text/html",
    "sec-ch-ua": '"Chromium";v="133"',
    "sec-fetch-mode": "navigate",
  };

  it("advertises /projects/<name>.md on crate pages", () => {
    const res = proxy(new NextRequest("https://www.freshcrate.ai/projects/vllm", { headers: CHROME }));
    expect(res.headers.get("link")).toBe('</projects/vllm.md>; rel="alternate"; type="text/markdown"');
  });

  it("does not set it on the .md route itself or non-crate pages", () => {
    const md = proxy(new NextRequest("https://www.freshcrate.ai/projects/vllm.md", { headers: CHROME }));
    expect(md.headers.get("link")).toBeNull();
    const home = proxy(new NextRequest("https://www.freshcrate.ai/browse", { headers: CHROME }));
    expect(home.headers.get("link")).toBeNull();
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

describe("deploy-static nav conditional GET", () => {
  const GPTBOT = { "user-agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot" };
  const url = (p: string) => `https://www.freshcrate.ai${p}`;

  function tagFor(path: string, headers: Record<string, string> = GPTBOT) {
    const res = proxy(new NextRequest(url(path), { headers }));
    return res.headers.get("etag");
  }

  it("stamps an ETag and a revalidating Cache-Control on deploy-static routes", () => {
    const res = proxy(new NextRequest(url("/learn"), { headers: GPTBOT }));
    expect(res.headers.get("etag")).toMatch(/^W\/"/);
    expect(res.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    // Vary is intentionally NOT set on the 200: Next overwrites it with its own
    // router list downstream, which is what keeps HTML and RSC payloads apart.
    expect(res.headers.get("vary")).toBeNull();
  });

  it("leaves DB-backed routes untouched so a deploy-scoped tag can't pin stale data", () => {
    for (const path of ["/", "/browse", "/stats", "/security", "/mcp", "/legislation"]) {
      const res = proxy(new NextRequest(url(path), { headers: GPTBOT }));
      expect(res.headers.get("etag")).toBeNull();
      expect(res.headers.get("cache-control")).toBeNull();
    }
  });

  it("304s a matching If-None-Match with no body", async () => {
    const etag = tagFor("/api")!;
    const res = proxy(
      new NextRequest(url("/api"), { headers: { ...GPTBOT, "if-none-match": etag } }),
    );
    expect(res.status).toBe(304);
    expect(res.headers.get("x-fc-gate")).toBe("static-nav-304");
    expect(res.headers.get("etag")).toBe(etag);
    expect(await res.text()).toBe("");
  });

  it("matches weakly, across a list, and on '*'", () => {
    const etag = tagFor("/api")!;
    const strong = etag.replace(/^W\//, "");
    for (const inm of [strong, `"other", ${etag}`, "*"]) {
      const res = proxy(new NextRequest(url("/api"), { headers: { ...GPTBOT, "if-none-match": inm } }));
      expect(res.status).toBe(304);
    }
  });

  it("does not 304 a tag from another page, locale, or theme", () => {
    const enModern = tagFor("/api", { ...GPTBOT, cookie: "fc_lang=en; fc_theme=modern" })!;
    expect(tagFor("/learn", { ...GPTBOT, cookie: "fc_lang=en; fc_theme=modern" })).not.toBe(enModern);
    expect(tagFor("/api", { ...GPTBOT, cookie: "fc_lang=zh-CN; fc_theme=modern" })).not.toBe(enModern);
    expect(tagFor("/api", { ...GPTBOT, cookie: "fc_lang=en; fc_theme=retro" })).not.toBe(enModern);

    // A zh-CN reader holding the English tag must get fresh HTML, not a 304.
    const res = proxy(
      new NextRequest(url("/api"), {
        headers: { ...GPTBOT, cookie: "fc_lang=zh-CN", "if-none-match": enModern },
      }),
    );
    expect(res.status).not.toBe(304);
  });

  // Deliberately NOT tested here: "an RSC navigation must not 304". Next strips
  // both the `RSC` header and the `_rsc` query param before middleware runs, so
  // such a test can only pass under vitest — which strips nothing — while the
  // guard it covers does nothing in production. Correctness for RSC requests
  // comes from per-URL validators plus Next's own Vary; see proxy.ts.

  it("keys the tag on the deploy, so shipping invalidates every static route", () => {
    // Same process, so DEPLOY_ID is fixed — assert the shape that carries it
    // rather than restarting with a different env.
    expect(tagFor("/terms")).toContain("-/terms");
    expect(tagFor("/terms")).toMatch(/^W\/"[^-]+-en-retro-/);
  });

  it("sets the full Vary, including Cookie, on the 304 it constructs itself", () => {
    const res = proxy(
      new NextRequest(url("/api"), { headers: { ...GPTBOT, "if-none-match": tagFor("/api")! } }),
    );
    expect(res.status).toBe(304);
    expect(res.headers.get("vary")).toContain("rsc");
    expect(res.headers.get("vary")).toContain("Cookie");
  });

  it("still rejects a spoofed UA that presents a valid tag", () => {
    const res = proxy(
      new NextRequest(url("/api"), {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.100 Safari/537.36",
          accept: "text/html",
          "if-none-match": tagFor("/api")!,
        },
      }),
    );
    expect(res.status).toBe(429);
  });
});

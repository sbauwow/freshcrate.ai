import { NextRequest, NextResponse } from "next/server";
import { classifyTraffic } from "@/lib/traffic-classification";
import { LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n";
import { THEME_COOKIE, normalizeTheme } from "@/lib/theme";

/**
 * Next.js Proxy (Edge runtime) — runs on every non-static request.
 *
 * Emits a single `request_in` JSON log only for paths that won't produce a
 * paired completion log elsewhere. The pairing rules:
 *   - /api/*                 → keep request_in (logRequest emits the paired
 *                              `request` line on success; entry log is the
 *                              only signal if the handler crashes mid-flight).
 *   - page + browser_shaped  → suppress (a JS-executing client will fire the
 *                              /api/beacon pixel and record the page_view;
 *                              emitting here too would double-count the ones
 *                              that do, and pegs Railway's 500-logs/sec cap).
 *   - page + bot/api_client  → keep (no beacon fires for these clients).
 *   - page + browser_unverified → keep. Not firing the beacon is most of why
 *                              they are unverified, so the entry log is the
 *                              only record we get of them.
 *
 * No PII: raw IP is never logged here, just whether one was present.
 */

const STATIC_RE = /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|eot|map|xml|txt)$/i;
const SKIP_PREFIXES = ["/_next/", "/api/beacon"]; // beacon has its own log path

// Bots scrape README links and walk repo-relative paths that never existed
// under our route. Only /projects/<name> and /projects/<name>.md are real, so
// ANY multi-segment /projects/<x>/<y>... path (docs/, examples/, packages/,
// nested READMEs, *.md/*.py/... files) is a phantom — 410 Gone so crawlers drop
// it and we skip the React 404 render. Real scoped names (@scope/pkg) arrive
// URL-encoded as one segment and are unaffected; raw-slash scoped links are
// canonicalized by the redirect in proxy() before this gate runs.
const PHANTOM_PROJECT_RE = /^\/projects\/[^/]+\/.+/i;

// Repo-file refs that land as a single segment (name.yaml, name.yml[.example]).
// /projects/<name>.md is intentionally excluded — it's a real Markdown route.
const REPO_FILE_RE = /^\/projects\/[^/]+\.(?:ya?ml)(?:\.example)?$/i;

// Generic hostile/scanner probes that should never hit app rendering. This is a
// Next.js app: it serves no PHP, no dotfiles (.env/.git/.aws/.ssh/...), no wp-*,
// and nothing under /var|/etc|/cgi-bin — so these can only be scanners. 410 them
// so they disappear from crawler recrawl loops and stop polluting 4xx summaries.
// Scoped to path/extension boundaries so real project names (e.g.
// /projects/xmlrpc-client, /projects/adminer-ui) are never caught.
const PROBE_RE =
  /(?:^|\/)\.(?:env|git|aws|ssh|svn|hg)(?:$|[/.])|\.php(?:$|[/?])|(?:^|\/)(?:wp-admin|wp-login|wp-content|wp-includes|wp-config|xmlrpc|adminer|phpmyadmin|boaform)(?:$|[/.])|^\/(?:var|etc|cgi-bin)\//i;

export function shouldReturnGone(path: string): boolean {
  return PHANTOM_PROJECT_RE.test(path) || REPO_FILE_RE.test(path) || PROBE_RE.test(path);
}

// Raw-slash scoped/owner names (/projects/@scope/pkg) predate the encodeURIComponent
// fix and still arrive from external inbound links and crawler memory. Canonicalize
// them to the single encoded segment the [name] route expects, before the phantom
// gate would otherwise 410 them.
const SCOPED_NAME_RE = /^\/projects\/(@[^/]+\/[^/]+)$/;

export function scopedRedirectTarget(path: string): string | null {
  const m = path.match(SCOPED_NAME_RE);
  return m ? `/projects/${encodeURIComponent(m[1])}` : null;
}

// ---------------------------------------------------------------------------
// Conditional GET for deploy-static nav pages
// ---------------------------------------------------------------------------
// Every page here is dynamically rendered (the root layout calls headers() via
// recordPageRequest), so Next.js sends `cache-control: no-store` with no ETag
// and nothing can ever revalidate. Crawlers without URL dedup therefore re-pull
// full bodies forever: on 2026-09-17 GPTBot fetched each nav page ~3,486 times
// in 14h, ~48% of a 93k-request day, all byte-identical.
//
// The routes below render from code + lib/i18n only — no DB reads, no
// per-request state — so their HTML is byte-identical for a given
// (deploy, locale, theme) until we ship again. Verified byte-stable against
// prod on 2026-09-17. Anything DB-backed (/, /browse, /stats, /security,
// /dependencies, /legislation, /compare, /languages, /mcp, /research) is
// deliberately excluded: its HTML changes between deploys as the catalog
// refreshes, and a deploy-scoped ETag would pin a stale 304 for days.
const STATIC_NAV_ROUTES = new Set([
  "/api",
  "/learn",
  "/submit",
  "/agent-edition",
  "/orchestra",
  "/methodology",
  "/resources",
  "/privacy",
  "/terms",
]);

// Changes on every deploy, which is exactly the invalidation boundary for the
// routes above. Railway sets both at build and at run; "dev" keeps local
// `next dev` from emitting a stale tag across restarts-with-edits.
const DEPLOY_ID =
  process.env.RAILWAY_DEPLOYMENT_ID ||
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  "dev";

// `private` on purpose: the HTML varies by the fc_lang/fc_theme cookies, and no
// shared cache sits in front of us (Railway's edge does not cache), so there is
// nothing to gain from `public` and a mis-keyed intermediary to lose. max-age=0
// + must-revalidate is what turns the next fetch into a conditional GET.
const STATIC_NAV_CACHE_CONTROL = "private, max-age=0, must-revalidate";

// Only used on the 304, which we construct ourselves. On a 200 pass-through
// Next overwrites whatever Vary middleware sets with its own
// `rsc, next-router-*, Accept-Encoding` — so Cookie cannot be added there, and
// this restates Next's list rather than replacing it.
//
// Losing Cookie on the 200 is harmless: `max-age=0, must-revalidate` turns
// every subsequent fetch into a conditional GET, and the tag encodes locale and
// theme, so a reader who flips language revalidates with the old tag, misses,
// and gets fresh HTML instead of a wrongly-cached body.
const STATIC_NAV_VARY =
  "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding, Cookie";

/**
 * Weak ETag for a deploy-static route. The root layout renders `lang`,
 * `data-theme` and all nav copy from the fc_lang/fc_theme cookies, so the tag
 * must vary on both or a zh-CN reader would get a 304 against English HTML.
 * Weak is correct: we only promise semantic equivalence, never byte ranges.
 */
export function staticNavEtag(request: NextRequest, path: string): string {
  const locale = normalizeLocale(request.cookies.get(LOCALE_COOKIE)?.value);
  const theme = normalizeTheme(request.cookies.get(THEME_COOKIE)?.value);
  return `W/"${DEPLOY_ID}-${locale}-${theme}-${path}"`;
}

/**
 * RFC 9110 §13.1.2 If-None-Match. `*` matches any current representation, and
 * the list is compared with the weak comparison function — so the W/ prefix is
 * stripped from both sides before matching.
 */
export function ifNoneMatchSatisfied(header: string | null, etag: string): boolean {
  if (!header) return false;
  const trimmed = header.trim();
  if (trimmed === "*") return true;
  const weak = (t: string) => t.trim().replace(/^W\//, "");
  const target = weak(etag);
  return trimmed.split(",").some((candidate) => weak(candidate) === target);
}

export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const path = url.pathname;

  if (STATIC_RE.test(path) || SKIP_PREFIXES.some((p) => path.startsWith(p))) {
    return NextResponse.next();
  }

  const scopedTarget = scopedRedirectTarget(path);
  if (scopedTarget) {
    const dest = url.clone();
    dest.pathname = scopedTarget;
    return NextResponse.redirect(dest, 308);
  }

  if (shouldReturnGone(path)) {
    return new NextResponse("Gone", {
      status: 410,
      headers: { "content-type": "text/plain; charset=utf-8", "x-fc-gate": "gone-path" },
    });
  }

  const surface: "api" | "page" = path.startsWith("/api/") ? "api" : "page";
  const { trafficType, uaFamily, host } = classifyTraffic(request, surface);
  const ua = (request.headers.get("user-agent") || "").slice(0, 120);
  const hasIp = !!(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip"));

  // Next.js <Link> prefetches set Sec-Purpose: prefetch (modern) or
  // Purpose: prefetch (older) or Next-Router-Prefetch: 1. They inflate
  // page-view counts ~10x — tag them so analytics can filter.
  const secPurpose = request.headers.get("sec-purpose") || "";
  const purpose = request.headers.get("purpose") || "";
  const nextPrefetch = request.headers.get("next-router-prefetch") || "";
  const isPrefetch =
    secPurpose.includes("prefetch") ||
    purpose === "prefetch" ||
    nextPrefetch === "1";

  const referrer = (request.headers.get("referer") || "").slice(0, 200);

  let query: Record<string, string> | undefined;
  if (path === "/search") {
    const q = url.searchParams.get("q");
    const category = url.searchParams.get("category");
    const language = url.searchParams.get("language");
    const author = url.searchParams.get("author");
    if (q || category || language || author) {
      query = {};
      if (q) query.q = q.slice(0, 120);
      if (category) query.category = category.slice(0, 60);
      if (language) query.language = language.slice(0, 60);
      if (author) query.author = author.slice(0, 60);
    }
  }

  const reqId = crypto.randomUUID().slice(0, 8);

  // Conditional GET on the deploy-static nav pages. Answering here skips the
  // render entirely, which also skips recordPageRequest() in the root layout —
  // so a 304 leaves no `request_log` row and the `request_in` line below is the
  // only trace. That is why `status` is stamped into the log payload.
  // A client-side <Link> navigation asks for this same pathname but receives an
  // RSC flight payload rather than HTML, and our tag — keyed on
  // (deploy, locale, theme, path) — cannot tell the two apart. There is
  // deliberately no guard for it, because Next leaves middleware nothing to
  // guard on: it strips the `RSC` / `Next-Router-*` request headers AND the
  // `_rsc` query param before middleware runs (verified against a local
  // `next start`, 2026-09-17 — middleware saw `?keep=yes` for a request sent as
  // `?_rsc=1a2b3&keep=yes`). Any `headers.get("rsc")` or `searchParams.has("_rsc")`
  // check here is dead code that only appears to work under vitest, which builds
  // NextRequest directly and strips nothing.
  //
  // Serving a 304 to those requests is still correct. Validators are per-URL:
  // a prefetch of `/learn?_rsc=<hash>` is a different cache entry from `/learn`,
  // so a browser never replays the HTML's tag against it, and on the bare URL
  // Next's own `Vary: rsc, next-router-*` (which it owns on the 200, and we
  // leave alone) keeps the two variants apart. The flight payload for these
  // pages is deploy-static for exactly the same reason the HTML is, so an
  // unchanged body is an honest 304 either way.
  const isConditionalCandidate =
    (request.method === "GET" || request.method === "HEAD") &&
    STATIC_NAV_ROUTES.has(path);
  const etag = isConditionalCandidate ? staticNavEtag(request, path) : null;
  const notModified =
    !!etag && ifNoneMatchSatisfied(request.headers.get("if-none-match"), etag);

  // Suppress entry log for traffic that has a paired completion log elsewhere
  // (see header comment). The remaining `request_in` lines are the ones where
  // an unpaired entry is the only available signal.
  // A 304 delivers no HTML, so the beacon can never fire for one — log it even
  // for browser_shaped traffic or the request disappears from every surface.
  const willBeacon = surface === "page" && trafficType === "browser_shaped" && !notModified;
  if (!willBeacon) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      msg: "request_in",
      req_id: reqId,
      method: request.method,
      path,
      surface,
      host,
      traffic_type: trafficType,
      ua_family: uaFamily,
      ua_short: ua,
      has_ip: hasIp ? 1 : 0,
      prefetch: isPrefetch ? 1 : 0,
      referrer: referrer || undefined,
      query,
      status: notModified ? 304 : undefined,
    }));
  }

  // Scraper pools spoofing desktop Chrome were 81% of all requests
  // (20k/9.5h on 2026-07-02), each one an uncached SSR render. Real
  // Chrome ≥89 always sends sec-ch-ua or sec-fetch-* — nothing legitimate
  // classifies as SpoofedChromeUA. Reject before rendering.
  if (uaFamily === "SpoofedChromeUA") {
    return new NextResponse("Too many requests.", {
      status: 429,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "retry-after": "86400",
        "x-fc-gate": "spoofed-ua",
      },
    });
  }

  // Placed after the spoofed-UA gate so a rejected client can't skip it with a
  // stale If-None-Match. A 304 carries no body, so the ~10-80 KB re-transfer
  // collapses to headers.
  if (notModified && etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        etag,
        "cache-control": STATIC_NAV_CACHE_CONTROL,
        vary: STATIC_NAV_VARY,
        "x-fc-gate": "static-nav-304",
      },
    });
  }

  // Cheap crawler throttle on /search: bots were 68% of /search hits and
  // each query is uncached + hits FTS. Real users keep through; LLM agents
  // (ai_agent) are allowed since those are human-driven prompts.
  if (path === "/search" && (trafficType === "crawler_bot" || trafficType === "ai_training")) {
    return new NextResponse("Search rate-limited for crawlers. See /sitemap.xml.", {
      status: 429,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "retry-after": "3600",
        "x-fc-gate": "crawler-search",
      },
    });
  }

  // Pipe path/method/req-id into the request so the root layout can
  // record server-side page requests into request_log (fills the gap
  // proxy.ts can't fill itself in Edge runtime — no DB access).
  const fwdHeaders = new Headers(request.headers);
  fwdHeaders.set("x-fc-path", path);
  fwdHeaders.set("x-fc-method", request.method);
  fwdHeaders.set("x-fc-req-id", reqId);
  fwdHeaders.set("x-fc-surface", surface);

  const response = NextResponse.next({ request: { headers: fwdHeaders } });
  response.headers.set("X-Request-Start", Date.now().toString());
  response.headers.set("X-Request-Id", reqId);

  // Advertise the Markdown alternate for crate pages via an HTTP Link header,
  // so AI crawlers that read headers (not just the HTML <head>) can discover
  // /projects/<name>.md. Mirrors the alternates.types metadata on the page.
  if (surface === "page" && !path.endsWith(".md") && /^\/projects\/[^/]+$/.test(path)) {
    response.headers.set("Link", `<${path}.md>; rel="alternate"; type="text/markdown"`);
  }

  // Hand the client something to revalidate against next time. Without the
  // cache-control override Next's dynamic-render default (`no-store`) tells
  // well-behaved clients not to keep the ETag at all, and the 304 branch above
  // would never be reached.
  // Vary is deliberately not set here — Next replaces it on a 200 with its own
  // router list, which is the one that matters. See STATIC_NAV_VARY.
  if (etag) {
    response.headers.set("ETag", etag);
    response.headers.set("Cache-Control", STATIC_NAV_CACHE_CONTROL);
  }
  return response;
}

export const config = {
  matcher: [
    // All paths except Next internals, the favicon, and the beacon (already tracked).
    "/((?!_next/|favicon\\.ico|api/beacon).*)",
  ],
};

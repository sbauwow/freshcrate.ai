import { NextRequest, NextResponse } from "next/server";
import { classifyTraffic } from "@/lib/traffic-classification";

/**
 * Next.js Proxy (Edge runtime) — runs on every non-static request.
 *
 * Emits a single `request_in` JSON log only for paths that won't produce a
 * paired completion log elsewhere. The pairing rules:
 *   - /api/*                 → keep request_in (logRequest emits the paired
 *                              `request` line on success; entry log is the
 *                              only signal if the handler crashes mid-flight).
 *   - page + human_browser   → suppress (the /api/beacon pixel records the
 *                              page_view; emitting here would double-count
 *                              and pegs Railway's 500-logs/sec replica cap).
 *   - page + bot/api_client  → keep (no beacon fires for these clients).
 *
 * No PII: raw IP is never logged here, just whether one was present.
 */

const STATIC_RE = /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|eot|map|xml|txt)$/i;
const SKIP_PREFIXES = ["/_next/", "/api/beacon"]; // beacon has its own log path

// Bots scrape README links and walk paths that never existed under our
// /projects/<name>/ namespace (docs/, .github/, SETUP.md, *.yaml.example, ...).
// Return 410 Gone so Google + co. drop them, and skip the React 404 cost.
// Note: /projects/<name>.md is a real route (LLM-friendly Markdown alternate),
// so it is excluded here and from robots.txt.
const GONE_RE = /^\/projects\/[^/]+\/(docs|documentation|i18n|\.github)(\/|$)|^\/projects\/[^/]+\/(SETUP|CHANGELOG|CODE_OF_CONDUCT|CONTRIBUTING|README-)|^\/projects\/[^/]+\.(yaml(\.example)?)$/i;

// Generic hostile/scanner probes that should never hit app rendering.
// Return 410 Gone so they disappear from crawler recrawl loops and stop
// polluting normal page-route 4xx summaries.
const PROBE_RE = /^\/(?:\.env(?:\.|$)?|\.git(?:\/|$)|wp-admin(?:\/|$)|wp-login\.php$|xmlrpc\.php$|adminer\.php$|boaform(?:\/|$))/i;

export function shouldReturnGone(path: string): boolean {
  return GONE_RE.test(path) || PROBE_RE.test(path);
}

export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const path = url.pathname;

  if (STATIC_RE.test(path) || SKIP_PREFIXES.some((p) => path.startsWith(p))) {
    return NextResponse.next();
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

  // Suppress entry log for traffic that has a paired completion log elsewhere
  // (see header comment). The remaining `request_in` lines are the ones where
  // an unpaired entry is the only available signal.
  const willBeacon = surface === "page" && trafficType === "human_browser";
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
    }));
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
  return response;
}

export const config = {
  matcher: [
    // All paths except Next internals, the favicon, and the beacon (already tracked).
    "/((?!_next/|favicon\\.ico|api/beacon).*)",
  ],
};

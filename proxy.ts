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

export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const path = url.pathname;

  if (STATIC_RE.test(path) || SKIP_PREFIXES.some((p) => path.startsWith(p))) {
    return NextResponse.next();
  }

  if (GONE_RE.test(path)) {
    return new NextResponse("Gone", {
      status: 410,
      headers: { "content-type": "text/plain; charset=utf-8", "x-fc-gate": "phantom-doc" },
    });
  }

  const surface: "api" | "page" = path.startsWith("/api/") ? "api" : "page";
  const { trafficType, uaFamily, host } = classifyTraffic(request, surface);
  const ua = (request.headers.get("user-agent") || "").slice(0, 120);
  const hasIp = !!(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip"));

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
    }));
  }

  const response = NextResponse.next();
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

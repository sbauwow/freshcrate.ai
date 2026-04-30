import { NextRequest, NextResponse } from "next/server";
import { classifyTraffic } from "@/lib/traffic-classification";

/**
 * Next.js Proxy (Edge runtime) — runs on every non-static request and emits
 * a single JSON log line to stdout so Railway has unified visibility across
 * page renders AND API routes. Status + duration are added separately by
 * route handlers via lib/request-log.ts (DB persistence).
 *
 * No PII: raw IP is never logged here, just whether one was present.
 */

const STATIC_RE = /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|eot|map|xml|txt)$/i;
const SKIP_PREFIXES = ["/_next/", "/api/beacon"]; // beacon has its own log path

export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const path = url.pathname;

  if (STATIC_RE.test(path) || SKIP_PREFIXES.some((p) => path.startsWith(p))) {
    return NextResponse.next();
  }

  const surface: "api" | "page" = path.startsWith("/api/") ? "api" : "page";
  const { trafficType, uaFamily, host } = classifyTraffic(request, surface);
  const ua = (request.headers.get("user-agent") || "").slice(0, 120);
  const hasIp = !!(request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip"));

  const reqId = crypto.randomUUID().slice(0, 8);

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

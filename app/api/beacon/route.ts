import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { classifyTraffic } from "@/lib/traffic-classification";
import crypto from "crypto";

/**
 * GET /api/beacon — page view + custom event tracker.
 *
 * Loaded as an <img> in the layout for pageviews; can also be fired from
 * client JS for custom events (clicks, installs, outbound, search) by
 * appending `?e=<type>&t=<target>`.
 *
 * Logs:
 *   - Path (from `p` param or Referer header)
 *   - Hashed IP (daily rotating salt, same as request_log)
 *   - User-Agent (truncated)
 *   - Bot detection
 *   - External referrer
 *   - Anonymous session id (HttpOnly cookie, 30-day rolling)
 *   - Event type + target
 *
 * No PII. GDPR-safe. Cookie is HttpOnly (no JS access) and stores only a
 * random UUID, not anything user-identifying.
 */

// 1x1 transparent GIF (43 bytes)
const PIXEL = Uint8Array.from(Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
));

const BOT_PATTERNS = /bot|crawler|spider|scraper|curl|wget|python|go-http|java|fetch|headless|phantom|lighthouse|googlebot|bingbot|yandex|baidu|semrush|ahrefs|mj12/i;

const SESSION_COOKIE = "fc_sid";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const SESSION_ID_RE = /^[a-f0-9-]{16,64}$/i;

const ALLOWED_EVENTS = new Set([
  "pageview",
  "click",
  "install",
  "copy",
  "search",
  "outbound",
  "submit",
  "share",
]);

function hashIp(ip: string): string {
  const salt = "freshcrate-" + new Date().toISOString().slice(0, 10);
  return crypto.createHash("sha256").update(salt + ip).digest("hex").slice(0, 16);
}

function sanitizeEvent(raw: string | null): string {
  if (!raw) return "pageview";
  const v = raw.toLowerCase().slice(0, 32);
  return ALLOWED_EVENTS.has(v) ? v : "pageview";
}

function sanitizeTarget(raw: string | null): string {
  if (!raw) return "";
  return raw.replace(/[^\w./:@\-]/g, "").slice(0, 200);
}

export async function GET(request: NextRequest) {
  try {
    const referer = request.headers.get("referer") || "";
    const ua = (request.headers.get("user-agent") || "").slice(0, 200);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip") || "";

    // Prefer explicit path param, then fall back to internal referer path
    let path = request.nextUrl.searchParams.get("p") || "/";
    if (!path.startsWith("/")) path = "/";
    if (path === "/") {
      try {
        const url = new URL(referer);
        if (url.hostname.includes("freshcrate")) {
          path = url.pathname;
        }
      } catch {
        // Invalid referer, keep "/"
      }
    }

    // External referrer (for traffic source tracking)
    let externalRef = "";
    try {
      const url = new URL(referer);
      if (!url.hostname.includes("freshcrate")) {
        externalRef = url.hostname;
      }
    } catch {
      // no referrer
    }

    const { trafficType, uaFamily, host } = classifyTraffic(request, "page");
    const isBot = trafficType === "crawler_bot" || BOT_PATTERNS.test(ua) ? 1 : 0;
    const ipHash = hashIp(ip);

    const eventType = sanitizeEvent(request.nextUrl.searchParams.get("e"));
    const eventTarget = sanitizeTarget(request.nextUrl.searchParams.get("t"));

    const existingSid = request.cookies.get(SESSION_COOKIE)?.value;
    const sessionId = existingSid && SESSION_ID_RE.test(existingSid)
      ? existingSid
      : crypto.randomUUID();

    const db = getDb();
    db.prepare(
      "INSERT INTO page_views (path, referrer, ip_hash, user_agent, is_bot, host, traffic_type, ua_family, session_id, event_type, event_target) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(path, externalRef, ipHash, ua, isBot, host, trafficType, uaFamily, sessionId, eventType, eventTarget);

    const response = new NextResponse(PIXEL, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Content-Length": PIXEL.length.toString(),
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Expires": "Thu, 01 Jan 1970 00:00:00 GMT",
      },
    });

    // Refresh cookie on every hit so active visitors keep their session id.
    if (!isBot) {
      response.cookies.set({
        name: SESSION_COOKIE,
        value: sessionId,
        maxAge: SESSION_MAX_AGE,
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
      });
    }

    return response;
  } catch {
    // Never let tracking break the page
    return new NextResponse(PIXEL, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Content-Length": PIXEL.length.toString(),
        "Cache-Control": "no-store",
      },
    });
  }
}

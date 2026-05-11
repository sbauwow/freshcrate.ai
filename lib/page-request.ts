import crypto from "crypto";
import { headers } from "next/headers";
import { getDb } from "./db";
import { log } from "./logger";
import { classifyHeaders } from "./traffic-classification";

export function shouldRecordPageStatus(method: string, status: number): boolean {
  return !(method.toUpperCase() === "HEAD" && status >= 400);
}

/**
 * Server-side page request recorder. Called from the root layout so every
 * page render — including ones from bots that never run JS — lands in
 * `request_log`. The proxy emits the `request_in` stdout line; this fills
 * the DB-side gap that previously only API routes filled via logRequest().
 *
 * Calling `headers()` opts the layout into dynamic rendering, which the
 * site already needs for DB-driven pages. status defaults to 200 — pages
 * that render not-found.tsx / error.tsx call this with the right code.
 */
export async function recordPageRequest(opts?: { status?: number; method?: string; path?: string }) {
  try {
    const h = await headers();
    const status = opts?.status ?? 200;
    const method = opts?.method ?? (h.get("x-fc-method") || "GET");
    if (!shouldRecordPageStatus(method, status)) return;
    const path = opts?.path ?? (h.get("x-fc-path") || h.get("x-invoke-path") || "/");
    const rawIp = h.get("x-forwarded-for")?.split(",")[0]?.trim()
      || h.get("x-real-ip")
      || "";
    const ip = hashIp(rawIp);
    const ua = (h.get("user-agent") || "").slice(0, 200);
    const { trafficType, uaFamily, host } = classifyHeaders(h, "page");

    log.request({
      method,
      path,
      status,
      duration_ms: 0,
      ip,
      host,
      traffic_type: trafficType,
      ua_family: uaFamily,
      user_agent: ua,
    });

    const db = getDb();
    db.prepare(
      `INSERT INTO request_log (method, path, status, duration_ms, ip, user_agent, api_key_prefix, host, traffic_type, ua_family)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(method, path, status, 0, ip, ua, null, host, trafficType, uaFamily);
  } catch {
    // Never let logging break a page render.
  }
}

function hashIp(ip: string): string {
  if (!ip) return "";
  const salt = "freshcrate-" + new Date().toISOString().slice(0, 10);
  return crypto.createHash("sha256").update(salt + ip).digest("hex").slice(0, 16);
}

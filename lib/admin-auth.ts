import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "crypto";

const COOKIE = "fc_admin";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function expectedToken(): string {
  return process.env.FRESHCRATE_ADMIN_TOKEN || "";
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function adminTokenConfigured(): boolean {
  return expectedToken().length >= 16;
}

export function verifyAdminToken(token: string | null | undefined): boolean {
  const expected = expectedToken();
  if (!expected) return false;
  if (!token) return false;
  return safeEqual(token, expected);
}

/** Server-component / route-handler check using NextRequest. */
export function isAdminRequest(request: NextRequest): boolean {
  const cookie = request.cookies.get(COOKIE)?.value;
  return verifyAdminToken(cookie);
}

/** Server-component check using next/headers cookies(). */
export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifyAdminToken(store.get(COOKIE)?.value);
}

export const ADMIN_COOKIE_NAME = COOKIE;
export const ADMIN_COOKIE_MAX_AGE = MAX_AGE;

/**
 * Build a same-origin URL using forwarded headers. Behind Railway's proxy,
 * `request.url` resolves to the internal `http://localhost:8080`, which leaks
 * into 3xx Location headers and breaks browser redirects.
 */
export function externalUrl(request: NextRequest, path: string): URL {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const base = host ? `${proto}://${host}` : request.url;
  return new URL(path, base);
}

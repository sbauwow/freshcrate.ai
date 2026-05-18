import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n";

function getPublicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "") || "https";
  if (!forwardedHost) return request.nextUrl.origin;
  return `${forwardedProto}://${forwardedHost}`;
}

function isPrefetch(request: NextRequest): boolean {
  const sec = request.headers.get("sec-purpose") || "";
  const purpose = request.headers.get("purpose") || "";
  const nextPrefetch = request.headers.get("next-router-prefetch") || "";
  return sec.includes("prefetch") || purpose === "prefetch" || nextPrefetch === "1";
}

export async function GET(request: NextRequest) {
  // This GET mutates the locale cookie. Next.js <Link> prefetches in-viewport
  // links, so without this guard the switcher's zh-CN/en links would silently
  // flip the user's language on page load (last prefetch's Set-Cookie wins).
  // Prefetch requests get a cheap no-op; only a real click changes locale.
  if (isPrefetch(request)) {
    return new NextResponse(null, { status: 204 });
  }

  const lang = normalizeLocale(request.nextUrl.searchParams.get("lang"));
  const redirect = request.nextUrl.searchParams.get("redirect") || "/";
  const publicOrigin = getPublicOrigin(request);

  let location = "/";
  try {
    const url = new URL(redirect, publicOrigin);
    location = `${url.pathname}${url.search}${url.hash}`;
  } catch {
    location = "/";
  }

  const response = NextResponse.redirect(new URL(location || "/", publicOrigin));
  response.cookies.set({
    name: LOCALE_COOKIE,
    value: lang || DEFAULT_LOCALE,
    httpOnly: false,
    sameSite: "lax",
    secure: forwardedProtoFromRequest(request),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

function forwardedProtoFromRequest(request: NextRequest): boolean {
  return (request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "")) === "https";
}

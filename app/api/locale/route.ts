import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n";

function getPublicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "") || "https";
  if (!forwardedHost) return request.nextUrl.origin;
  return `${forwardedProto}://${forwardedHost}`;
}

export async function GET(request: NextRequest) {
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

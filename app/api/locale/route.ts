import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n";

export async function GET(request: NextRequest) {
  const lang = normalizeLocale(request.nextUrl.searchParams.get("lang"));
  const redirect = request.nextUrl.searchParams.get("redirect") || "/";

  let location = "/";
  try {
    const url = new URL(redirect, request.nextUrl.origin);
    location = `${url.pathname}${url.search}${url.hash}`;
  } catch {
    location = "/";
  }

  const response = NextResponse.redirect(new URL(location || "/", request.nextUrl.origin));
  response.cookies.set({
    name: LOCALE_COOKIE,
    value: lang || DEFAULT_LOCALE,
    httpOnly: false,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

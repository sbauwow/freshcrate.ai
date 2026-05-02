import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, externalUrl } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  const res = NextResponse.redirect(externalUrl(request, "/admin/analytics"), { status: 303 });
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
  });
  return res;
}

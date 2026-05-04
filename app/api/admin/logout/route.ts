import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, externalUrl } from "@/lib/admin-auth";
import { withRequestLog } from "@/lib/request-log";

export const POST = withRequestLog(async (request: NextRequest) => {
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
});

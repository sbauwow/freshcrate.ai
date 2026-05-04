import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, ADMIN_COOKIE_MAX_AGE, adminTokenConfigured, externalUrl, verifyAdminToken } from "@/lib/admin-auth";
import { withRequestLog } from "@/lib/request-log";

export const POST = withRequestLog(async (request: NextRequest) => {
  if (!adminTokenConfigured()) {
    return NextResponse.json(
      { error: "FRESHCRATE_ADMIN_TOKEN not set on server (must be >= 16 chars)." },
      { status: 503 },
    );
  }

  let token: string | null = null;
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    token = typeof body?.token === "string" ? body.token : null;
  } else {
    const form = await request.formData();
    const v = form.get("token");
    token = typeof v === "string" ? v : null;
  }

  if (!verifyAdminToken(token)) {
    // Slow attacker by a beat without leaking which input was wrong.
    await new Promise((r) => setTimeout(r, 250));
    const next = request.nextUrl.searchParams.get("next") || "/admin/analytics";
    return NextResponse.redirect(externalUrl(request, `${next}?err=1`), { status: 303 });
  }

  const next = request.nextUrl.searchParams.get("next") || "/admin/analytics";
  const res = NextResponse.redirect(externalUrl(request, next), { status: 303 });
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: token!,
    maxAge: ADMIN_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
  });
  return res;
});

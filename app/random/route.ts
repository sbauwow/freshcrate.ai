import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { externalUrl } from "@/lib/admin-auth";

/**
 * GET /random — Redirect to a random project page.
 * The OG freshmeat feature: "Take me to a random project."
 */
export async function GET(request: NextRequest) {
  const db = getDb();
  const row = db
    .prepare("SELECT name FROM projects ORDER BY RANDOM() LIMIT 1")
    .get() as { name: string } | undefined;

  // Use forwarded headers — behind Railway's proxy `request.nextUrl`
  // resolves to internal localhost:8080 and leaks into the Location header.
  const path = row ? `/projects/${encodeURIComponent(row.name)}` : "/";

  return NextResponse.redirect(externalUrl(request, path));
}

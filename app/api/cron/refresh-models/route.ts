import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { refreshModels } from "@/lib/refresh-models";
import { withRequestLog } from "@/lib/request-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const pages = parseInt(url.searchParams.get("pages") || "3", 10);
  const dryRun = url.searchParams.get("dry") === "1";
  // Return before maxDuration so a slow Hub day yields a partial result, not a killed request.
  const budgetMs = parseInt(url.searchParams.get("budget_ms") || "240000", 10);

  try {
    const result = await refreshModels(getDb(), {
      pages,
      token: process.env.HF_TOKEN,
      dryRun,
      budgetMs,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export const GET = withRequestLog(async (req: NextRequest) => handle(req));
export const POST = withRequestLog(async (req: NextRequest) => handle(req));

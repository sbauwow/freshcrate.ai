import { NextRequest, NextResponse } from "next/server";
import { refreshResearchSnapshot } from "@/lib/research";
import { withRequestLog } from "@/lib/request-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The polite serial arXiv pacing takes minutes; this is a cron job, not user
// traffic, so let it run long instead of capping it like /api/research.
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

  try {
    const result = await refreshResearchSnapshot();
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

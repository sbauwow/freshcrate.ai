import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { log } from "@/lib/logger";
import { withRequestLog } from "@/lib/request-log";
import {
  buildTorrentsForModels,
  selectTorrentCandidates,
} from "@/lib/build-model-torrents-job";

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
  const limit = parseInt(url.searchParams.get("limit") || "10", 10);
  const maxModelMb = parseInt(url.searchParams.get("max_model_mb") || "20000", 10);
  const budgetMs = parseInt(url.searchParams.get("budget_ms") || "240000", 10);
  const dryRun = url.searchParams.get("dry") === "1";
  // Blocking mode for small dev batches only — the default never blocks:
  // streaming + hashing GBs of weights cannot run inside a request.
  const sync = url.searchParams.get("sync") === "1";

  try {
    const db = getDb();
    // Selection is cheap SQL; do it up front so the immediate response can
    // say how many models were queued, and pin the exact list the detached
    // loop processes.
    const candidates = selectTorrentCandidates(db, { limit, maxModelMb });
    const jobOpts = {
      candidates,
      limit,
      maxModelMb,
      budgetMs,
      token: process.env.HF_TOKEN,
      dryRun,
    };

    // Dry runs are read-only and small, so they always answer inline with
    // the would-build list; sync=1 is the explicit blocking opt-in.
    if (sync || dryRun) {
      const result = await buildTorrentsForModels(db, jobOpts);
      return NextResponse.json({ ok: true, mode: "sync", queued: candidates.length, ...result });
    }

    // Railway runs a long-lived Node server (no serverless freeze), so the
    // detached loop keeps streaming after the response is sent. The
    // catch-all is the container-crash guard: an unhandled rejection from
    // the background build must only log, never take the process down.
    void buildTorrentsForModels(db, jobOpts).catch((err: unknown) => {
      log.error("build-model-torrents background run failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return NextResponse.json({
      ok: true,
      mode: "queued",
      queued: candidates.length,
      dryRun,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export const GET = withRequestLog(async (req: NextRequest) => handle(req));
export const POST = withRequestLog(async (req: NextRequest) => handle(req));

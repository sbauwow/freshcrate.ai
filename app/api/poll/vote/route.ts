import { NextRequest, NextResponse } from "next/server";
import { recordVote } from "@/lib/polls";

export async function POST(request: NextRequest) {
  let body: { poll?: unknown; option?: unknown } = {};
  try { body = await request.json(); } catch { /* fall through */ }

  const pollSlug = typeof body.poll === "string" ? body.poll.slice(0, 64) : "";
  const optionSlug = typeof body.option === "string" ? body.option.slice(0, 64) : "";
  if (!pollSlug || !optionSlug) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }

  const sessionId = request.cookies.get("fc_sid")?.value || "";
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "";

  const result = recordVote(pollSlug, optionSlug, sessionId, ip);
  if (!result.ok) {
    return NextResponse.json(result, { status: result.error === "poll_closed" ? 410 : 400 });
  }
  return NextResponse.json(result);
}

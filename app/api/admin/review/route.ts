import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { withRequestLog } from "@/lib/request-log";
import { listSubmissions, approveSuggestion, rejectSubmission } from "@/lib/review-queue";

export const GET = withRequestLog(async (request: NextRequest) => {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const status = request.nextUrl.searchParams.get("status") || "new";
  const submissions = listSubmissions(status);
  return NextResponse.json({ submissions, count: submissions.length });
});

export const POST = withRequestLog(async (request: NextRequest) => {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { id?: unknown; action?: unknown; category?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const id = typeof body.id === "number" ? body.id : Number.NaN;
  const action = body.action;
  if (!Number.isInteger(id) || (action !== "approve" && action !== "reject")) {
    return NextResponse.json(
      { error: "Expected { id, action: 'approve' | 'reject', category? }." },
      { status: 400 }
    );
  }

  const result =
    action === "approve"
      ? await approveSuggestion(id, typeof body.category === "string" && body.category ? body.category : "AI Agents")
      : rejectSubmission(id);

  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
});

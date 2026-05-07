import { NextResponse } from "next/server";
import { getFullStats } from "@/lib/queries";
import { withRequestLog } from "@/lib/request-log";

export const GET = withRequestLog(async () => {
  const stats = getFullStats();
  return NextResponse.json(stats);
});

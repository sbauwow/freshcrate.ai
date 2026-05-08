import { NextResponse } from "next/server";
import { getResearchSnapshot } from "@/lib/research";
import { withRequestLog } from "@/lib/request-log";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export const GET = withRequestLog(async () => {
  return NextResponse.json(await getResearchSnapshot());
});

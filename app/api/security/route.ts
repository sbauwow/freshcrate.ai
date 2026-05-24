import { NextResponse } from "next/server";
import { getSecuritySnapshot } from "@/lib/security";
import { withRequestLog } from "@/lib/request-log";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

export const GET = withRequestLog(async () => {
  return NextResponse.json(await getSecuritySnapshot());
});

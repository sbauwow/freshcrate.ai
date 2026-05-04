import { NextResponse } from "next/server";
import { getCategories } from "@/lib/queries";
import { withRequestLog } from "@/lib/request-log";

export const GET = withRequestLog(async () => {
  const categories = getCategories();
  return NextResponse.json({ categories });
});

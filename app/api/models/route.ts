import { NextRequest, NextResponse } from "next/server";
import { listModels, type ModelSort } from "@/lib/queries";
import { logRequest } from "@/lib/request-log";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;

const MODEL_SORTS: ModelSort[] = ["downloads", "trending", "likes", "updated"];

/**
 * GET /api/models — browse Hugging Face models indexed by freshcrate.
 *
 * Query params:
 *   limit    (optional, default 20, max 500)
 *   offset   (optional, default 0)
 *   sort     (optional: downloads | trending | likes | updated, default downloads)
 *   license  (optional, exact match, e.g. apache-2.0)
 *   pipeline (optional, exact match, e.g. text-generation)
 *
 * Returns { models, total }. 400 on malformed limit/offset or unknown sort.
 */
export async function GET(request: NextRequest) {
  const start = Date.now();
  const sp = request.nextUrl.searchParams;

  const rawLimit = sp.get("limit");
  const rawOffset = sp.get("offset");
  const sort = sp.get("sort");
  const license = sp.get("license") || undefined;
  const pipeline = sp.get("pipeline") || undefined;

  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      const res = NextResponse.json(
        { error: `Invalid limit. Must be an integer between 1 and ${MAX_LIMIT}.` },
        { status: 400 }
      );
      logRequest(request, 400, start);
      return res;
    }
  }

  let offset = 0;
  if (rawOffset !== null) {
    offset = Number(rawOffset);
    if (!Number.isInteger(offset) || offset < 0) {
      const res = NextResponse.json(
        { error: "Invalid offset. Must be an integer >= 0." },
        { status: 400 }
      );
      logRequest(request, 400, start);
      return res;
    }
  }

  if (sort !== null && !MODEL_SORTS.includes(sort as ModelSort)) {
    const res = NextResponse.json(
      { error: `Invalid sort. Must be one of: ${MODEL_SORTS.join(", ")}` },
      { status: 400 }
    );
    logRequest(request, 400, start);
    return res;
  }

  const { models, total } = listModels({
    sort: (sort as ModelSort) || undefined,
    license,
    pipeline,
    limit,
    offset,
  });

  const res = NextResponse.json({ models, total });
  logRequest(request, 200, start);
  return res;
}

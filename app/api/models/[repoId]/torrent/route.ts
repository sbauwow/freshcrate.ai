import { NextRequest, NextResponse } from "next/server";
import { getModel, getModelTorrentMetainfo } from "@/lib/queries";
import { isTorrentable } from "@/lib/model-torrent-policy";
import { withRequestLog } from "@/lib/request-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves the .torrent bytes for a model (plan Task 11):
 *   200 application/x-bittorrent + Content-Disposition attachment — built;
 *   404 — unknown repo id, or nothing built yet;
 *   403 + JSON {error: reason} — gated / non-allowlisted license, so the UI
 *   can explain WHY there is no torrent (gated wins over unbuilt for the
 *   same reason: it never will be built).
 */

// Same contract as the model page's decodeRepoId: Next delivers the raw
// segment, so decode 'org%2Fname' before the exact repo-id lookup; a
// malformed escape falls back to the raw segment and 404s below.
function decodeRepoId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Attachment-safe filename: bencode names are plain tokens, but a model
 * name could carry odd characters — keep [word . - space], drop quotes. */
function torrentFilename(displayName: string, repoId: string): string {
  const base = (displayName || repoId.replace(/\//g, "__"))
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/"/g, "")
    .trim();
  return `${base || "model"}.torrent`;
}

async function handle(
  _req: NextRequest,
  ctx: { params: Promise<{ repoId: string }> }
) {
  const { repoId: rawRepoId } = await ctx.params;
  const repoId = decodeRepoId(rawRepoId);

  const model = getModel(repoId);
  if (!model) {
    return NextResponse.json({ error: "model not found" }, { status: 404 });
  }

  const policy = isTorrentable({ license: model.license, gated: model.gated });
  if (!policy.ok) {
    return NextResponse.json(
      { error: policy.reason, repo_id: model.repo_id },
      { status: 403 }
    );
  }

  const file = getModelTorrentMetainfo(model.id);
  if (!file || !file.metainfo?.byteLength) {
    return NextResponse.json(
      { error: "no torrent built for this model yet", repo_id: model.repo_id },
      { status: 404 }
    );
  }

  return new NextResponse(new Uint8Array(file.metainfo), {
    status: 200,
    headers: {
      "Content-Type": "application/x-bittorrent",
      "Content-Disposition": `attachment; filename="${torrentFilename(file.display_name, model.repo_id)}"`,
    },
  });
}

export const GET = withRequestLog(handle);

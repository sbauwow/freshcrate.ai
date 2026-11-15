import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import TrackedLink from "@/app/components/tracked-link";
import { getModel, getModelTorrent } from "@/lib/queries";

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US");
}

// Model repo ids are 'author/name'. Links on this site encode the slash
// (/models/author%2Fname); Next.js delivers the raw segment, so decode it
// here like /author and /tag do, then look up the canonical repo id exactly.
function decodeRepoId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ repoId: string }>;
}): Promise<Metadata> {
  const { repoId: rawRepoId } = await params;
  const model = getModel(decodeRepoId(rawRepoId));
  if (!model) {
    // Keep hallucinated model paths out of the search index (mirrors /projects).
    return { title: "Model not found — freshcrate", robots: { index: false, follow: true } };
  }
  return {
    title: `${model.author}/${model.model_name} — freshcrate`,
    description:
      model.short_desc ||
      `${model.model_name} by ${model.author} — a ${model.pipeline_tag || "Hugging Face"} model tracked by freshcrate.`,
    alternates: {
      canonical: `/models/${encodeURIComponent(model.repo_id)}`,
    },
  };
}

export default async function ModelPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId: rawRepoId } = await params;
  const repoId = decodeRepoId(rawRepoId);
  const m = getModel(repoId);
  if (!m) notFound();

  const torrent = getModelTorrent(m.id);

  return (
    <div className="flex flex-col md:flex-row gap-5">
      <div className="flex-1 min-w-0">
        {/* Breadcrumb */}
        <div className="text-[10px] text-fm-text-light mb-3">
          <Link href="/" className="text-fm-link hover:text-fm-link-hover">home</Link>
          {" > "}
          <Link href="/models" className="text-fm-link hover:text-fm-link-hover">models</Link>
          {" > "}
          <span className="font-bold text-fm-text">{m.repo_id}</span>
        </div>

        {/* Model header */}
        <div className="border-b-2 border-fm-green pb-3 mb-4">
          <h2 className="text-[18px] font-bold text-fm-green mb-1">{m.model_name || m.repo_id}</h2>
          <p className="text-[12px] text-fm-text mb-2">
            by <span className="font-bold">{m.author}</span>
            <span className="text-fm-text-light font-mono ml-2">{m.repo_id}</span>
          </p>
          <p className="text-[11px] text-fm-text mb-2">{m.short_desc}</p>
          <div className="flex flex-wrap gap-2">
            <span className="text-[9px] bg-fm-green/10 text-fm-green px-1.5 py-0.5 rounded">
              {m.pipeline_tag || "model"}
            </span>
            <span
              id="license"
              className="text-[9px] bg-[#bbddff]/50 text-fm-link px-1.5 py-0.5 rounded"
            >
              {m.license || "unknown"}
            </span>
          </div>
        </div>

        {/* Gated note — only for gated repos (the list API never surfaces them, but the branch must exist) */}
        {m.gated === 1 && (
          <div id="gated-note" className="mb-6 border border-yellow-700/50 rounded p-3 bg-yellow-900/20">
            <p className="text-[11px] font-bold text-yellow-500 mb-1">Gated model</p>
            <p className="text-[11px] text-fm-text-light">
              Access to this repository on Hugging Face requires accepting the author&apos;s terms.
              freshcrate indexes its public metadata only.
            </p>
          </div>
        )}

        {/* Stats row */}
        <div className="mb-6">
          <h3 className="text-[12px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">Stats</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="bg-fm-surface/50 border border-fm-border rounded p-2">
              <div className="text-fm-text-light text-[10px]">Downloads (30d)</div>
              <div className="font-bold">{formatNumber(m.downloads)}</div>
            </div>
            <div className="bg-fm-surface/50 border border-fm-border rounded p-2">
              <div className="text-fm-text-light text-[10px]">Likes</div>
              <div className="font-bold">{formatNumber(m.likes)}</div>
            </div>
            <div className="bg-fm-surface/50 border border-fm-border rounded p-2">
              <div className="text-fm-text-light text-[10px]">Trending score</div>
              <div className="font-bold">{formatNumber(m.trending_score)}</div>
            </div>
            <div className="bg-fm-surface/50 border border-fm-border rounded p-2">
              <div className="text-fm-text-light text-[10px]">Size</div>
              <div className="font-bold">{m.size_mb != null ? `${formatNumber(m.size_mb)} MB` : "—"}</div>
            </div>
          </div>
        </div>

        {/* Torrent section — PLACEHOLDER. Wave G fills this in: torrent presence is
            already queried via getModelTorrent(m.id); render the magnet/manifest UI
            inside this branch when model_torrents lands.
            TODO(Wave G): replace this placeholder with the real torrent panel
            (magnet link, file list from metainfo, build tool version). */}
        {torrent && (
          <div id="torrent-section" className="mb-6">
            <h3 className="text-[12px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">Torrent</h3>
            {/* TODO(Wave G): render torrent details instead of nothing */}
          </div>
        )}

        {/* Model info */}
        <div>
          <h3 className="text-[12px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">Model info</h3>
          <table className="w-full text-[11px]">
            <tbody>
              <tr className="border-b border-fm-border/30">
                <td className="py-1.5 text-fm-text-light">Repo</td>
                <td className="py-1.5 font-mono font-bold">{m.repo_id}</td>
              </tr>
              <tr className="border-b border-fm-border/30">
                <td className="py-1.5 text-fm-text-light">Pipeline</td>
                <td className="py-1.5">{m.pipeline_tag || "—"}</td>
              </tr>
              <tr className="border-b border-fm-border/30">
                <td className="py-1.5 text-fm-text-light">License</td>
                <td className="py-1.5">{m.license || "unknown"}</td>
              </tr>
              <tr className="border-b border-fm-border/30">
                <td className="py-1.5 text-fm-text-light">Hugging Face</td>
                <td className="py-1.5">
                  {m.hf_url ? (
                    <TrackedLink
                      event="outbound_click"
                      eventTarget={`model:hf:${m.repo_id}`}
                      href={m.hf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-fm-link hover:text-fm-link-hover"
                    >
                      {m.hf_url}
                    </TrackedLink>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
              <tr className="border-b border-fm-border/30">
                <td className="py-1.5 text-fm-text-light">Last modified</td>
                <td className="py-1.5">{formatDate(m.last_modified)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="w-full md:w-[220px] md:shrink-0 xl:w-[260px] 2xl:w-[300px]">
        <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 mb-4">
          <h3 className="text-[11px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">Model info</h3>
          <div className="space-y-2 text-[11px]">
            <div>
              <span className="text-fm-text-light block">Author:</span>
              <span className="font-bold">{m.author}</span>
            </div>
            <div>
              <span className="text-fm-text-light block">Downloads:</span>
              <span className="font-mono font-bold">{formatNumber(m.downloads)}</span>
            </div>
            <div>
              <span className="text-fm-text-light block">Likes:</span>
              <span className="font-mono font-bold">{formatNumber(m.likes)}</span>
            </div>
            <div>
              <span className="text-fm-text-light block">Indexed:</span>
              <span>{formatDate(m.last_modified)}</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

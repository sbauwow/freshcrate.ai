import type { Metadata } from "next";
import Link from "next/link";
import { listModels, getModelFilterOptions, type ModelSort } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Models — freshcrate",
  description:
    "Browse Hugging Face models tracked by freshcrate: top by downloads and trending, filterable by license and pipeline tag.",
};

const PAGE_SIZE = 25;
const MAX_FACETS = 10;

const MODEL_SORTS: { key: ModelSort; label: string }[] = [
  { key: "downloads", label: "Downloads" },
  { key: "trending", label: "Trending" },
  { key: "likes", label: "Likes" },
  { key: "updated", label: "Recently updated" },
];

function modelsHref(parts: { sort?: ModelSort; license?: string; pipeline?: string; offset?: number }): string {
  const sp = new URLSearchParams();
  if (parts.sort && parts.sort !== "downloads") sp.set("sort", parts.sort);
  if (parts.license) sp.set("license", parts.license);
  if (parts.pipeline) sp.set("pipeline", parts.pipeline);
  if (parts.offset) sp.set("offset", String(parts.offset));
  const qs = sp.toString();
  return qs ? `/models?${qs}` : "/models";
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatLastModified(lastModified: string): string {
  if (!lastModified) return "—";
  const d = new Date(lastModified);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US");
}

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; license?: string; pipeline?: string; offset?: string }>;
}) {
  const sp = await searchParams;
  const sort: ModelSort = MODEL_SORTS.some((s) => s.key === sp.sort) ? (sp.sort as ModelSort) : "downloads";
  const license = sp.license || undefined;
  const pipeline = sp.pipeline || undefined;
  const offset = Math.max(parseInt(sp.offset || "0", 10) || 0, 0);

  const { models, total } = listModels({ sort, license, pipeline, limit: PAGE_SIZE, offset });
  const facets = getModelFilterOptions();
  const trending = sort === "trending" ? models : listModels({ sort: "trending", limit: 5 }).models;

  const activeFilters = [license, pipeline].filter(Boolean).length;
  const heading = activeFilters > 0 ? "Filtered models" : "Top models by downloads";
  const shownFrom = total === 0 ? 0 : offset + 1;
  const shownTo = Math.min(offset + PAGE_SIZE, total);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="flex flex-col md:flex-row gap-5">
      <div className="flex-1 min-w-0">
        <div className="border-b-2 border-fm-green pb-1 mb-3">
          <h2 className="text-[14px] font-bold text-fm-green">
            {heading}
            <span className="text-[11px] font-normal text-fm-text-light ml-2">{formatNumber(total)} models</span>
          </h2>
        </div>

        {/* Sort tabs (server-side via searchParams, like the browse category filters) */}
        <div className="flex flex-wrap items-center gap-2 mb-3 text-[11px]">
          <span className="text-fm-text-light font-bold">Sort:</span>
          {MODEL_SORTS.map((s) => (
            <Link
              key={s.key}
              href={modelsHref({ sort: s.key, license, pipeline })}
              className={`hover:text-fm-link-hover ${sort === s.key ? "font-bold text-fm-green" : "text-fm-link"}`}
            >
              {s.label}
            </Link>
          ))}
        </div>

        {/* License + pipeline filters */}
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-[11px] text-fm-text-light font-bold mr-1">License:</span>
          <Link
            href={modelsHref({ sort, pipeline })}
            className={`text-[9px] px-1.5 py-0.5 rounded border ${!license ? "bg-fm-green/20 border-fm-green/40 font-bold" : "bg-fm-green/10 text-fm-green border-transparent hover:bg-fm-green/20"}`}
          >
            all
          </Link>
          {facets.licenses.slice(0, MAX_FACETS).map((f) => (
            <Link
              key={f.license}
              href={modelsHref({ sort, license: f.license, pipeline })}
              className={`text-[9px] px-1.5 py-0.5 rounded border ${license === f.license ? "bg-fm-green/20 border-fm-green/40 font-bold" : "bg-fm-green/10 text-fm-green border-transparent hover:bg-fm-green/20"}`}
            >
              {f.license} ({f.count})
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-[11px] text-fm-text-light font-bold mr-1">Pipeline:</span>
          <Link
            href={modelsHref({ sort, license })}
            className={`text-[9px] px-1.5 py-0.5 rounded border ${!pipeline ? "bg-[#bbddff]/60 border-fm-border font-bold" : "bg-[#bbddff]/50 text-fm-link border-transparent hover:bg-[#bbddff]"}`}
          >
            all
          </Link>
          {facets.pipelines.slice(0, MAX_FACETS).map((f) => (
            <Link
              key={f.pipeline_tag}
              href={modelsHref({ sort, license, pipeline: f.pipeline_tag })}
              className={`text-[9px] px-1.5 py-0.5 rounded border ${pipeline === f.pipeline_tag ? "bg-[#bbddff]/60 border-fm-border font-bold" : "bg-[#bbddff]/50 text-fm-link border-transparent hover:bg-[#bbddff]"}`}
            >
              {f.pipeline_tag} ({f.count})
            </Link>
          ))}
        </div>

        {/* Model list */}
        <div className="space-y-0">
          {models.map((m, i) => (
            <div
              key={m.repo_id}
              className={`py-2.5 px-2 ${i % 2 === 0 ? "bg-fm-surface/50" : ""} border-b border-fm-border/50`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <Link
                  href={`/models/${encodeURIComponent(m.repo_id)}`}
                  className="text-[13px] font-bold text-fm-link hover:text-fm-link-hover"
                >
                  {m.repo_id}
                </Link>
                <span className="text-[9px] bg-fm-green/10 text-fm-green px-1.5 py-0.5 rounded">
                  {m.pipeline_tag || "model"}
                </span>
                <span className="text-[11px] text-fm-text-light font-mono ml-auto shrink-0">
                  ↓ {formatNumber(m.downloads)} · ♥ {formatNumber(m.likes)}
                </span>
              </div>
              <p className="text-[11px] text-fm-text">{m.short_desc || m.model_name}</p>
              <div className="flex items-center gap-2 mt-1 text-[9px] text-fm-text-light">
                <span className="bg-fm-green/10 text-fm-green px-1.5 py-0.5 rounded">{m.license || "unknown"}</span>
                <span>updated {formatLastModified(m.last_modified)}</span>
              </div>
            </div>
          ))}

          {/* Empty state: prod DB starts with zero models until the first HF refresh cron runs */}
          {models.length === 0 && (
            <div className="bg-fm-sidebar-bg border border-fm-border rounded p-4 mt-2">
              <p className="text-[12px] font-bold text-fm-green mb-1">No models indexed yet</p>
              <p className="text-[11px] text-fm-text-light">
                {total === 0
                  ? "freshcrate has not indexed any Hugging Face models yet. The daily catalog sync will populate this page — check back soon."
                  : "No models match these filters. Try clearing the license or pipeline filter."}
              </p>
              {(license || pipeline) && total === 0 && (
                <Link href={modelsHref({ sort })} className="text-[11px] text-fm-link hover:text-fm-link-hover font-bold">
                  Clear filters
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between mt-3 text-[11px]">
            <span className="text-fm-text-light">
              Showing {formatNumber(shownFrom)}–{formatNumber(shownTo)} of {formatNumber(total)}
            </span>
            <div className="flex gap-3">
              {hasPrev ? (
                <Link
                  href={modelsHref({ sort, license, pipeline, offset: Math.max(offset - PAGE_SIZE, 0) })}
                  className="text-fm-link hover:text-fm-link-hover font-bold"
                >
                  ← Prev
                </Link>
              ) : (
                <span className="text-fm-border">← Prev</span>
              )}
              {hasNext ? (
                <Link
                  href={modelsHref({ sort, license, pipeline, offset: offset + PAGE_SIZE })}
                  className="text-fm-link hover:text-fm-link-hover font-bold"
                >
                  Next →
                </Link>
              ) : (
                <span className="text-fm-border">Next →</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Sidebar */}
      <aside className="w-full md:w-[220px] md:shrink-0 xl:w-[260px] 2xl:w-[300px]">
        <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3">
          <h3 className="text-[11px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">Trending now</h3>
          <div className="space-y-2">
            {trending.map((m) => (
              <div key={m.repo_id} className="text-[11px]">
                <Link
                  href={`/models/${encodeURIComponent(m.repo_id)}`}
                  className="font-bold text-fm-link hover:text-fm-link-hover"
                >
                  {m.repo_id}
                </Link>
                <div className="text-[9px] text-fm-text-light">
                  ↓ {formatNumber(m.downloads)} · ♥ {formatNumber(m.likes)}
                </div>
              </div>
            ))}
            {trending.length === 0 && <p className="text-[10px] text-fm-text-light">No trending models yet.</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}

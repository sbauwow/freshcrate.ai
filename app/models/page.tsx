import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { listModels, getModelFilterOptions, type ModelSort } from "@/lib/queries";
import { getCopy, LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Models — freshcrate",
  description:
    "Browse Hugging Face models tracked by freshcrate: top by downloads and trending, filterable by license and pipeline tag.",
};

const PAGE_SIZE = 25;
const MAX_FACETS = 10;

const MODEL_SORT_KEYS: ModelSort[] = ["downloads", "trending", "likes", "updated"];

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
  return n.toLocaleString();
}

function formatLastModified(lastModified: string): string {
  if (!lastModified) return "—";
  const d = new Date(lastModified);
  // Pinned to en-US like the detail page so the date shape is stable across hosts.
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US");
}

// Tiny {placeholder} interpolation, same idea as the other locale sections.
function fill(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, value),
    template
  );
}

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; license?: string; pipeline?: string; offset?: string }>;
}) {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const t = getCopy(locale).modelsPage;

  const sp = await searchParams;
  const sort: ModelSort = MODEL_SORT_KEYS.includes(sp.sort as ModelSort) ? (sp.sort as ModelSort) : "downloads";
  const license = sp.license || undefined;
  const pipeline = sp.pipeline || undefined;
  let offset = Math.max(parseInt(sp.offset || "0", 10) || 0, 0);

  const initial = listModels({ sort, license, pipeline, limit: PAGE_SIZE, offset });
  let models = initial.models;
  const total = initial.total;

  // Out-of-range offset (total > 0 but the page is empty): fall back to the LAST
  // page so the user lands on real rows and can page out via Prev.
  if (models.length === 0 && total > 0) {
    offset = Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE;
    models = listModels({ sort, license, pipeline, limit: PAGE_SIZE, offset }).models;
  }

  const facets = getModelFilterOptions();

  // Sidebar mirrors the other sorts: an unfiltered trending top-5 in every sort.
  const trending = listModels({ sort: "trending", limit: 5 }).models;

  const activeFilters = [license, pipeline].filter(Boolean).length;
  const hasFilters = activeFilters > 0;
  const sortLabels: Record<ModelSort, string> = {
    downloads: t.sortDownloads,
    trending: t.sortTrending,
    likes: t.sortLikes,
    updated: t.sortUpdated,
  };
  const sortHeadings: Record<ModelSort, string> = {
    downloads: t.headingDownloads,
    trending: t.headingTrending,
    likes: t.headingLikes,
    updated: t.headingUpdated,
  };
  const heading = hasFilters ? t.headingFiltered : sortHeadings[sort];
  const shownFrom = total === 0 ? 0 : offset + 1;
  const shownTo = Math.min(offset + PAGE_SIZE, total);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;
  const emptyState = models.length === 0;

  return (
    <div className="flex flex-col md:flex-row gap-5">
      <div className="flex-1 min-w-0">
        <div className="border-b-2 border-fm-green pb-1 mb-3">
          <h2 className="text-[14px] font-bold text-fm-green">
            {heading}
            <span className="text-[11px] font-normal text-fm-text-light ml-2">
              {formatNumber(total)} {t.modelsWord}
            </span>
          </h2>
        </div>

        {/* Sort tabs (server-side via searchParams, like the browse category filters) */}
        <div className="flex flex-wrap items-center gap-2 mb-3 text-[11px]">
          <span className="text-fm-text-light font-bold">{t.sortLabel}</span>
          {MODEL_SORT_KEYS.map((key) => (
            <Link
              key={key}
              href={modelsHref({ sort: key, license, pipeline })}
              className={`hover:text-fm-link-hover ${sort === key ? "font-bold text-fm-green" : "text-fm-link"}`}
            >
              {sortLabels[key]}
            </Link>
          ))}
        </div>

        {/* License + pipeline filters */}
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-[11px] text-fm-text-light font-bold mr-1">{t.licenseLabel}</span>
          <Link
            href={modelsHref({ sort, pipeline })}
            className={`text-[9px] px-1.5 py-0.5 rounded border ${!license ? "bg-fm-green/20 border-fm-green/40 font-bold" : "bg-fm-green/10 text-fm-green border-transparent hover:bg-fm-green/20"}`}
          >
            {t.all}
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
          <span className="text-[11px] text-fm-text-light font-bold mr-1">{t.pipelineLabel}</span>
          <Link
            href={modelsHref({ sort, license })}
            className={`text-[9px] px-1.5 py-0.5 rounded border ${!pipeline ? "bg-[#bbddff]/60 border-fm-border font-bold" : "bg-[#bbddff]/50 text-fm-link border-transparent hover:bg-[#bbddff]"}`}
          >
            {t.all}
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
                  {m.pipeline_tag || t.modelFallback}
                </span>
                <span className="text-[11px] text-fm-text-light font-mono ml-auto shrink-0">
                  ↓ {formatNumber(m.downloads)} · ♥ {formatNumber(m.likes)}
                </span>
              </div>
              <p className="text-[11px] text-fm-text">{m.short_desc || m.model_name}</p>
              <div className="flex items-center gap-2 mt-1 text-[9px] text-fm-text-light">
                <span className="bg-fm-green/10 text-fm-green px-1.5 py-0.5 rounded">
                  {m.license || t.unknownLicense}
                </span>
                <span>
                  {t.updatedPrefix} {formatLastModified(m.last_modified)}
                </span>
              </div>
            </div>
          ))}

          {/* Empty state, keyed on filter presence: an empty catalog (no filters) is
              different from "these filters match nothing". Out-of-range offsets never
              reach this branch — they are clamped to the last page above. */}
          {emptyState && (
            <div className="bg-fm-sidebar-bg border border-fm-border rounded p-4 mt-2">
              <p className="text-[12px] font-bold text-fm-green mb-1">
                {hasFilters ? t.emptyNoMatchTitle : t.emptyNotIndexedTitle}
              </p>
              <p className="text-[11px] text-fm-text-light">
                {hasFilters ? t.emptyNoMatchBody : t.emptyNotIndexedBody}
              </p>
              {hasFilters && (
                <Link href={modelsHref({ sort })} className="text-[11px] text-fm-link hover:text-fm-link-hover font-bold">
                  {t.clearFilters}
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between mt-3 text-[11px]">
            <span className="text-fm-text-light">
              {fill(t.showingRange, {
                from: formatNumber(shownFrom),
                to: formatNumber(shownTo),
                total: formatNumber(total),
              })}
            </span>
            <div className="flex gap-3">
              {hasPrev ? (
                <Link
                  href={modelsHref({ sort, license, pipeline, offset: Math.max(offset - PAGE_SIZE, 0) })}
                  className="text-fm-link hover:text-fm-link-hover font-bold"
                >
                  {t.prev}
                </Link>
              ) : (
                <span className="text-fm-border">{t.prev}</span>
              )}
              {hasNext ? (
                <Link
                  href={modelsHref({ sort, license, pipeline, offset: offset + PAGE_SIZE })}
                  className="text-fm-link hover:text-fm-link-hover font-bold"
                >
                  {t.next}
                </Link>
              ) : (
                <span className="text-fm-border">{t.next}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Sidebar */}
      <aside className="w-full md:w-[220px] md:shrink-0 xl:w-[260px] 2xl:w-[300px]">
        <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3">
          <h3 className="text-[11px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">{t.trendingNow}</h3>
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
            {trending.length === 0 && <p className="text-[10px] text-fm-text-light">{t.noTrending}</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}

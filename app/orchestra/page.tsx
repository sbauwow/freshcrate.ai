import type { Metadata } from "next";
import { cookies } from "next/headers";
import TrackedForm from "@/app/components/tracked-form";
import {
  getOrchestraBrief,
  getOrchestraFilterOptions,
  getOrchestraPatterns,
  getOrchestraPlaybook,
  type OrchestraStage,
} from "@/lib/orchestra";
import { getCopy, LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "freshcrate orchestra — orchestration patterns for the agent ecosystem",
  description:
    "Patterns, anti-patterns, and operator guidance for orchestrating agents across delegation, supervision, review loops, artifact spines, and human escalation.",
  openGraph: {
    title: "freshcrate orchestra — orchestration patterns for the agent ecosystem",
    description:
      "Explore freshcrate Orchestra: practical patterns for multi-agent delegation, supervision, review gates, artifact spines, and human-in-the-loop control.",
    url: "https://www.freshcrate.ai/orchestra",
    siteName: "freshcrate",
    type: "website",
    images: [{ url: "/og-default.png", width: 1200, height: 630, alt: "freshcrate orchestra" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "freshcrate orchestra — orchestration patterns for the agent ecosystem",
    description:
      "Practical orchestration guidance for the agent ecosystem: delegation, supervision, review gates, artifact spines, and human escalation.",
    images: ["/og-default.png"],
  },
};

function stagePill(stage: OrchestraStage): string {
  if (stage === "production") return "bg-red-100 text-red-800";
  if (stage === "team") return "bg-blue-100 text-blue-800";
  return "bg-green-100 text-green-800";
}

export default async function OrchestraPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; stage?: string; q?: string }>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const t = getCopy(locale).orchestraPage;
  const options = getOrchestraFilterOptions();

  const theme = typeof params.theme === "string" && options.themes.includes(params.theme) ? params.theme : undefined;
  const stage =
    typeof params.stage === "string" && options.stages.includes(params.stage as OrchestraStage)
      ? (params.stage as OrchestraStage)
      : undefined;
  const q = typeof params.q === "string" && params.q.trim().length > 0 ? params.q.trim() : undefined;

  const brief = getOrchestraBrief();
  const patterns = getOrchestraPatterns({ theme, stage, q });
  const playbook = getOrchestraPlaybook({ theme, stage, q });

  return (
    <div className="flex flex-col gap-4">
      <div className="border-b-2 border-fm-green pb-1">
        <h2 className="text-[14px] font-bold text-fm-green">{t.title}</h2>
        <p className="text-[11px] text-fm-text-light mt-1">
          {t.intro}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[10px]">
        <div className="bg-fm-sidebar-bg border border-fm-border rounded px-2 py-2">
          <div className="text-fm-text-light">{t.patternsTracked}</div>
          <div className="font-bold text-[13px]">{brief.patterns}</div>
        </div>
        <div className="bg-fm-sidebar-bg border border-fm-border rounded px-2 py-2">
          <div className="text-fm-text-light">{t.principles}</div>
          <div className="font-bold text-[13px]">{brief.principles}</div>
        </div>
        <div className="bg-fm-sidebar-bg border border-fm-border rounded px-2 py-2">
          <div className="text-fm-text-light">{t.antiPatternsNamed}</div>
          <div className="font-bold text-[13px]">{brief.antiPatterns}</div>
        </div>
      </div>

      <TrackedForm event="search" eventTarget="search:orchestra" method="GET" className="bg-fm-sidebar-bg border border-fm-border rounded px-2 py-2 text-[10px]">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 min-w-[220px]">
            <span className="text-fm-text-light">{t.keyword}</span>
            <input
              type="text"
              name="q"
              defaultValue={q ?? ""}
              placeholder="e.g. review gate, delegation, artifact spine"
              className="border border-fm-border bg-fm-bg text-fm-text px-1 py-0.5 text-[10px]"
            />
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-fm-text-light">{t.theme}</span>
            <select name="theme" defaultValue={theme ?? ""} className="border border-fm-border bg-fm-bg text-fm-text px-1 py-0.5 text-[10px]">
              <option value="">{t.allThemes}</option>
              {options.themes.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-fm-text-light">{t.stage}</span>
            <select name="stage" defaultValue={stage ?? ""} className="border border-fm-border bg-fm-bg text-fm-text px-1 py-0.5 text-[10px]">
              <option value="">{t.allStages}</option>
              {options.stages.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>

          <button type="submit" className="border border-fm-border bg-fm-btn-bg text-fm-btn-text px-2 py-0.5 font-bold hover:opacity-90">
            {t.apply}
          </button>
          <a href="/orchestra" className="text-fm-link hover:text-fm-link-hover">{t.reset}</a>
          <span className="ml-auto text-fm-text-light">{t.showingPatterns.replace("{count}", String(patterns.length))}</span>
        </div>
      </TrackedForm>

      <section className="bg-fm-surface border border-fm-border rounded">
        <div className="px-2 py-1 border-b border-fm-border bg-fm-sidebar-bg text-[11px] font-bold text-fm-green">
          {t.playbook}
        </div>
        <div className="p-2 space-y-2 text-[11px]">
          <div className="space-y-2">
            {playbook.actions.map((action) => (
              <div key={action.id} className="border border-fm-border rounded p-2 bg-fm-bg/20">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-fm-text">{action.title}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${action.priority === "P0" ? "bg-red-100 text-red-800" : action.priority === "P1" ? "bg-yellow-100 text-yellow-800" : "bg-blue-100 text-blue-800"}`}>
                    {action.priority}
                  </span>
                </div>
                <ul className="list-disc ml-4 text-[10px] text-fm-text-light space-y-0.5">
                  {action.checklist.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-fm-surface border border-fm-border rounded">
        <div className="px-2 py-1 border-b border-fm-border bg-fm-sidebar-bg text-[11px] font-bold text-fm-green">
          {t.bestPractices}
        </div>
        <div className="divide-y divide-fm-border/50">
          {patterns.length === 0 && (
            <div className="p-3 text-[11px] text-fm-text-light italic">{t.noEntries}</div>
          )}
          {patterns.map((item) => (
            <div key={item.id} className="p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="font-bold text-[12px] text-fm-link">{item.title}</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${stagePill(item.stage)}`}>
                  {item.stage}
                </span>
                <span className="text-fm-text-light">{item.summary}</span>
              </div>

              <p className="text-fm-text mb-1"><span className="font-bold">{t.whyItWorks}</span> {item.why_it_works}</p>

              <div className="flex flex-wrap gap-1 mb-2">
                {item.themes.map((themeTag) => (
                  <span key={themeTag} className="text-[9px] bg-fm-accent/10 text-fm-link px-1.5 py-0.5 rounded">
                    {themeTag}
                  </span>
                ))}
              </div>

              <div className="grid md:grid-cols-2 gap-2">
                <div>
                  <div className="font-bold text-fm-green mb-1">{t.doThis}</div>
                  <ul className="list-disc ml-4 text-[10px] text-fm-text-light space-y-0.5">
                    {item.best_practices.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="font-bold text-red-700 mb-1">{t.avoidThis}</div>
                  <ul className="list-disc ml-4 text-[10px] text-fm-text-light space-y-0.5">
                    {item.anti_patterns.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

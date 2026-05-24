import type { Metadata } from "next";
import { getSecuritySnapshot, type BreachItem, type SecurityCve, type SecurityNewsItem, type SecuritySeverity } from "@/lib/security";

export const metadata: Metadata = {
  title: "freshcrate security — CVEs, breaches, and security news",
  description:
    "Latest security CVEs, exploited vulnerabilities, breach disclosures, and security news for AI builders and operators.",
};

export const dynamic = "force-dynamic";

function severityPill(severity: SecuritySeverity): string {
  if (severity === "critical") return "bg-red-100 text-red-800";
  if (severity === "high") return "bg-orange-100 text-orange-800";
  if (severity === "medium") return "bg-yellow-100 text-yellow-800";
  if (severity === "low") return "bg-green-100 text-green-800";
  return "bg-gray-100 text-gray-700";
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

function dateOnly(value: string): string {
  if (!value) return "unknown";
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return value.slice(0, 10);
  }
}

function CveList({ cves, empty }: { cves: SecurityCve[]; empty: string }) {
  if (!cves.length) return <div className="p-3 text-[11px] text-fm-text-light italic">{empty}</div>;
  return (
    <div className="divide-y divide-fm-border/50">
      {cves.map((cve) => (
        <article key={`${cve.source}:${cve.id}`} className="p-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <a href={cve.url} target="_blank" rel="noopener noreferrer" className="font-bold text-fm-link hover:text-fm-link-hover">
              {cve.id}
            </a>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${severityPill(cve.severity)}`}>
              {cve.severity}{cve.score != null ? ` ${cve.score}` : ""}
            </span>
            {cve.exploited && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-900/10 text-red-700">
                exploited
              </span>
            )}
            <span className="text-[10px] text-fm-text-light ml-auto">{dateOnly(cve.published || cve.updated)}</span>
          </div>
          <p className="text-fm-text leading-relaxed">{cve.summary || cve.title}</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {cve.affected.map((item) => (
              <span key={item} className="bg-fm-accent/10 text-fm-link px-1.5 py-0.5 rounded text-[9px]">
                {item}
              </span>
            ))}
            {cve.cwe.map((item) => (
              <span key={item} className="bg-fm-sidebar-bg border border-fm-border px-1.5 py-0.5 rounded text-[9px] text-fm-text-light">
                {item}
              </span>
            ))}
          </div>
          {(cve.kevDueDate || cve.kevKnownRansomware) && (
            <div className="mt-1 text-[10px] text-fm-text-light">
              {cve.kevDueDate && <>CISA due: {cve.kevDueDate}</>}
              {cve.kevDueDate && cve.kevKnownRansomware && " • "}
              {cve.kevKnownRansomware && <>Ransomware use: {cve.kevKnownRansomware}</>}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function NewsList({ news }: { news: SecurityNewsItem[] }) {
  if (!news.length) return <div className="p-3 text-[11px] text-fm-text-light italic">No security news cached yet.</div>;
  return (
    <div className="divide-y divide-fm-border/50">
      {news.map((item) => (
        <article key={`${item.source}:${item.url}`} className="p-2 text-[11px]">
          <div className="flex items-start gap-2">
            <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-blue-50 text-blue-700 shrink-0">
              {item.source}
            </span>
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-bold text-fm-link hover:text-fm-link-hover leading-tight">
              {item.title}
            </a>
          </div>
          {item.summary && <p className="text-[10px] text-fm-text-light leading-relaxed mt-1">{item.summary}</p>}
          <div className="flex flex-wrap gap-1 mt-1">
            {item.tags.map((tag) => (
              <span key={tag} className="text-[9px] bg-fm-sidebar-bg border border-fm-border rounded px-1 py-0.5 text-fm-text-light">
                {tag}
              </span>
            ))}
            <span className="text-[9px] text-fm-text-light ml-auto">{dateOnly(item.published)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function BreachList({ breaches }: { breaches: BreachItem[] }) {
  if (!breaches.length) return <div className="p-3 text-[11px] text-fm-text-light italic">No breach disclosures cached yet.</div>;
  return (
    <div className="divide-y divide-fm-border/50">
      {breaches.map((breach) => (
        <article key={breach.name} className="p-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <a href={breach.url} target="_blank" rel="noopener noreferrer" className="font-bold text-fm-link hover:text-fm-link-hover">
              {breach.title}
            </a>
            {breach.isVerified && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-100 text-green-800">verified</span>
            )}
            <span className="text-[10px] text-fm-text-light ml-auto">{dateOnly(breach.addedDate || breach.breachDate)}</span>
          </div>
          <div className="text-fm-text">
            {formatNumber(breach.pwnCount)} accounts
            {breach.domain && <span className="text-fm-text-light"> • {breach.domain}</span>}
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {breach.dataClasses.map((item) => (
              <span key={item} className="text-[9px] bg-fm-accent/10 text-fm-link rounded px-1.5 py-0.5">
                {item}
              </span>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="bg-fm-surface border border-fm-border rounded">
      <div className="px-2 py-1 border-b border-fm-border bg-fm-sidebar-bg text-[11px] font-bold text-fm-green">
        {title}
      </div>
      {children}
    </section>
  );
}

export default async function SecurityPage() {
  const snapshot = await getSecuritySnapshot();

  return (
    <div className="flex flex-col gap-4">
      <div className="border-b-2 border-fm-green pb-1">
        <h2 className="text-[14px] font-bold text-fm-green">freshcrate security</h2>
        <p className="text-[11px] text-fm-text-light mt-1">
          Latest high-impact CVEs, exploited vulnerability links, breach disclosures, and security news for agent operators.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
        <div className="bg-fm-sidebar-bg border border-fm-border rounded px-2 py-2">
          <div className="text-fm-text-light">Critical CVEs</div>
          <div className="font-bold text-[13px]">{snapshot.summary.critical}</div>
        </div>
        <div className="bg-fm-sidebar-bg border border-fm-border rounded px-2 py-2">
          <div className="text-fm-text-light">High CVEs</div>
          <div className="font-bold text-[13px]">{snapshot.summary.high}</div>
        </div>
        <div className="bg-fm-sidebar-bg border border-fm-border rounded px-2 py-2">
          <div className="text-fm-text-light">CISA KEV</div>
          <div className="font-bold text-[13px]">{snapshot.summary.exploited}</div>
        </div>
        <div className="bg-fm-sidebar-bg border border-fm-border rounded px-2 py-2">
          <div className="text-fm-text-light">Breaches</div>
          <div className="font-bold text-[13px]">{snapshot.summary.breachCount}</div>
        </div>
        <div className="bg-fm-sidebar-bg border border-fm-border rounded px-2 py-2">
          <div className="text-fm-text-light">News</div>
          <div className="font-bold text-[13px]">{snapshot.summary.newsCount}</div>
        </div>
      </div>

      <div className="bg-fm-sidebar-bg border border-fm-border rounded px-2 py-2 text-[10px] text-fm-text-light">
        Fetched: {new Date(snapshot.fetched_at).toLocaleString()} • API:{" "}
        <a href="/api/security" className="text-fm-link hover:text-fm-link-hover">/api/security</a>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
        <div className="space-y-4">
          <Section id="cves" title="Recent high CVEs">
            <CveList cves={snapshot.cves} empty="No recent CVEs cached yet." />
          </Section>

          <Section id="kev" title="Known exploited vulnerabilities">
            <CveList cves={snapshot.exploited} empty="No CISA KEV entries cached yet." />
          </Section>
        </div>

        <div className="space-y-4">
          <Section id="breaches" title="Latest breach disclosures">
            <BreachList breaches={snapshot.breaches} />
          </Section>

          <Section id="news" title="Security news">
            <NewsList news={snapshot.news} />
          </Section>

          <Section id="sources" title="Sources">
            <ul className="p-2 space-y-1 text-[11px]">
              {snapshot.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">
                    {source.name}
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}

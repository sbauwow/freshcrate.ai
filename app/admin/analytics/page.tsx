import type { Metadata } from "next";
import { isAdmin, adminTokenConfigured } from "@/lib/admin-auth";
import {
  getOverview,
  getEntryPages,
  getExitPages,
  getTopTransitions,
  getTimeOnPage,
  getEventConversion,
  getFunnel,
  getReferrerAttribution,
  getDauTrend,
  getRetention,
  getTopEventTargets,
  getStatusBreakdown,
  getTopErrorPaths,
  getSlowestPaths,
} from "@/lib/analytics";

export const metadata: Metadata = {
  title: "freshcrate — Admin Analytics",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

interface SearchParams { days?: string; err?: string; funnel?: string }

const ALLOWED_FUNNEL_EVENTS = new Set([
  "pageview", "click", "install", "copy", "search", "outbound", "submit", "share",
]);

const DEFAULT_FUNNEL: Array<{ event: string; targetLike?: string }> = [
  { event: "pageview" }, { event: "search" }, { event: "outbound" },
];

function parseFunnel(raw: string | undefined): Array<{ event: string; targetLike?: string }> {
  if (!raw) return DEFAULT_FUNNEL;
  const steps: Array<{ event: string; targetLike?: string }> = [];
  for (const s of raw.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 8)) {
    const [evRaw, ...rest] = s.split(":");
    const event = (evRaw || "").toLowerCase();
    if (!ALLOWED_FUNNEL_EVENTS.has(event)) continue;
    const targetLike = rest.join(":").slice(0, 100);
    steps.push(targetLike ? { event, targetLike } : { event });
  }
  return steps.length > 0 ? steps : DEFAULT_FUNNEL;
}

function describeStep(step: { event: string; targetLike?: string }): string {
  return step.targetLike ? `${step.event}:${step.targetLike}` : step.event;
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const ok = await isAdmin();
  if (!ok) return <Login configured={adminTokenConfigured()} hasError={params.err === "1"} />;

  const days = Math.max(1, Math.min(90, parseInt(params.days || "7", 10) || 7));
  const funnelSteps = parseFunnel(params.funnel);

  const [overview, entry, exit, transitions, timeOnPage, events, funnel, referrers, dau, retention, topTargets, statusMix, errorPaths, slowPaths] = [
    getOverview(days),
    getEntryPages(days),
    getExitPages(days),
    getTopTransitions(days),
    getTimeOnPage(days),
    getEventConversion(days),
    getFunnel(funnelSteps, days),
    getReferrerAttribution(days),
    getDauTrend(Math.max(days, 30)),
    getRetention(30),
    getTopEventTargets(days),
    getStatusBreakdown(days),
    getTopErrorPaths(days),
    getSlowestPaths(days),
  ];

  return (
    <div className="font-mono text-[12px] text-fm-text px-4 py-4 max-w-[1200px] mx-auto">
      <Header days={days} funnel={params.funnel || ""} />

      <Section title="Overview">
        <KvGrid rows={[
          ["Sessions", overview.sessions],
          ["Visitors (hashed IP/day)", overview.visitors],
          ["Events", overview.events],
          ["Pageviews", overview.pageviews],
          ["Bounce rate", pct(overview.bounce_rate)],
          ["Avg events/session", overview.avg_session_events],
          ["Avg session length", `${overview.avg_session_seconds}s`],
          ["New sessions", overview.new_sessions],
          ["Returning sessions", overview.returning_sessions],
        ]} />
      </Section>

      <Section title="Entry pages">
        <Table headers={["path", "sessions", "views"]} rows={entry.map((r) => [r.path, r.sessions, r.views])} />
      </Section>

      <Section title="Exit pages">
        <Table headers={["path", "sessions", "views"]} rows={exit.map((r) => [r.path, r.sessions, r.views])} />
      </Section>

      <Section title="Top 2-step transitions">
        <Table
          headers={["from", "to", "sessions", "transitions"]}
          rows={transitions.map((r) => [r.from_path, r.to_path || "", r.sessions, r.transitions])}
        />
      </Section>

      <Section title="Time on page">
        <Table
          headers={["path", "views", "avg s", "median s"]}
          rows={timeOnPage.map((r) => [r.path, r.views, r.avg_seconds, r.median_seconds])}
        />
      </Section>

      <Section title="Conversion per event">
        <Table
          headers={["event", "fires", "sessions", "visitors", "% sessions", "fires/firing session"]}
          rows={events.map((r) => [
            r.event_type, r.fires, r.sessions_firing, r.visitors,
            pct(r.session_conversion), r.fires_per_firing_session,
          ])}
        />
      </Section>

      <Section title={`Funnel: ${funnelSteps.map(describeStep).join(" → ")}`}>
        <FunnelControls days={days} current={params.funnel || ""} />
        <Table
          headers={["step", "event", "target", "sessions", "from prev", "from start"]}
          rows={funnel.map((r, i) => [i, r.event_type, r.target_pattern || "", r.sessions, pct(r.conversion_from_prev), pct(r.conversion_from_start)])}
        />
      </Section>

      <Section title="Top event targets">
        <Table
          headers={["event", "target", "fires", "sessions"]}
          rows={topTargets.map((r) => [r.event_type, r.event_target, r.fires, r.sessions])}
        />
      </Section>

      <Section title="Referrer attribution (first ref of session)">
        <Table
          headers={["referrer", "sessions", "bounce", "avg session s"]}
          rows={referrers.map((r) => [r.referrer, r.sessions, pct(r.bounce_rate), r.avg_session_seconds])}
        />
      </Section>

      <Section title="DAU trend (last 30d)">
        <Table headers={["day", "sessions", "visitors"]} rows={dau.map((r) => [r.day, r.sessions, r.visitors])} />
      </Section>

      <Section title="Retention (D1 / D7 / D30 by cohort)">
        <Table
          headers={["cohort", "size", "D1", "D7", "D30"]}
          rows={retention.map((r) => [r.cohort_day, r.cohort_size, pct(r.d1 ?? 0), pct(r.d7 ?? 0), pct(r.d30 ?? 0)])}
        />
      </Section>

      <Section title="API status mix (request_log — API routes only, page renders not represented)">
        <Table headers={["bucket", "count"]} rows={statusMix.map((r) => [r.bucket, r.count])} />
      </Section>

      <Section title="Top error paths (4xx/5xx)">
        <Table
          headers={["path", "status", "count", "avg ms"]}
          rows={errorPaths.map((r) => [r.path, r.status, r.count, r.avg_ms])}
        />
      </Section>

      <Section title="Slowest paths (p95, 2xx/3xx/4xx)">
        <Table
          headers={["path", "count", "p95 ms", "avg ms"]}
          rows={slowPaths.map((r) => [r.path, r.count, r.p95_ms, r.avg_ms])}
        />
      </Section>

      <form action="/api/admin/logout" method="POST" className="mt-6">
        <button className="text-[11px] text-fm-link underline" type="submit">log out</button>
      </form>
    </div>
  );
}

function Header({ days, funnel }: { days: number; funnel: string }) {
  const carry = funnel ? `&funnel=${encodeURIComponent(funnel)}` : "";
  return (
    <div className="border-b-2 border-fm-green pb-1 mb-3">
      <h1 className="text-[14px] font-bold text-fm-green">freshcrate — admin analytics</h1>
      <p className="text-[10px] text-fm-text-light mt-0.5">
        Private. Indexing disabled. Data: page_views log (sessions via fc_sid cookie).
      </p>
      <div className="mt-2 text-[11px]">
        <span>window:&nbsp;</span>
        {[1, 7, 14, 30, 90].map((d) => (
          <a
            key={d}
            href={`?days=${d}${carry}`}
            className={`mr-2 ${d === days ? "text-fm-green font-bold" : "text-fm-link"}`}
          >{d}d</a>
        ))}
      </div>
    </div>
  );
}

function FunnelControls({ days, current }: { days: number; current: string }) {
  const presets: Array<{ label: string; value: string }> = [
    { label: "default (view → search → outbound)", value: "" },
    { label: "view → search → click → install", value: "pageview,search,click,install" },
    { label: "view → click → outbound (github)", value: "pageview,click,outbound:github.com" },
    { label: "search → click → install", value: "search,click,install" },
  ];
  return (
    <div className="text-[10px] text-fm-text-light mb-2">
      <form action="" method="GET" className="inline-block mr-3">
        <input type="hidden" name="days" value={days} />
        <input
          type="text"
          name="funnel"
          defaultValue={current}
          placeholder="event[:targetLike],event[:targetLike],..."
          className="border border-fm-border px-1.5 py-0.5 text-[11px] w-[420px] font-mono"
        />
        <button type="submit" className="ml-1 text-fm-link underline">apply</button>
      </form>
      <div className="mt-1">
        {presets.map((p) => (
          <a
            key={p.label}
            href={`?days=${days}${p.value ? `&funnel=${encodeURIComponent(p.value)}` : ""}`}
            className={`mr-3 ${current === p.value ? "text-fm-green font-bold" : "text-fm-link"}`}
          >{p.label}</a>
        ))}
      </div>
      <div className="mt-1 text-fm-text-light">
        Format: <code>event[:targetLike]</code> per step, comma-separated. Allowed events: pageview, click, install, copy, search, outbound, submit, share. Target uses SQL <code>LIKE %target%</code>.
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="border-b-2 border-fm-green mb-2 pb-1">
        <h2 className="text-[13px] font-bold text-fm-green">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function KvGrid({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[11px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between border-b border-fm-border py-0.5">
          <span className="text-fm-text-light">{k}</span>
          <span className="font-bold">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: Array<Array<React.ReactNode>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[11px] w-full">
        <thead>
          <tr className="border-b border-fm-border">
            {headers.map((h) => (
              <th key={h} className="text-left px-2 py-1 text-fm-text-light font-bold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td className="px-2 py-2 text-fm-text-light" colSpan={headers.length}>(no data)</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-fm-sidebar-bg" : ""}>
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1 align-top truncate max-w-[420px]">{String(c ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function Login({ configured, hasError }: { configured: boolean; hasError: boolean }) {
  return (
    <div className="font-mono text-[12px] text-fm-text px-4 py-8 max-w-[420px] mx-auto">
      <div className="border-b-2 border-fm-green pb-1 mb-3">
        <h1 className="text-[14px] font-bold text-fm-green">admin</h1>
      </div>
      {!configured && (
        <p className="text-[11px] text-fm-urgency-high mb-3">
          FRESHCRATE_ADMIN_TOKEN not set on server (must be ≥ 16 chars).
          Set it in Railway env, then redeploy.
        </p>
      )}
      {hasError && configured && (
        <p className="text-[11px] text-fm-urgency-high mb-3">Invalid token.</p>
      )}
      <form action="/api/admin/login?next=/admin/analytics" method="POST" className="space-y-2">
        <input
          type="password"
          name="token"
          autoComplete="off"
          placeholder="admin token"
          className="block w-full bg-fm-sidebar-bg border border-fm-border px-2 py-1 text-[12px]"
          required
        />
        <button
          type="submit"
          className="bg-fm-green text-white px-3 py-1 text-[11px] font-bold"
        >sign in</button>
      </form>
    </div>
  );
}

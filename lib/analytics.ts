import { getDb } from "./db";

/**
 * Product analytics over the page_views event log.
 * All queries scope to non-bot traffic with a non-empty session_id.
 *
 * Time-on-page caps at 300s (5 min) to avoid tab-left-open skew.
 * Sessions = the persistent fc_sid cookie (rolling 30-day).
 */

const NON_BOT = "is_bot = 0 AND session_id <> ''";

function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 7;
  return Math.max(1, Math.min(90, Math.floor(days)));
}

function windowClause(days: number): string {
  return `created_at > datetime('now', '-${clampDays(days)} day')`;
}

export interface Overview {
  days: number;
  sessions: number;
  visitors: number;
  events: number;
  pageviews: number;
  bounce_rate: number;
  avg_session_events: number;
  avg_session_seconds: number;
  new_sessions: number;
  returning_sessions: number;
}

export function getOverview(days = 7): Overview {
  const db = getDb();
  const w = windowClause(days);

  const totals = db.prepare(`
    SELECT
      COUNT(DISTINCT session_id) AS sessions,
      COUNT(DISTINCT ip_hash)    AS visitors,
      COUNT(*)                   AS events,
      SUM(CASE WHEN event_type = 'pageview' THEN 1 ELSE 0 END) AS pageviews
    FROM page_views WHERE ${NON_BOT} AND ${w}
  `).get() as { sessions: number; visitors: number; events: number; pageviews: number };

  const sessionStats = db.prepare(`
    SELECT
      AVG(steps)    AS avg_steps,
      AVG(span_s)   AS avg_span_s,
      SUM(CASE WHEN steps = 1 THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0) AS bounce_rate
    FROM (
      SELECT session_id, COUNT(*) AS steps,
             strftime('%s', MAX(created_at)) - strftime('%s', MIN(created_at)) AS span_s
      FROM page_views WHERE ${NON_BOT} AND ${w}
      GROUP BY session_id
    )
  `).get() as { avg_steps: number | null; avg_span_s: number | null; bounce_rate: number | null };

  // New vs returning: a session is "new" if its first-ever event is inside the window.
  const newReturning = db.prepare(`
    SELECT
      SUM(CASE WHEN first_seen > datetime('now', '-${clampDays(days)} day') THEN 1 ELSE 0 END) AS new_sessions,
      SUM(CASE WHEN first_seen <= datetime('now', '-${clampDays(days)} day') THEN 1 ELSE 0 END) AS returning_sessions
    FROM (
      SELECT session_id, MIN(created_at) AS first_seen
      FROM page_views WHERE ${NON_BOT}
      GROUP BY session_id
      HAVING MAX(created_at) > datetime('now', '-${clampDays(days)} day')
    )
  `).get() as { new_sessions: number | null; returning_sessions: number | null };

  return {
    days: clampDays(days),
    sessions: totals.sessions || 0,
    visitors: totals.visitors || 0,
    events: totals.events || 0,
    pageviews: totals.pageviews || 0,
    bounce_rate: Math.round((sessionStats.bounce_rate || 0) * 1000) / 1000,
    avg_session_events: Math.round((sessionStats.avg_steps || 0) * 10) / 10,
    avg_session_seconds: Math.round(sessionStats.avg_span_s || 0),
    new_sessions: newReturning.new_sessions || 0,
    returning_sessions: newReturning.returning_sessions || 0,
  };
}

function normalizeTrackedPath(path: string): string {
  if (!path.includes("?")) return path;
  try {
    const u = new URL(path, "https://freshcrate.ai");
    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
      "msclkid",
    ].forEach((k) => u.searchParams.delete(k));
    const query = u.searchParams.toString();
    return query ? `${u.pathname}?${query}` : u.pathname;
  } catch {
    return path;
  }
}

function aggregatePathHits(rows: Array<{ path: string; session_id: string }>, limit: number): PathHit[] {
  const byPath = new Map<string, { sessions: Set<string>; views: number }>();
  for (const row of rows) {
    const path = normalizeTrackedPath(row.path);
    const slot = byPath.get(path) || { sessions: new Set<string>(), views: 0 };
    slot.sessions.add(row.session_id);
    slot.views += 1;
    byPath.set(path, slot);
  }
  return Array.from(byPath.entries())
    .map(([path, data]) => ({ path, sessions: data.sessions.size, views: data.views }))
    .sort((a, b) => b.sessions - a.sessions || b.views - a.views || a.path.localeCompare(b.path))
    .slice(0, limit);
}

export interface PathHit { path: string; sessions: number; views: number }

export function getEntryPages(days = 7, limit = 20): PathHit[] {
  const db = getDb();
  const rows = db.prepare(`
    WITH first_event AS (
      SELECT session_id, path, created_at,
             ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at) AS rn
      FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)} AND event_type = 'pageview'
    )
    SELECT session_id, path
    FROM first_event WHERE rn = 1
  `).all() as Array<{ session_id: string; path: string }>;
  return aggregatePathHits(rows, limit);
}

export function getExitPages(days = 7, limit = 20): PathHit[] {
  const db = getDb();
  const rows = db.prepare(`
    WITH last_event AS (
      SELECT session_id, path, created_at,
             ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC) AS rn
      FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)} AND event_type = 'pageview'
    )
    SELECT session_id, path
    FROM last_event WHERE rn = 1
  `).all() as Array<{ session_id: string; path: string }>;
  return aggregatePathHits(rows, limit);
}

export function getTopPages(days = 7, limit = 20): Array<{ path: string; views: number }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT path
    FROM page_views
    WHERE ${NON_BOT} AND ${windowClause(days)} AND event_type = 'pageview'
  `).all() as Array<{ path: string }>;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const path = normalizeTrackedPath(row.path);
    counts.set(path, (counts.get(path) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path))
    .slice(0, limit);
}

export interface Transition { from_path: string; to_path: string; sessions: number; transitions: number }

export function getTopTransitions(days = 7, limit = 30): Transition[] {
  const db = getDb();
  const rows = db.prepare(`
    WITH steps AS (
      SELECT session_id, path AS from_path, created_at,
             LEAD(path) OVER (PARTITION BY session_id ORDER BY created_at) AS to_path
      FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)} AND event_type = 'pageview'
    )
    SELECT session_id, from_path, to_path
    FROM steps WHERE to_path IS NOT NULL AND to_path <> from_path
  `).all() as Array<{ session_id: string; from_path: string; to_path: string | null }>;

  const byTransition = new Map<string, { from_path: string; to_path: string; sessions: Set<string>; transitions: number }>();
  for (const row of rows) {
    if (!row.to_path) continue;
    const fromPath = normalizeTrackedPath(row.from_path);
    const toPath = normalizeTrackedPath(row.to_path);
    if (fromPath === toPath) continue;
    const key = `${fromPath} -> ${toPath}`;
    const slot = byTransition.get(key) || { from_path: fromPath, to_path: toPath, sessions: new Set<string>(), transitions: 0 };
    slot.sessions.add(row.session_id);
    slot.transitions += 1;
    byTransition.set(key, slot);
  }

  return Array.from(byTransition.values())
    .map((row) => ({ from_path: row.from_path, to_path: row.to_path, sessions: row.sessions.size, transitions: row.transitions }))
    .sort((a, b) => b.transitions - a.transitions || b.sessions - a.sessions || a.from_path.localeCompare(b.from_path) || a.to_path.localeCompare(b.to_path))
    .slice(0, limit);
}

export interface PathTime { path: string; views: number; avg_seconds: number; median_seconds: number }

export function getTimeOnPage(days = 7, limit = 20): PathTime[] {
  const db = getDb();
  const rows = db.prepare(`
    WITH dwell AS (
      SELECT path,
        MIN(300, MAX(0,
          strftime('%s', LEAD(created_at) OVER (PARTITION BY session_id ORDER BY created_at))
          - strftime('%s', created_at)
        )) AS s
      FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)} AND event_type = 'pageview'
    )
    SELECT path, s
    FROM dwell WHERE s IS NOT NULL
  `).all() as Array<{ path: string; s: number }>;

  const byPath = new Map<string, number[]>();
  for (const row of rows) {
    const path = normalizeTrackedPath(row.path);
    const values = byPath.get(path) || [];
    values.push(row.s);
    byPath.set(path, values);
  }

  return Array.from(byPath.entries())
    .map(([path, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 0
        ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
        : sorted[mid];
      const avg = Math.round((sorted.reduce((sum, value) => sum + value, 0) / sorted.length) * 10) / 10;
      return { path, views: sorted.length, avg_seconds: avg, median_seconds: median };
    })
    .filter((row) => row.views >= 5)
    .sort((a, b) => b.views - a.views || b.avg_seconds - a.avg_seconds || a.path.localeCompare(b.path))
    .slice(0, limit);
}

export interface EventStat {
  event_type: string;
  fires: number;
  sessions_firing: number;
  visitors: number;
  total_sessions: number;
  session_conversion: number;
  fires_per_firing_session: number;
}

export function getEventConversion(days = 7): EventStat[] {
  const db = getDb();
  const w = windowClause(days);

  const totalSessions = (db.prepare(
    `SELECT COUNT(DISTINCT session_id) AS c FROM page_views WHERE ${NON_BOT} AND ${w}`
  ).get() as { c: number }).c || 0;

  const rows = db.prepare(`
    SELECT
      event_type,
      COUNT(*) AS fires,
      COUNT(DISTINCT session_id) AS sessions_firing,
      COUNT(DISTINCT ip_hash)    AS visitors
    FROM page_views WHERE ${NON_BOT} AND ${w}
    GROUP BY event_type ORDER BY fires DESC
  `).all() as Array<Pick<EventStat, "event_type" | "fires" | "sessions_firing" | "visitors">>;

  return rows.map((r) => ({
    ...r,
    total_sessions: totalSessions,
    session_conversion: totalSessions > 0
      ? Math.round((r.sessions_firing / totalSessions) * 1000) / 1000
      : 0,
    fires_per_firing_session: r.sessions_firing > 0
      ? Math.round((r.fires / r.sessions_firing) * 10) / 10
      : 0,
  }));
}

export interface FunnelStep { event_type: string; target_pattern: string | null; sessions: number; conversion_from_prev: number; conversion_from_start: number }

/**
 * Compute a sequential funnel over events. Each step is identified by event_type
 * and an optional target substring. A session reaches step N iff it fired step 0..N
 * in chronological order. Default funnel: pageview → search → outbound|install.
 */
export function getFunnel(
  steps: Array<{ event: string; targetLike?: string }>,
  days = 7,
): FunnelStep[] {
  const db = getDb();
  const w = windowClause(days);
  const totalSessions = (db.prepare(
    `SELECT COUNT(DISTINCT session_id) AS c FROM page_views WHERE ${NON_BOT} AND ${w}`
  ).get() as { c: number }).c || 0;

  const reach: number[] = [];
  // For each step k, count distinct sessions that have an event matching step 0,
  // followed by step 1, ..., up to step k. We walk forward: prevTimes is the
  // earliest timestamp at which the session reached step k-1; step k must occur
  // strictly after that.
  let prevSessionTime = new Map<string, string>();

  for (let k = 0; k < steps.length; k++) {
    const s = steps[k];
    const filterTarget = s.targetLike ? "AND event_target LIKE ?" : "";
    const params: unknown[] = [s.event];
    if (s.targetLike) params.push(`%${s.targetLike}%`);

    const rows = db.prepare(`
      SELECT session_id, MIN(created_at) AS t
      FROM page_views
      WHERE ${NON_BOT} AND ${w} AND event_type = ? ${filterTarget}
      GROUP BY session_id
    `).all(...params) as Array<{ session_id: string; t: string }>;

    const next = new Map<string, string>();
    for (const r of rows) {
      if (k === 0) {
        next.set(r.session_id, r.t);
      } else {
        const prevT = prevSessionTime.get(r.session_id);
        if (prevT && r.t > prevT) next.set(r.session_id, r.t);
      }
    }
    reach.push(next.size);
    prevSessionTime = next;
  }

  return steps.map((s, i) => ({
    event_type: s.event,
    target_pattern: s.targetLike || null,
    sessions: reach[i],
    conversion_from_prev: i === 0
      ? (totalSessions > 0 ? Math.round((reach[0] / totalSessions) * 1000) / 1000 : 0)
      : (reach[i - 1] > 0 ? Math.round((reach[i] / reach[i - 1]) * 1000) / 1000 : 0),
    conversion_from_start: reach[0] > 0 ? Math.round((reach[i] / reach[0]) * 1000) / 1000 : 0,
  }));
}

export interface ReferrerStat { referrer: string; sessions: number; bounce_rate: number; avg_session_seconds: number }

export interface SourceStat {
  source: string;
  medium: string;
  campaign: string;
  sessions: number;
  bounce_rate: number;
  avg_session_seconds: number;
}

export function getSourceAttribution(days = 7, limit = 20): SourceStat[] {
  const db = getDb();
  return db.prepare(`
    WITH first_touch AS (
      SELECT session_id, utm_source, utm_medium, utm_campaign, created_at,
             ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at) AS rn
      FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)}
    ),
    session_stats AS (
      SELECT session_id, COUNT(*) AS steps,
             strftime('%s', MAX(created_at)) - strftime('%s', MIN(created_at)) AS span_s
      FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)}
      GROUP BY session_id
    )
    SELECT
      COALESCE(NULLIF(f.utm_source, ''), '(direct)') AS source,
      COALESCE(NULLIF(f.utm_medium, ''), '(none)') AS medium,
      COALESCE(NULLIF(f.utm_campaign, ''), '(none)') AS campaign,
      COUNT(*) AS sessions,
      ROUND(SUM(CASE WHEN s.steps = 1 THEN 1.0 ELSE 0 END) / COUNT(*), 3) AS bounce_rate,
      ROUND(AVG(s.span_s), 0) AS avg_session_seconds
    FROM first_touch f
    JOIN session_stats s USING (session_id)
    WHERE f.rn = 1
    GROUP BY source, medium, campaign
    ORDER BY sessions DESC
    LIMIT ?
  `).all(limit) as SourceStat[];
}

export interface SourceConversionRow {
  source: string;
  sessions: number;
  with_search: number;
  with_outbound_or_install: number;
}

function getSessionSummaries(days = 7): Array<{
  session_id: string;
  source: string;
  landing_path: string;
  has_search: boolean;
  has_outbound_or_install: boolean;
}> {
  const firstTouch = getFirstTouchRows(days);
  const db = getDb();
  const eventRows = db.prepare(`
    SELECT session_id,
           MAX(CASE WHEN event_type = 'search' THEN 1 ELSE 0 END) AS has_search,
           MAX(CASE WHEN event_type IN ('outbound', 'install') THEN 1 ELSE 0 END) AS has_outbound_or_install
    FROM page_views
    WHERE ${NON_BOT} AND ${windowClause(days)}
    GROUP BY session_id
  `).all() as Array<{
    session_id: string;
    has_search: number;
    has_outbound_or_install: number;
  }>;

  const eventMap = new Map(eventRows.map((row) => [row.session_id, row]));
  return firstTouch.map((row) => {
    const stats = eventMap.get(row.session_id);
    return {
      session_id: row.session_id,
      source: resolveSessionSource(row),
      landing_path: row.landing_path,
      has_search: !!stats?.has_search,
      has_outbound_or_install: !!stats?.has_outbound_or_install,
    };
  });
}

export function getSourceConversionBreakdown(days = 7, limit = 20): SourceConversionRow[] {
  const bySource = new Map<string, SourceConversionRow>();
  for (const row of getSessionSummaries(days)) {
    const source = row.source;
    const existing = bySource.get(source) || {
      source,
      sessions: 0,
      with_search: 0,
      with_outbound_or_install: 0,
    };
    existing.sessions += 1;
    existing.with_search += row.has_search ? 1 : 0;
    existing.with_outbound_or_install += row.has_outbound_or_install ? 1 : 0;
    bySource.set(source, existing);
  }

  return Array.from(bySource.values())
    .sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source))
    .slice(0, limit);
}

export interface LandingPageConversionRow {
  landing_path: string;
  sessions: number;
  with_search: number;
  with_outbound_or_install: number;
}

export function getLandingPageConversion(days = 7, limit = 20): LandingPageConversionRow[] {
  const byPath = new Map<string, LandingPageConversionRow>();
  for (const row of getSessionSummaries(days)) {
    const landingPath = row.landing_path;
    const existing = byPath.get(landingPath) || {
      landing_path: landingPath,
      sessions: 0,
      with_search: 0,
      with_outbound_or_install: 0,
    };
    existing.sessions += 1;
    existing.with_search += row.has_search ? 1 : 0;
    existing.with_outbound_or_install += row.has_outbound_or_install ? 1 : 0;
    byPath.set(landingPath, existing);
  }

  return Array.from(byPath.values())
    .sort((a, b) => b.sessions - a.sessions || a.landing_path.localeCompare(b.landing_path))
    .slice(0, limit);
}

export interface SourceFunnelRow {
  source: string;
  sessions: number;
  with_search: number;
  with_outbound_or_install: number;
}

function resolveSessionSource(row: { utm_source: string; referrer: string }): string {
  return row.utm_source || row.referrer || '(direct)';
}

export function getSourceFunnel(days = 7, limit = 20): SourceFunnelRow[] {
  const db = getDb();
  return db.prepare(`
    WITH base AS (
      SELECT
        session_id,
        COALESCE(NULLIF(MAX(CASE WHEN utm_source <> '' THEN utm_source END), ''), '(direct)') AS source,
        MAX(CASE WHEN event_type = 'search' THEN 1 ELSE 0 END) AS has_search,
        MAX(CASE WHEN event_type IN ('outbound', 'install') THEN 1 ELSE 0 END) AS has_outbound_or_install
      FROM page_views
      WHERE ${NON_BOT} AND ${windowClause(days)}
      GROUP BY session_id
    )
    SELECT
      source,
      COUNT(*) AS sessions,
      SUM(has_search) AS with_search,
      SUM(has_outbound_or_install) AS with_outbound_or_install
    FROM base
    GROUP BY source
    ORDER BY sessions DESC
    LIMIT ?
  `).all(limit) as SourceFunnelRow[];
}

export interface LandingBySourceRow {
  source: string;
  medium: string;
  campaign: string;
  landing_path: string;
  sessions: number;
}

function getFirstTouchRows(days = 7): Array<{
  session_id: string;
  landing_path: string;
  referrer: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
}> {
  const db = getDb();
  const rows = db.prepare(`
    WITH first_touch AS (
      SELECT session_id, path, referrer, utm_source, utm_medium, utm_campaign, created_at,
             ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at) AS rn
      FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)} AND event_type = 'pageview'
    )
    SELECT session_id, path, referrer, utm_source, utm_medium, utm_campaign
    FROM first_touch WHERE rn = 1
  `).all() as Array<{
    session_id: string;
    path: string;
    referrer: string;
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
  }>;

  return rows.map((row) => ({
    session_id: row.session_id,
    landing_path: normalizeTrackedPath(row.path),
    referrer: row.referrer || '',
    utm_source: row.utm_source || '',
    utm_medium: row.utm_medium || '',
    utm_campaign: row.utm_campaign || '',
  }));
}

export function getLandingPagesBySource(days = 7, limit = 20): LandingBySourceRow[] {
  const counts = new Map<string, LandingBySourceRow>();
  for (const row of getFirstTouchRows(days)) {
    const source = resolveSessionSource(row);
    const medium = row.utm_medium || (row.utm_source ? '(none)' : row.referrer ? 'referrer' : '(none)');
    const campaign = row.utm_campaign || '(none)';
    const key = `${source}\u0000${medium}\u0000${campaign}\u0000${row.landing_path}`;
    const existing = counts.get(key) || {
      source,
      medium,
      campaign,
      landing_path: row.landing_path,
      sessions: 0,
    };
    existing.sessions += 1;
    counts.set(key, existing);
  }

  return Array.from(counts.values())
    .sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source) || a.landing_path.localeCompare(b.landing_path))
    .slice(0, limit);
}

export interface SourceLandingMatrixRow {
  source: string;
  landing_path: string;
  sessions: number;
}

export function getSourceLandingMatrix(days = 7, limit = 20): SourceLandingMatrixRow[] {
  const counts = new Map<string, SourceLandingMatrixRow>();
  for (const row of getFirstTouchRows(days)) {
    const source = resolveSessionSource(row);
    const key = `${source}\u0000${row.landing_path}`;
    const existing = counts.get(key) || {
      source,
      landing_path: row.landing_path,
      sessions: 0,
    };
    existing.sessions += 1;
    counts.set(key, existing);
  }

  return Array.from(counts.values())
    .sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source) || a.landing_path.localeCompare(b.landing_path))
    .slice(0, limit);
}

export interface AttributionQuality {
  total_sessions: number;
  sessions_with_utm: number;
  sessions_with_external_referrer: number;
  sessions_direct: number;
  sessions_attributed: number;
  sessions_unattributed: number;
  pct_with_utm: number;
  pct_with_external_referrer: number;
  pct_direct: number;
  pct_attributed: number;
}

export function getAttributionQuality(days = 7): AttributionQuality {
  const rows = getFirstTouchRows(days);
  const total = rows.length;
  const withUtm = rows.filter((row) => !!row.utm_source).length;
  const withReferrer = rows.filter((row) => !!row.referrer).length;
  const direct = rows.filter((row) => !row.utm_source && !row.referrer).length;
  const attributed = rows.filter((row) => !!row.utm_source || !!row.referrer).length;
  const pct = (n: number) => total > 0 ? Math.round((n / total) * 1000) / 1000 : 0;

  return {
    total_sessions: total,
    sessions_with_utm: withUtm,
    sessions_with_external_referrer: withReferrer,
    sessions_direct: direct,
    sessions_attributed: attributed,
    sessions_unattributed: total - attributed,
    pct_with_utm: pct(withUtm),
    pct_with_external_referrer: pct(withReferrer),
    pct_direct: pct(direct),
    pct_attributed: pct(attributed),
  };
}

export function getReferrerAttribution(days = 7, limit = 20): ReferrerStat[] {
  const db = getDb();
  return db.prepare(`
    WITH first_ref AS (
      SELECT session_id, referrer,
             ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at) AS rn
      FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)}
    ),
    session_stats AS (
      SELECT session_id, COUNT(*) AS steps,
             strftime('%s', MAX(created_at)) - strftime('%s', MIN(created_at)) AS span_s
      FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)}
      GROUP BY session_id
    )
    SELECT COALESCE(NULLIF(f.referrer, ''), '(direct)') AS referrer,
           COUNT(*) AS sessions,
           ROUND(SUM(CASE WHEN s.steps = 1 THEN 1.0 ELSE 0 END) / COUNT(*), 3) AS bounce_rate,
           ROUND(AVG(s.span_s), 0) AS avg_session_seconds
    FROM first_ref f JOIN session_stats s USING (session_id)
    WHERE f.rn = 1
    GROUP BY referrer ORDER BY sessions DESC LIMIT ?
  `).all(limit) as ReferrerStat[];
}

export interface DauPoint { day: string; sessions: number; visitors: number }

export function getDauTrend(days = 30): DauPoint[] {
  const db = getDb();
  return db.prepare(`
    SELECT substr(created_at, 1, 10) AS day,
           COUNT(DISTINCT session_id) AS sessions,
           COUNT(DISTINCT ip_hash)    AS visitors
    FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)}
    GROUP BY day ORDER BY day ASC
  `).all() as DauPoint[];
}

export interface RetentionRow { cohort_day: string; cohort_size: number; d1: number; d7: number; d30: number }

export function getRetention(days = 30): RetentionRow[] {
  const db = getDb();
  // Cohort = sessions whose first-ever event landed on day X. Returners = same
  // session_id reappearing N days later. Honest because session_id persists 30d.
  return db.prepare(`
    WITH first_seen AS (
      SELECT session_id, substr(MIN(created_at), 1, 10) AS cohort_day
      FROM page_views WHERE ${NON_BOT} GROUP BY session_id
    ),
    activity AS (
      SELECT DISTINCT session_id, substr(created_at, 1, 10) AS day
      FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)}
    )
    SELECT f.cohort_day,
           COUNT(DISTINCT f.session_id) AS cohort_size,
           ROUND(SUM(CASE WHEN julianday(a.day) - julianday(f.cohort_day) = 1 THEN 1 ELSE 0 END) * 1.0
                 / NULLIF(COUNT(DISTINCT f.session_id), 0), 3) AS d1,
           ROUND(SUM(CASE WHEN julianday(a.day) - julianday(f.cohort_day) = 7 THEN 1 ELSE 0 END) * 1.0
                 / NULLIF(COUNT(DISTINCT f.session_id), 0), 3) AS d7,
           ROUND(SUM(CASE WHEN julianday(a.day) - julianday(f.cohort_day) = 30 THEN 1 ELSE 0 END) * 1.0
                 / NULLIF(COUNT(DISTINCT f.session_id), 0), 3) AS d30
    FROM first_seen f LEFT JOIN activity a USING (session_id)
    WHERE f.cohort_day > date('now', '-${clampDays(days)} day')
    GROUP BY f.cohort_day ORDER BY f.cohort_day DESC
  `).all() as RetentionRow[];
}

export interface TopEventTarget { event_type: string; event_target: string; fires: number; sessions: number }

export function getTopEventTargets(days = 7, limit = 30): TopEventTarget[] {
  const db = getDb();
  return db.prepare(`
    SELECT event_type, event_target,
           COUNT(*) AS fires,
           COUNT(DISTINCT session_id) AS sessions
    FROM page_views
    WHERE ${NON_BOT} AND ${windowClause(days)}
      AND event_type <> 'pageview' AND event_target <> ''
    GROUP BY event_type, event_target
    ORDER BY fires DESC LIMIT ?
  `).all(limit) as TopEventTarget[];
}

/**
 * Status-code analytics over the request_log table. Note: only API routes call
 * `logRequest`, so page renders are not represented here.
 */
function reqLogWindow(days: number): string {
  return `created_at > datetime('now', '-${clampDays(days)} day')`;
}

export interface StatusBucket { bucket: string; count: number }

export function getStatusBreakdown(days = 7): StatusBucket[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      CASE
        WHEN status BETWEEN 200 AND 299 THEN '2xx'
        WHEN status BETWEEN 300 AND 399 THEN '3xx'
        WHEN status BETWEEN 400 AND 499 THEN '4xx'
        WHEN status BETWEEN 500 AND 599 THEN '5xx'
        ELSE 'other' END AS bucket,
      COUNT(*) AS count
    FROM request_log
    WHERE ${reqLogWindow(days)}
    GROUP BY bucket
    ORDER BY bucket
  `).all() as StatusBucket[];
}

export interface ErrorPath { path: string; status: number; count: number; avg_ms: number }

export function getTopErrorPaths(days = 7, limit = 30): ErrorPath[] {
  const db = getDb();
  return db.prepare(`
    SELECT path, status,
           COUNT(*) AS count,
           CAST(AVG(duration_ms) AS INTEGER) AS avg_ms
    FROM request_log
    WHERE ${reqLogWindow(days)} AND status >= 400
    GROUP BY path, status
    ORDER BY count DESC, status DESC
    LIMIT ?
  `).all(limit) as ErrorPath[];
}

export interface SlowPath { path: string; count: number; p95_ms: number; avg_ms: number }

export function getSlowestPaths(days = 7, limit = 20): SlowPath[] {
  const db = getDb();
  // SQLite has no PERCENTILE_CONT; approximate p95 with a window.
  return db.prepare(`
    WITH d AS (
      SELECT path, duration_ms,
             NTILE(20) OVER (PARTITION BY path ORDER BY duration_ms) AS bucket
      FROM request_log
      WHERE ${reqLogWindow(days)} AND status < 500
    )
    SELECT path,
           COUNT(*) AS count,
           MAX(CASE WHEN bucket = 19 THEN duration_ms END) AS p95_ms,
           CAST(AVG(duration_ms) AS INTEGER) AS avg_ms
    FROM d
    GROUP BY path
    HAVING count > 5
    ORDER BY p95_ms DESC
    LIMIT ?
  `).all(limit) as SlowPath[];
}

/**
 * Page-render status from the page_views beacon log. Covers 404 (not-found.tsx)
 * and 500 (error.tsx) renders; the proxy/middleware can't see response status,
 * so this is the only signal for non-API errors.
 */
export interface RenderStatusBucket { event_type: string; count: number; sessions: number; visitors: number }

export function getRenderStatusBuckets(days = 7): RenderStatusBucket[] {
  const db = getDb();
  return db.prepare(`
    SELECT event_type,
           COUNT(*) AS count,
           COUNT(DISTINCT session_id) AS sessions,
           COUNT(DISTINCT ip_hash || strftime('%Y-%m-%d', created_at)) AS visitors
    FROM page_views
    WHERE ${windowClause(days)}
      AND event_type IN ('render_404', 'render_500')
    GROUP BY event_type
    ORDER BY count DESC
  `).all() as RenderStatusBucket[];
}

export interface RenderErrorPath { event_type: string; path: string; count: number; sessions: number }

export function getTopRenderErrorPaths(days = 7, limit = 30): RenderErrorPath[] {
  const db = getDb();
  return db.prepare(`
    SELECT event_type, path,
           COUNT(*) AS count,
           COUNT(DISTINCT session_id) AS sessions
    FROM page_views
    WHERE ${windowClause(days)}
      AND event_type IN ('render_404', 'render_500')
    GROUP BY event_type, path
    ORDER BY count DESC
    LIMIT ?
  `).all(limit) as RenderErrorPath[];
}

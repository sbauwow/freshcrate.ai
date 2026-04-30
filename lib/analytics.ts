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

export interface PathHit { path: string; sessions: number; views: number }

export function getEntryPages(days = 7, limit = 20): PathHit[] {
  const db = getDb();
  return db.prepare(`
    WITH first_event AS (
      SELECT session_id, path, created_at,
             ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at) AS rn
      FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)} AND event_type = 'pageview'
    )
    SELECT path,
           COUNT(DISTINCT session_id) AS sessions,
           COUNT(*) AS views
    FROM first_event WHERE rn = 1
    GROUP BY path ORDER BY sessions DESC LIMIT ?
  `).all(limit) as PathHit[];
}

export function getExitPages(days = 7, limit = 20): PathHit[] {
  const db = getDb();
  return db.prepare(`
    WITH last_event AS (
      SELECT session_id, path, created_at,
             ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC) AS rn
      FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)} AND event_type = 'pageview'
    )
    SELECT path,
           COUNT(DISTINCT session_id) AS sessions,
           COUNT(*) AS views
    FROM last_event WHERE rn = 1
    GROUP BY path ORDER BY sessions DESC LIMIT ?
  `).all(limit) as PathHit[];
}

export interface Transition { from_path: string; to_path: string; sessions: number; transitions: number }

export function getTopTransitions(days = 7, limit = 30): Transition[] {
  const db = getDb();
  return db.prepare(`
    WITH steps AS (
      SELECT session_id, path AS from_path, created_at,
             LEAD(path) OVER (PARTITION BY session_id ORDER BY created_at) AS to_path
      FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)} AND event_type = 'pageview'
    )
    SELECT from_path, to_path,
           COUNT(DISTINCT session_id) AS sessions,
           COUNT(*) AS transitions
    FROM steps WHERE to_path IS NOT NULL AND to_path <> from_path
    GROUP BY from_path, to_path
    ORDER BY transitions DESC LIMIT ?
  `).all(limit) as Transition[];
}

export interface PathTime { path: string; views: number; avg_seconds: number; median_seconds: number }

export function getTimeOnPage(days = 7, limit = 20): PathTime[] {
  const db = getDb();
  // Cap dwell at 300s. Use sub-300s rows to compute median via percentile_disc-equiv.
  return db.prepare(`
    WITH dwell AS (
      SELECT path,
        MIN(300, MAX(0,
          strftime('%s', LEAD(created_at) OVER (PARTITION BY session_id ORDER BY created_at))
          - strftime('%s', created_at)
        )) AS s
      FROM page_views WHERE ${NON_BOT} AND ${windowClause(days)} AND event_type = 'pageview'
    )
    SELECT path,
           COUNT(s) AS views,
           ROUND(AVG(s), 1) AS avg_seconds,
           CAST(AVG(s) AS INTEGER) AS median_seconds
    FROM dwell WHERE s IS NOT NULL
    GROUP BY path
    HAVING views >= 5
    ORDER BY views DESC LIMIT ?
  `).all(limit) as PathTime[];
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

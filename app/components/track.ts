"use client";

const STORAGE_KEYS = {
  referrer: "fc_first_referrer",
  source: "fc_first_utm_source",
  medium: "fc_first_utm_medium",
  campaign: "fc_first_utm_campaign",
} as const;

function sanitizeStored(raw: string | null, max = 120): string {
  if (!raw) return "";
  return raw.toLowerCase().replace(/[^a-z0-9_\-.:/]/g, "").slice(0, max);
}

function toExternalHostname(raw: string): string {
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.hostname.includes("freshcrate")) return "";
    return sanitizeStored(url.hostname, 120);
  } catch {
    return "";
  }
}

function rememberFirstTouch(pathWithQuery: string): {
  referrer: string;
  source: string;
  medium: string;
  campaign: string;
} {
  let source = "";
  let medium = "";
  let campaign = "";

  try {
    const url = new URL(pathWithQuery, window.location.origin);
    source = sanitizeStored(url.searchParams.get("utm_source"), 80);
    medium = sanitizeStored(url.searchParams.get("utm_medium"), 80);
    campaign = sanitizeStored(url.searchParams.get("utm_campaign"), 80);
  } catch {
    // Ignore malformed paths and fall back to stored attribution.
  }

  const referrer = toExternalHostname(document.referrer || "");

  if (referrer) sessionStorage.setItem(STORAGE_KEYS.referrer, referrer);
  if (source) sessionStorage.setItem(STORAGE_KEYS.source, source);
  if (medium) sessionStorage.setItem(STORAGE_KEYS.medium, medium);
  if (campaign) sessionStorage.setItem(STORAGE_KEYS.campaign, campaign);

  return {
    referrer: referrer || sanitizeStored(sessionStorage.getItem(STORAGE_KEYS.referrer), 120),
    source: source || sanitizeStored(sessionStorage.getItem(STORAGE_KEYS.source), 80),
    medium: medium || sanitizeStored(sessionStorage.getItem(STORAGE_KEYS.medium), 80),
    campaign: campaign || sanitizeStored(sessionStorage.getItem(STORAGE_KEYS.campaign), 80),
  };
}

/**
 * Fire a custom event to /api/beacon.
 *
 * The session_id cookie set by the pageview beacon is included automatically,
 * so events stitch into the same session for funnel analysis.
 *
 * Allowed event types: pageview, click, install, copy, search, outbound,
 * submit, share, render_404, render_500. Unknown values are coerced to
 * "pageview" server-side.
 */
export function track(event: string, target?: string, path?: string): void {
  if (typeof window === "undefined") return;
  const fullPath = path || window.location.pathname + window.location.search;
  const firstTouch = rememberFirstTouch(fullPath);
  const params = new URLSearchParams();
  params.set("e", event);
  if (target) params.set("t", target);
  params.set("p", fullPath);
  if (firstTouch.referrer) params.set("r", firstTouch.referrer);
  if (firstTouch.source) params.set("us", firstTouch.source);
  if (firstTouch.medium) params.set("um", firstTouch.medium);
  if (firstTouch.campaign) params.set("uc", firstTouch.campaign);
  // Use Image() so the request fires even on navigation (no fetch keep-alive needed).
  const img = new Image();
  img.src = `/api/beacon?${params.toString()}`;
}

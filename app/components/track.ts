"use client";

/**
 * Fire a custom event to /api/beacon.
 *
 * The session_id cookie set by the pageview beacon is included automatically,
 * so events stitch into the same session for funnel analysis.
 *
 * Allowed event types: pageview, click, install, copy, search, outbound,
 * submit, share. Unknown values are coerced to "pageview" server-side.
 */
export function track(event: string, target?: string, path?: string): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  params.set("e", event);
  if (target) params.set("t", target);
  params.set("p", path || window.location.pathname + window.location.search);
  // Use Image() so the request fires even on navigation (no fetch keep-alive needed).
  const img = new Image();
  img.src = `/api/beacon?${params.toString()}`;
}

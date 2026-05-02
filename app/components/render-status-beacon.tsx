"use client";

import { useEffect } from "react";
import { track } from "./track";

/**
 * Fires `track('render_404' | 'render_500', path)` once on mount. Drop into
 * not-found.tsx / error.tsx so the analytics funnel sees page-render errors,
 * which the Edge proxy cannot observe (it never sees the response status).
 */
export default function RenderStatusBeacon({ status }: { status: 404 | 500 }) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname + window.location.search;
    try { track(`render_${status}`, path); } catch { /* never block */ }
  }, [status]);

  return null;
}

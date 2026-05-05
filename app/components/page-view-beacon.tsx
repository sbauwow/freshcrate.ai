"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { track } from "./track";

/**
 * Fires a beacon GET to /api/beacon on every route change, including SPA
 * navigations. Uses Image() so the request is cancellable and never blocks
 * the page. Path + query are sent so per-query analytics (e.g. /search?q=foo)
 * stay attributed correctly.
 */
export default function PageViewBeacon() {
  const pathname = usePathname() || "/";
  const sp = useSearchParams();
  const query = sp?.toString() || "";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const fullPath = query ? `${pathname}?${query}` : pathname;
    try {
      track("pageview", undefined, fullPath);
    } catch {
      // never let tracking throw
    }
  }, [pathname, query]);

  return null;
}

"use client";

import { useState } from "react";
import { Theme, THEME_COOKIE } from "@/lib/theme";

function applyTheme(theme: Theme) {
  // Flip the live skin without a reload. SSR already set data-theme from the
  // cookie, so this only runs on user interaction — no FOUC on load.
  document.documentElement.dataset.theme = theme;
  // Persist client-side so the next SSR render matches (1 year, lax).
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export default function ThemeSwitcher({
  theme,
  label,
  modernLabel,
  retroLabel,
}: {
  theme: Theme;
  label: string;
  modernLabel: string;
  retroLabel: string;
}) {
  const [active, setActive] = useState<Theme>(theme);

  const select = (target: Theme) => {
    if (target === active) return;
    setActive(target);
    applyTheme(target);
  };

  const itemClass = (target: Theme) =>
    `px-1 py-0.5 rounded cursor-pointer ${
      active === target
        ? "bg-fm-btn-bg text-fm-btn-text border border-fm-nav-border"
        : "text-fm-link hover:text-fm-link-hover"
    }`;

  return (
    <div className="flex items-center gap-1 text-[10px]">
      <span className="text-fm-text-light">{label}:</span>
      <button type="button" onClick={() => select("modern")} className={itemClass("modern")}>
        {modernLabel}
      </button>
      <span className="text-fm-text-light">/</span>
      <button type="button" onClick={() => select("retro")} className={itemClass("retro")}>
        {retroLabel}
      </button>
    </div>
  );
}

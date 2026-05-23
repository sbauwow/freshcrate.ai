"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Locale } from "@/lib/i18n";

export default function LocaleSwitcher({
  locale,
  label,
  englishLabel,
  chineseLabel,
}: {
  locale: Locale;
  label: string;
  englishLabel: string;
  chineseLabel: string;
}) {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const query = searchParams?.toString();
  const redirect = query ? `${pathname}?${query}` : pathname;

  const itemClass = (target: Locale) =>
    `px-1 py-0.5 rounded ${locale === target ? "bg-fm-btn-bg text-fm-btn-text border border-fm-nav-border" : "text-fm-link hover:text-fm-link-hover"}`;

  return (
    <div className="flex items-center gap-1 text-[10px]">
      <span className="text-fm-text-light">{label}:</span>
      {/* prefetch={false}: /api/locale is a state-changing GET (sets the
          fc_lang cookie). Prefetching it would silently switch the user's
          language on page load. */}
      <Link prefetch={false} href={`/api/locale?lang=en&redirect=${encodeURIComponent(redirect)}`} className={itemClass("en")}>
        {englishLabel}
      </Link>
      <span className="text-fm-text-light">/</span>
      <Link prefetch={false} href={`/api/locale?lang=zh-CN&redirect=${encodeURIComponent(redirect)}`} className={itemClass("zh-CN")}>
        {chineseLabel}
      </Link>
    </div>
  );
}

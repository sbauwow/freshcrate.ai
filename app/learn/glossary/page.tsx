import Link from "next/link";
import { cookies } from "next/headers";
import { getGlossary } from "@/lib/glossary";
import { getCrate } from "@/lib/learn-content";
import type { Metadata } from "next";
import { getCopy, LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Glossary — Mini Crates | freshcrate",
  description:
    "Key AI & ML terms defined — from neural networks to transformers. Each term links back to the crate where it's explained.",
  openGraph: {
    title: "AI & ML Glossary — Mini Crates",
    description:
      "Key AI & ML terms defined — from neural networks to transformers.",
    url: "https://www.freshcrate.ai/learn/glossary",
  },
};

export default async function GlossaryPage() {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const t = getCopy(locale).glossaryPage;
  const entries = getGlossary();

  // Group by first letter
  const grouped: Record<string, typeof entries> = {};
  for (const entry of entries) {
    const letter = entry.term[0].toUpperCase();
    if (!grouped[letter]) grouped[letter] = [];
    grouped[letter].push(entry);
  }
  const letters = Object.keys(grouped).sort();

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      {/* Breadcrumb */}
      <nav className="text-[11px] text-fm-text-light font-mono flex items-center gap-1">
        <Link href="/learn" className="text-fm-link hover:underline">
          {t.miniCrates}
        </Link>
        <span>&gt;</span>
        <span className="text-fm-text">{t.title}</span>
      </nav>

      {/* Header */}
      <div className="border-b-2 border-fm-green pb-2">
        <h1 className="text-[16px] font-bold text-fm-green">
          {t.title}
        </h1>
        <p className="text-[11px] text-fm-text-light mt-1">
          {t.termsAcrossCrates.replace("{count}", String(entries.length)).replace("{crates}", "10")}
        </p>
      </div>

      {/* Letter nav */}
      <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
        {letters.map((l) => (
          <a
            key={l}
            href={`#${l}`}
            className="text-fm-link hover:underline px-1"
          >
            {l}
          </a>
        ))}
      </div>

      {/* Entries */}
      {letters.map((letter) => (
        <div key={letter} id={letter}>
          <h2 className="text-[14px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">
            {letter}
          </h2>
          <dl className="space-y-3">
            {grouped[letter].map((entry) => {
              const crate = getCrate(entry.crate);
              return (
                <div key={entry.term}>
                  <dt className="text-[13px] font-bold text-fm-text">
                    {entry.term}
                  </dt>
                  <dd className="text-[12px] text-fm-text leading-[1.6] mt-0.5">
                    {entry.definition}
                    {crate && (
                      <Link
                        href={`/learn/${crate.slug}`}
                        className="text-fm-link hover:underline ml-2 text-[10px] font-mono"
                      >
                        {t.crateLink.replace("{number}", String(crate.number))}
                      </Link>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}

      {/* Back */}
      <div className="border-t border-fm-border pt-3">
        <Link
          href="/learn"
          className="text-[11px] text-fm-link hover:underline font-mono"
        >
          {t.backToMiniCrates}
        </Link>
      </div>
    </div>
  );
}

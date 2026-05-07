import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import NavClock from "./components/nav-clock";
import PageViewBeacon from "./components/page-view-beacon";
import TrackedForm from "./components/tracked-form";
import LocaleSwitcher from "./components/locale-switcher";
import { getCopy, LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.freshcrate.ai"),
  title: "freshcrate — open source packages for agents",
  description:
    "freshcrate is a global open source package directory for AI agents and labs: MCP servers, orchestration frameworks, coding agents, research tooling, infrastructure, and operator playbooks.",
  keywords: [
    "AI agents",
    "MCP servers",
    "agent frameworks",
    "open source AI",
    "AI labs",
    "global AI tooling",
    "Chinese AI labs",
  ],
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "freshcrate",
    title: "freshcrate — open source packages for agents",
    description:
      "A global open source package directory for AI agents and labs: MCP servers, orchestration frameworks, coding agents, research tooling, infrastructure, and operator playbooks.",
    url: "https://www.freshcrate.ai",
    images: [{ url: "/og-default.png", width: 1200, height: 630, alt: "freshcrate" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "freshcrate — open source packages for agents",
    description:
      "A global open source package directory for AI agents and labs: MCP servers, orchestration frameworks, coding agents, research tooling, infrastructure, and operator playbooks.",
    images: ["/og-default.png"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const t = getCopy(locale);

  return (
    <html lang={locale === "zh-CN" ? "zh-CN" : "en"} translate="yes">
      <body>
        {/* Logo + ad area (like OG freshmeat) */}
        <div className="bg-white">
          <div className="max-w-[1100px] mx-auto px-4 py-2 flex items-center justify-center">
            <Link href="/" className="no-underline">
              <Image src="/logo.png" alt="freshcrate" width={300} height={300} priority className="w-[300px] h-auto" />
            </Link>
          </div>
        </div>

        {/* Top gray rule */}
        <div className="h-[1px] bg-[#6f6f6f]" />

        {/* Nav bar - gray like OG */}
        <div className="bg-[#dddddd] border-b border-[#6f6f6f]">
          <div className="max-w-[1100px] mx-auto px-4 py-1.5 flex items-center justify-between">
            <nav className="flex flex-wrap gap-1 text-[11px] font-bold">
              <Link href="/" className="text-black hover:text-fm-link no-underline">{t.nav.home}</Link>
              <span className="text-[#999]">|</span>
              <Link href="/browse" className="text-black hover:text-fm-link no-underline">{t.nav.browse}</Link>
              <span className="text-[#999]">|</span>
              <Link href="/research" className="text-black hover:text-fm-link no-underline">{t.nav.research}</Link>
              <span className="text-[#999]">|</span>
              <Link href="/agent-edition" className="text-black hover:text-fm-link no-underline">{t.nav.agentEdition}</Link>
              <span className="text-[#999]">|</span>
              <Link href="/orchestra" className="text-black hover:text-fm-link no-underline">{t.nav.orchestra}</Link>
              <span className="text-[#999]">|</span>
              <Link href="/legislation" className="text-black hover:text-fm-link no-underline">{t.nav.legislation}</Link>
              <span className="text-[#999]">|</span>
              <Link href="/languages" className="text-black hover:text-fm-link no-underline">{t.nav.languages}</Link>
              <span className="text-[#999]">|</span>
              <Link href="/dependencies" className="text-black hover:text-fm-link no-underline">{t.nav.deps}</Link>
              <span className="text-[#999]">|</span>
              <Link href="/submit" className="text-black hover:text-fm-link no-underline">{t.nav.submit}</Link>
              <span className="text-[#999]">|</span>
              <Link href="/compare" className="text-black hover:text-fm-link no-underline">{t.nav.compare}</Link>
              <span className="text-[#999]">|</span>
              <Link href="/api" className="text-black hover:text-fm-link no-underline">{t.nav.api}</Link>
              <span className="text-[#999]">|</span>
              <Link href="/stats" className="text-black hover:text-fm-link no-underline">{t.nav.stats}</Link>
              <span className="text-[#999]">|</span>
              <Link href="/learn" className="text-black hover:text-fm-link no-underline">{t.nav.learn}</Link>
            </nav>
            <div className="flex items-center gap-3">
              <LocaleSwitcher locale={locale} label={t.localeLabel} englishLabel={t.localeEnglish} chineseLabel={t.localeChinese} />
              <NavClock />
            </div>
          </div>
        </div>

        {/* Search bar - light blue like OG */}
        <div className="bg-[#bbddff] border-b border-[#6f6f6f]">
          <div className="max-w-[1100px] mx-auto px-4 py-1.5 flex flex-wrap items-center gap-2">
            <label className="text-[11px] font-bold text-black">{t.searchLabel}</label>
            <TrackedForm event="search" eventTarget="search:header" action="/search" method="GET" className="flex items-center gap-1">
              <input
                type="text"
                name="q"
                className="px-1.5 py-0.5 text-[11px] text-black border border-[#999] w-[160px] outline-none bg-white"
              />
              <button
                type="submit"
                className="text-[11px] font-bold px-2 py-0.5 border border-[#999] bg-[#dddddd] text-black cursor-pointer hover:bg-[#cccccc]"
              >
                {t.searchButton}
              </button>
            </TrackedForm>
            <span className="text-[10px] text-fm-text-light ml-auto">
              {t.translationNote}
            </span>
          </div>
        </div>

        {/* Content */}
        <main className="max-w-[1100px] mx-auto px-4 py-4">
          {children}
        </main>

        {/* Footer */}
        <footer
          className="mt-8 py-5 text-center text-[10px] border-t"
          style={{ background: "linear-gradient(180deg, #f8f8f8 0%, #f0eef5 50%, #e8e0f0 100%)", borderColor: "#d0c8e0" }}
        >
          <div className="max-w-[1100px] mx-auto px-4">
            <span style={{ color: "#8b7aa8" }}>
              🥩 freshmeat is dead. long live freshcrate 📦
            </span>
            <br />
            <span className="text-[10px]" style={{ color: "#9990b0" }}>
              {t.footerNote}
            </span>
            <br />
            <span className="inline-flex flex-wrap justify-center gap-0 mt-1">
              <Link href="/api" className="hover:text-fm-link" style={{ color: "#9990b0" }}>API</Link>
              <span style={{ color: "#c8c0d8" }}>{" | "}</span>
              <Link href="/submit" className="hover:text-fm-link" style={{ color: "#9990b0" }}>Submit</Link>
              <span style={{ color: "#c8c0d8" }}>{" | "}</span>
              <Link href="/learn" className="hover:text-fm-link" style={{ color: "#9990b0" }}>Learn</Link>
              <span style={{ color: "#c8c0d8" }}>{" | "}</span>
              <Link href="/agent-edition" className="hover:text-fm-link" style={{ color: "#9990b0" }}>Agent Edition</Link>
              <span style={{ color: "#c8c0d8" }}>{" | "}</span>
              <Link href="/orchestra" className="hover:text-fm-link" style={{ color: "#9990b0" }}>Orchestra</Link>
              <span style={{ color: "#c8c0d8" }}>{" | "}</span>
              <Link href="/legislation" className="hover:text-fm-link" style={{ color: "#9990b0" }}>Legislation</Link>
              <span style={{ color: "#c8c0d8" }}>{" | "}</span>
              <Link href="/privacy" className="hover:text-fm-link" style={{ color: "#9990b0" }}>Privacy</Link>
              <span style={{ color: "#c8c0d8" }}>{" | "}</span>
              <Link href="/terms" className="hover:text-fm-link" style={{ color: "#9990b0" }}>Terms</Link>
            </span>
          </div>
        </footer>
        {/* Page view beacon — tiny client helper so path attribution is exact */}
        <Suspense fallback={null}>
          <PageViewBeacon />
        </Suspense>
      </body>
    </html>
  );
}

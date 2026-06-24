import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getAllCrates, getDifficultyLabel, getDifficultyColor } from "@/lib/learn-content";
import { ProgressBar } from "@/app/components/crate-progress";
import { getCopy, LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Mini Crates — AI Education | freshcrate",
  description: "AI & Machine Learning from the ground up. An 11-crate progressive curriculum. No PhD required. No jargon either.",
  openGraph: {
    title: "Mini Crates — AI & ML Education from Scratch",
    description: "11 free crates covering AI fundamentals, neural networks, NLP, ethics, generative AI, agents, and modern LLM architecture.",
    url: "https://www.freshcrate.ai/learn",
    images: [{ url: "/learn/opengraph-image" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mini Crates — AI & ML Education from Scratch",
    description: "11 free crates covering AI fundamentals, neural networks, NLP, ethics, generative AI, agents, and modern LLM architecture.",
    images: ["/learn/opengraph-image"],
  },
};

const tracks = [
  {
    name: "Starter",
    emoji: "🌱",
    range: "Crates 1–3",
    description: "Zero assumptions. Start here if AI is new to you.",
    color: "border-green-400 bg-green-50",
    textColor: "text-green-800",
    accentColor: "bg-green-400",
  },
  {
    name: "Builder",
    emoji: "🔧",
    range: "Crates 4–7",
    description: "Neural nets, vision, language, and hands-on training.",
    color: "border-blue-400 bg-blue-50",
    textColor: "text-blue-800",
    accentColor: "bg-blue-400",
  },
  {
    name: "Architect",
    emoji: "🏗️",
    range: "Crates 8–11",
    description: "Ethics, generative AI, and the frontier. You're building the future.",
    color: "border-purple-400 bg-purple-50",
    textColor: "text-purple-800",
    accentColor: "bg-purple-400",
  },
];

const operatorGuides = [
  {
    title: "Best MCP Servers for Claude Code",
    href: "/learn/best-mcp-servers-for-claude-code",
    summary: "Ranked picks for browser control, MCP server building, and operator-grade Claude Code workflows.",
  },
  {
    title: "Best Open Source AI Agent Frameworks",
    href: "/learn/best-open-source-ai-agent-frameworks",
    summary: "A practical selector for LangGraph, CrewAI, AgentScope, LangChain, and AutoGPT by workflow style.",
  },
  {
    title: "Best Coding Agents and AI Dev Assistants",
    href: "/learn/best-coding-agents",
    summary: "Open source picks for terminal-first coding agents, local-first assistants, and repo automation workflows.",
  },
  {
    title: "Best Browser Automation Tools for AI Agents",
    href: "/learn/best-browser-automation-tools-for-ai-agents",
    summary: "Ranked picks for live browser debugging, deterministic QA, and browser-agent workflows.",
  },
  {
    title: "Best RAG and Memory Tools for Agents",
    href: "/learn/best-rag-memory-tools-for-agents",
    summary: "Practical picks for retrieval stacks, persistent agent memory, and context-serving infrastructure.",
  },
  {
    title: "Best AI Agent Observability Tools",
    href: "/learn/best-ai-agent-observability-tools",
    summary: "Ranked picks for tracing, evals, monitoring, and operational feedback loops.",
  },
  {
    title: "AI Agent Stack Map",
    href: "/learn/ai-agent-stack-map",
    summary: "A hub page mapping frameworks, coding agents, browser automation, memory, observability, and MCP layers.",
  },
];

export default async function LearnPage() {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const t = getCopy(locale).learnPage;
  const crates = getAllCrates();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: "Mini Crates — AI & ML Education",
    description: "A 10-crate progressive curriculum teaching AI and machine learning from the ground up. Free, no prerequisites.",
    provider: { "@type": "Organization", name: "freshcrate", url: "https://www.freshcrate.ai" },
    url: "https://www.freshcrate.ai/learn",
    inLanguage: "en",
    isAccessibleForFree: true,
    numberOfCredits: crates.length,
    hasCourseInstance: crates.map((c) => ({
      "@type": "LearningResource",
      name: `Crate #${c.number}: ${c.title}`,
      url: `https://www.freshcrate.ai/learn/${c.slug}`,
      timeRequired: `PT${c.estimatedMinutes}M`,
    })),
  };

  return (
    <div className="flex flex-col gap-5">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Header */}
      <div className="border-b-2 border-fm-green pb-3">
        <h1 className="text-[16px] font-bold text-fm-green">{t.title}</h1>
        <p className="text-[11px] text-fm-text mt-1">
          {t.intro}
        </p>
        <p className="text-[10px] text-fm-text-light mt-1">
          {t.stats}
        </p>
      </div>

      {/* Operator Guides */}
      <div>
        <div className="border-b border-fm-border pb-1 mb-3">
          <h2 className="text-[13px] font-bold text-fm-text">Operator guides</h2>
        </div>
        <div className="space-y-2">
          {operatorGuides.map((guide) => (
            <Link
              key={guide.href}
              href={guide.href}
              className="block border border-fm-border rounded p-3 bg-fm-sidebar-bg hover:bg-white/80 transition-colors"
            >
              <div className="text-[13px] font-bold text-fm-link">{guide.title}</div>
              <p className="text-[11px] text-fm-text mt-1">{guide.summary}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Choose Your Path */}
      <div>
        <div className="border-b border-fm-border pb-1 mb-3">
          <h2 className="text-[13px] font-bold text-fm-text">{t.choosePath}</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {tracks.map((track) => (
            <div
              key={track.name}
              className={`border rounded p-3 ${track.color}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[14px]">{track.emoji}</span>
                <span className={`text-[13px] font-bold ${track.textColor}`}>{track.name}</span>
              </div>
              <div className="text-[10px] text-fm-text-light font-mono mb-1.5">{track.range}</div>
              <p className="text-[11px] text-fm-text">{track.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Progress Tracker */}
      <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3">
        <ProgressBar
          slugs={crates.map((c) => ({
            slug: c.slug,
            number: c.number,
            title: c.title,
            difficulty: c.difficulty,
          }))}
        />
      </div>

      {/* All Crates */}
      <div>
        <div className="border-b border-fm-border pb-1 mb-3">
          <h2 className="text-[13px] font-bold text-fm-text">{t.allCrates}</h2>
        </div>
        <div className="space-y-0">
          {crates.map((crate, i) => (
            <Link
              key={crate.slug}
              href={`/learn/${crate.slug}`}
              className={`block py-3 px-3 ${i % 2 === 0 ? "bg-fm-surface/50" : ""} border-b border-fm-border/50 hover:bg-fm-surface/80 transition-colors`}
            >
              <div className="flex items-start gap-3">
                {/* Emoji + Number */}
                <div className="flex flex-col items-center shrink-0 w-10">
                  <span className="text-[20px] leading-none">{crate.emoji}</span>
                  <span className="text-[9px] text-fm-text-light font-mono mt-0.5">#{crate.number}</span>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-bold text-fm-link">{crate.title}</span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${getDifficultyColor(crate.difficulty)}`}
                    >
                      {getDifficultyLabel(crate.difficulty)}
                    </span>
                    <span className="text-[9px] text-fm-text-light font-mono ml-auto shrink-0">
                      ~{crate.estimatedMinutes} min
                    </span>
                  </div>
                  <p className="text-[11px] text-fm-text mt-0.5">{crate.subtitle}</p>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {crate.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[9px] bg-fm-green/10 text-fm-green px-1.5 py-0.5 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                    {crate.prerequisites.length > 0 && (
                      <span className="text-[9px] text-fm-text-light ml-auto">
                        {t.requires} {crate.prerequisites.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Footer note */}
      <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 text-center">
        <p className="text-[11px] text-fm-text">
          {t.footer1}
        </p>
        <p className="text-[10px] text-fm-text-light mt-1">
          {t.footer2}
        </p>
        <p className="text-[10px] mt-2">
          <Link href="/learn/glossary" className="text-fm-link hover:underline font-mono">
            {t.glossary}
          </Link>
        </p>
      </div>
    </div>
  );
}

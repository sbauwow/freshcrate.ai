import type { Metadata } from "next";
import Link from "next/link";
import TrackedLink from "@/app/components/tracked-link";

export const metadata: Metadata = {
  title: "AI Agent Stack Map in 2026 | freshcrate",
  description:
    "A practical map of the components of an AI agent system: frameworks, coding agents, browser automation, RAG and memory, observability, and MCP tool layers.",
  alternates: {
    canonical: "/learn/ai-agent-stack-map",
  },
  openGraph: {
    title: "AI Agent Stack Map in 2026",
    description:
      "A practical map of the major layers in a modern AI agent stack, with guide links for each layer.",
    url: "https://www.freshcrate.ai/learn/ai-agent-stack-map",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Agent Stack Map in 2026",
    description:
      "A practical map of the major layers in a modern AI agent stack, with guide links for each layer.",
  },
};

const stackLayers = [
  {
    title: "Frameworks and orchestration",
    problem: "How the agent is structured and how state, branching, and multi-agent coordination are managed.",
    href: "/learn/best-open-source-ai-agent-frameworks",
    cta: "Best Open Source AI Agent Frameworks",
  },
  {
    title: "Coding agents and dev assistants",
    problem: "How the agent actually helps developers across files, repos, shells, and PR workflows.",
    href: "/learn/best-coding-agents",
    cta: "Best Coding Agents and AI Dev Assistants",
  },
  {
    title: "Browser automation",
    problem: "How the agent inspects real web apps, reproduces UI issues, and runs repeatable browser workflows.",
    href: "/learn/best-browser-automation-tools-for-ai-agents",
    cta: "Best Browser Automation Tools for AI Agents",
  },
  {
    title: "RAG and memory",
    problem: "How the agent retrieves context, remembers users and prior work, and serves the right information at the right time.",
    href: "/learn/best-rag-memory-tools-for-agents",
    cta: "Best RAG and Memory Tools for Agents",
  },
  {
    title: "Observability and evals",
    problem: "How the team debugs the agent, traces failures, measures quality, and closes the feedback loop.",
    href: "/learn/best-ai-agent-observability-tools",
    cta: "Best AI Agent Observability Tools",
  },
  {
    title: "MCP and tool bridges",
    problem: "How the agent reaches real tools, docs, browsers, infra, and internal systems through a common interface layer.",
    href: "/learn/best-mcp-servers-for-claude-code",
    cta: "Best MCP Servers for Claude Code",
  },
] as const;

export default function AiAgentStackMapPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "AI Agent Stack Map in 2026",
    description:
      "A practical map of the components of an AI agent system, from frameworks and coding agents to browser automation, memory, observability, and MCP.",
    url: "https://www.freshcrate.ai/learn/ai-agent-stack-map",
    author: {
      "@type": "Organization",
      name: "freshcrate",
      url: "https://www.freshcrate.ai/",
    },
    publisher: {
      "@type": "Organization",
      name: "freshcrate",
      url: "https://www.freshcrate.ai/",
      logo: {
        "@type": "ImageObject",
        url: "https://www.freshcrate.ai/logo.png",
      },
    },
    about: [
      "AI agent stack",
      "components of an AI agent system",
      "agent architecture",
      "MCP",
      "RAG",
      "observability",
    ],
    dateModified: "2026-05-22",
  };

  return (
    <div className="max-w-4xl space-y-5">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav className="text-[10px] text-fm-text-light">
        <Link href="/" className="text-fm-link hover:text-fm-link-hover">Home</Link>
        {" > "}
        <Link href="/learn" className="text-fm-link hover:text-fm-link-hover">Learn</Link>
        {" > "}
        <span className="font-bold text-fm-text">AI Agent Stack Map</span>
      </nav>

      <header className="border-b-2 border-fm-green pb-3">
        <h1 className="text-[18px] font-bold text-fm-green">AI Agent Stack Map in 2026</h1>
        <p className="text-[12px] text-fm-text mt-2 leading-relaxed">
          If you want the short answer: the components of an AI agent system usually fall into six layers —
          orchestration, coding help, browser control, RAG/memory, observability, and tool bridges. Most teams do not need the best tool in every category.
          They need the right weak link fixed first.
        </p>
        <p className="text-[10px] text-fm-text-light mt-2">
          Updated: 2026-05-22 · Query targets: AI agent stack, agent architecture tools, components of an AI agent system
        </p>
      </header>

      <section className="bg-fm-sidebar-bg border border-fm-border rounded p-4">
        <h2 className="text-[14px] font-bold text-fm-text mb-2">How to use this map</h2>
        <p className="text-[11px] text-fm-text leading-relaxed">
          Treat this page like a routing layer. If your agent cannot choose actions cleanly, start with frameworks. If it cannot touch the real product, start with browsers.
          If it forgets context, fix RAG and memory. If it fails silently, fix observability. If it cannot reach tools, fix MCP.
        </p>
      </section>

      <section>
        <h2 className="text-[14px] font-bold text-fm-text border-b border-fm-border pb-1 mb-3">The six layers</h2>
        <div className="space-y-3">
          {stackLayers.map((layer, index) => (
            <article key={layer.title} className="border border-fm-border rounded p-3 bg-white/60">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-mono text-fm-text-light">L{index + 1}</span>
                <div className="text-[13px] font-bold text-fm-text">{layer.title}</div>
              </div>
              <p className="text-[11px] text-fm-text mt-1">{layer.problem}</p>
              <TrackedLink
                event="related_click"
                eventTarget={`stack-map->${layer.href}`}
                href={layer.href}
                className="inline-block mt-2 text-[11px] font-bold text-fm-link hover:text-fm-link-hover"
              >
                {layer.cta}
              </TrackedLink>
            </article>
          ))}
        </div>
      </section>

      <section className="border border-fm-border rounded p-4 bg-white/60">
        <h2 className="text-[14px] font-bold text-fm-text mb-2">Recommended reading order</h2>
        <div className="flex flex-wrap gap-3 text-[11px]">
          <TrackedLink event="related_click" eventTarget="stack-map->mcp" href="/learn/best-mcp-servers-for-claude-code" className="text-fm-link hover:text-fm-link-hover">Best MCP Servers for Claude Code</TrackedLink>
          <TrackedLink event="related_click" eventTarget="stack-map->frameworks" href="/learn/best-open-source-ai-agent-frameworks" className="text-fm-link hover:text-fm-link-hover">Best Open Source AI Agent Frameworks</TrackedLink>
          <TrackedLink event="related_click" eventTarget="stack-map->compare" href="/compare/langgraph-vs-crewai-vs-autogen" className="text-fm-link hover:text-fm-link-hover">LangGraph vs CrewAI vs AutoGen</TrackedLink>
          <TrackedLink event="related_click" eventTarget="stack-map->coding" href="/learn/best-coding-agents" className="text-fm-link hover:text-fm-link-hover">Best Coding Agents</TrackedLink>
          <TrackedLink event="related_click" eventTarget="stack-map->browser" href="/learn/best-browser-automation-tools-for-ai-agents" className="text-fm-link hover:text-fm-link-hover">Best Browser Automation Tools</TrackedLink>
          <TrackedLink event="related_click" eventTarget="stack-map->rag" href="/learn/best-rag-memory-tools-for-agents" className="text-fm-link hover:text-fm-link-hover">Best RAG and Memory Tools</TrackedLink>
          <TrackedLink event="related_click" eventTarget="stack-map->observability" href="/learn/best-ai-agent-observability-tools" className="text-fm-link hover:text-fm-link-hover">Best AI Agent Observability Tools</TrackedLink>
        </div>
      </section>

      <section className="border border-fm-border rounded p-4 bg-fm-sidebar-bg">
        <h2 className="text-[14px] font-bold text-fm-text mb-2">What most teams get wrong</h2>
        <p className="text-[11px] text-fm-text leading-relaxed">
          Most teams over-focus on the orchestration layer and under-invest in memory, observability, and tool reach. The agent usually looks smart in a demo
          long before it is controllable in production. If the system is failing in real work, the missing layer is often not the model — it is the stack around it.
        </p>
      </section>
    </div>
  );
}

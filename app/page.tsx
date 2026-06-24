import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { cleanAuthor } from "@/lib/author-slug";
import { classifyLicense, licenseKindClass } from "@/lib/license";
import { getLatestReleases, getCategories, getStats, getLanguages, type ReleaseSort } from "@/lib/queries";
import { isRankingV2Enabled } from "@/lib/ranking";
import { computeLifecycle } from "@/lib/lifecycle";
import { getCopy, LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n";
import ResearchFeed from "./components/research-feed";
import TrackedForm from "./components/tracked-form";
import TrackedLink from "./components/tracked-link";
import TrackedNextLink from "./components/tracked-next-link";

export const metadata: Metadata = {
  title: "freshcrate — open source packages for AI agents, MCP servers, and frameworks",
  description:
    "Discover open source AI agent packages, MCP servers, orchestration frameworks, coding agents, infrastructure, and research tooling. Fresh releases, ranked packages, and retrieval-friendly project pages.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "freshcrate — open source packages for AI agents, MCP servers, and frameworks",
    description:
      "Discover open source AI agent packages, MCP servers, orchestration frameworks, coding agents, infrastructure, and research tooling.",
    url: "https://www.freshcrate.ai/",
  },
  twitter: {
    title: "freshcrate — open source packages for AI agents, MCP servers, and frameworks",
    description:
      "Discover open source AI agent packages, MCP servers, orchestration frameworks, coding agents, infrastructure, and research tooling.",
  },
};

function LicensePill({ license, projectName }: { license: string; projectName?: string }) {
  const info = classifyLicense(license);
  const className = `${licenseKindClass(info.kind)} px-1.5 py-0.5 rounded text-[9px] font-mono font-bold`;
  if (info.isNonStandard && projectName) {
    return (
      <Link
        href={`/projects/${encodeURIComponent(projectName)}#license`}
        className={`${className} hover:underline`}
        title={info.raw.length > 120 ? info.raw.slice(0, 117) + "…" : info.raw}
      >
        {info.display}
      </Link>
    );
  }
  return (
    <span className={className} title={info.isNonStandard ? info.raw : undefined}>
      {info.display}
    </span>
  );
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const colors: Record<string, string> = {
    Low: "bg-fm-urgency-low",
    Medium: "bg-fm-urgency-medium",
    High: "bg-fm-urgency-high",
    Critical: "bg-fm-urgency-critical",
  };
  return (
    <span className={`${colors[urgency] || "bg-gray-500"} text-white text-[9px] px-1.5 py-0.5 rounded font-bold uppercase`}>
      {urgency}
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = now.getTime() - date.getTime();
  if (diff < 0) return "just now";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const featuredGuideCards = [
  {
    title: "Best MCP Servers for Claude Code",
    href: "/learn/best-mcp-servers-for-claude-code",
    summary: "Ranked picks for browser control, internal tool bridges, and Claude Code operator workflows.",
    eventTarget: "guide:mcp-claude-code@home",
  },
  {
    title: "Best Open Source AI Agent Frameworks",
    href: "/learn/best-open-source-ai-agent-frameworks",
    summary: "Direct selector for LangGraph, CrewAI, AgentScope, LangChain, and AutoGPT by use case.",
    eventTarget: "guide:agent-frameworks@home",
  },
  {
    title: "LangGraph vs CrewAI vs AutoGen",
    href: "/compare/langgraph-vs-crewai-vs-autogen",
    summary: "A concise verdict for stateful workflows, role-based teams, and Microsoft-style orchestration.",
    eventTarget: "guide:compare-langgraph-crewai-autogen@home",
  },
  {
    title: "Best Coding Agents and AI Dev Assistants",
    href: "/learn/best-coding-agents",
    summary: "Open source picks for terminal-first coding agents, local-first assistants, and repo automation workflows.",
    eventTarget: "guide:coding-agents@home",
  },
  {
    title: "AI Agent Stack Map",
    href: "/learn/ai-agent-stack-map",
    summary: "A hub page tying together frameworks, coding agents, browser layers, memory, observability, and MCP.",
    eventTarget: "guide:stack-map@home",
  },
] as const;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; category?: string; language?: string }>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const t = getCopy(locale);
  const homeT = t.home;
  const categories = getCategories();
  const languages = getLanguages();
  const stats = getStats();

  const defaultSort: ReleaseSort = isRankingV2Enabled() ? "rank" : "newest";
  const rawSort = typeof params.sort === "string" ? params.sort : defaultSort;
  const allowedSorts: ReleaseSort[] = ["rank", "newest", "oldest", "stars", "name"];
  const sort: ReleaseSort = allowedSorts.includes(rawSort as ReleaseSort)
    ? (rawSort as ReleaseSort)
    : defaultSort;

  const categorySet = new Set(categories.map((c) => c.category));
  const languageSet = new Set(languages.map((l) => l.language));

  const category =
    typeof params.category === "string" && categorySet.has(params.category)
      ? params.category
      : undefined;
  const language =
    typeof params.language === "string" && languageSet.has(params.language)
      ? params.language
      : undefined;

  const releases = getLatestReleases(50, 0, { sort, category, language });
  const topStructuredProjects = releases.slice(0, 8).map((project, index) => ({
    "@type": "ListItem",
    position: index + 1,
    url: `https://www.freshcrate.ai/projects/${encodeURIComponent(project.name)}`,
    name: project.name,
    description: project.short_desc,
  }));
  const homeJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": "https://www.freshcrate.ai/#website",
        url: "https://www.freshcrate.ai/",
        name: "freshcrate",
        description:
          "Open source package directory for AI agents, MCP servers, orchestration frameworks, coding agents, infrastructure, and research tooling.",
        inLanguage: ["en", "zh-CN"],
        potentialAction: {
          "@type": "SearchAction",
          target: "https://www.freshcrate.ai/search?q={search_term_string}",
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        "@id": "https://www.freshcrate.ai/#organization",
        name: "freshcrate",
        url: "https://www.freshcrate.ai/",
        logo: "https://www.freshcrate.ai/logo.png",
      },
      {
        "@type": "ItemList",
        "@id": "https://www.freshcrate.ai/#latest-releases",
        name: "Freshcrate latest releases",
        itemListElement: topStructuredProjects,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd) }}
      />
      <div className="flex flex-col md:flex-row gap-5">
      {/* Main content */}
      <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3 border-b-2 border-fm-green pb-1">
            <h2 className="feed-heading text-[14px] font-bold text-fm-green">{homeT.latestReleases}</h2>
            <span className="text-[10px] text-fm-text-light">{stats.projects} {homeT.packagesIndexed}</span>
          </div>

          <div className="bg-fm-sidebar-bg border border-fm-border rounded px-3 py-3 mb-3 text-[10px]">
            <div className="text-[12px] font-bold text-fm-green">freshcrate</div>
            <h1 className="text-fm-text mt-1 text-[15px] font-bold">{homeT.heroTitle}</h1>
            <div className="text-fm-text-light mt-1 leading-relaxed">
              {homeT.heroBody1}
            </div>
            <div className="flex flex-wrap gap-2 mt-2 text-[9px]">
              <span className="bg-fm-accent/10 text-fm-link px-1.5 py-0.5 rounded">{homeT.chipAgentEcosystem}</span>
              <span className="bg-fm-accent/10 text-fm-link px-1.5 py-0.5 rounded">{homeT.chipMcpServers}</span>
              <span className="bg-fm-accent/10 text-fm-link px-1.5 py-0.5 rounded">{homeT.chipOrchestration}</span>
              <span className="bg-fm-accent/10 text-fm-link px-1.5 py-0.5 rounded">{homeT.chipResearchInfra}</span>
            </div>
            <div className="flex flex-wrap gap-3 mt-3">
              <TrackedNextLink event="click" eventTarget="nav:browse@home" href="/browse" className="text-fm-link hover:text-fm-link-hover font-bold">{homeT.browse}</TrackedNextLink>
              <TrackedNextLink event="click" eventTarget="nav:orchestra@home" href="/orchestra" className="text-fm-link hover:text-fm-link-hover font-bold">{homeT.orchestra}</TrackedNextLink>
              <TrackedNextLink event="install" eventTarget="install:agent-edition@home" href="/agent-edition" className="text-fm-link hover:text-fm-link-hover">{homeT.agentEdition}</TrackedNextLink>
            </div>
          </div>

          <div className="bg-fm-sidebar-bg border border-fm-border rounded px-3 py-3 mb-3 text-[10px]">
            <div className="flex items-center justify-between border-b border-fm-border pb-1 mb-2">
              <h2 className="text-[12px] font-bold text-fm-green">Best of freshcrate</h2>
              <TrackedNextLink event="click" eventTarget="nav:learn@home-guides" href="/learn" className="text-fm-link hover:text-fm-link-hover text-[10px]">
                more guides →
              </TrackedNextLink>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              {featuredGuideCards.map((guide) => (
                <TrackedNextLink
                  key={guide.href}
                  event="related_click"
                  eventTarget={guide.eventTarget}
                  href={guide.href}
                  className="block rounded border border-fm-border bg-white/70 p-2 hover:bg-white"
                >
                  <div className="text-[11px] font-bold text-fm-link">{guide.title}</div>
                  <p className="mt-1 text-fm-text-light leading-relaxed">{guide.summary}</p>
                </TrackedNextLink>
              ))}
            </div>
          </div>

          <TrackedForm event="search" eventTarget="search:home-filter" method="GET" className="bg-fm-sidebar-bg border border-fm-border rounded px-2 py-2 mb-3 text-[10px]">
<div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-fm-text-light">{homeT.sort}</span>
              <select name="sort" defaultValue={sort} className="border border-fm-border bg-fm-bg px-1 py-0.5 text-[10px]">
                <option value="rank">{homeT.sortRecommended}</option>
                <option value="newest">{homeT.sortNewest}</option>
                <option value="oldest">{homeT.sortOldest}</option>
                <option value="stars">{homeT.sortMostStars}</option>
                <option value="name">{homeT.sortName}</option>
              </select>
            </label>

            <label className="flex flex-col gap-0.5">
              <span className="text-fm-text-light">{homeT.category}</span>
              <select name="category" defaultValue={category ?? ""} className="border border-fm-border bg-fm-bg px-1 py-0.5 text-[10px]">
                <option value="">{homeT.allCategories}</option>
                {categories.map((c) => (
                  <option key={c.category} value={c.category}>{c.category}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-0.5">
              <span className="text-fm-text-light">{homeT.language}</span>
              <select name="language" defaultValue={language ?? ""} className="border border-fm-border bg-fm-bg px-1 py-0.5 text-[10px]">
                <option value="">{homeT.allLanguages}</option>
                {languages.map((l) => (
                  <option key={l.language} value={l.language}>{l.language}</option>
                ))}
              </select>
            </label>

            <button type="submit" className="border border-fm-nav-border bg-fm-btn-bg text-fm-btn-text px-2 py-0.5 font-bold hover:opacity-90 rounded-fm-sm">
              {homeT.apply}
            </button>
            <Link href="/" className="text-fm-link hover:text-fm-link-hover">{homeT.reset}</Link>
            <span className="ml-auto text-fm-text-light">{homeT.showingResults.replace("{count}", String(releases.length))}</span>
          </div>
        </TrackedForm>

        <div className="space-y-0">
          {releases.length === 0 && (
            <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 text-[11px] text-fm-text-light italic">
              {homeT.noReleases}
            </div>
          )}
          {releases.map((project, i) => (
            <div
              key={project.id}
              className={`feed-item py-2.5 px-2 ${i % 2 === 0 ? "bg-fm-surface/40" : ""} border-b border-fm-border/50 hover:bg-fm-surface/70 transition-colors`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <TrackedNextLink
                      event="click"
                      eventTarget={`project:${project.name}@home`}
                      href={`/projects/${project.name}`}
                      className="feed-title text-[13px] font-bold text-fm-link hover:text-fm-link-hover"
                    >
                      {project.name}
                    </TrackedNextLink>
                    {project.repo_url && (
                      <TrackedLink
                        event="outbound"
                        eventTarget={`repo:${(() => { try { return new URL(project.repo_url).hostname; } catch { return ""; } })()}@home`}
                        href={project.repo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-fm-text-light hover:text-fm-link"
                        title="View source on GitHub"
                      >
                        &#128193;
                      </TrackedLink>
                    )}
                    <span className="text-[11px] text-fm-text-light font-mono">
                      {project.latest_version}
                    </span>
                    {(() => {
                      const lc = computeLifecycle({
                        stars: project.stars ?? 0,
                        forks: project.forks ?? 0,
                        releaseCount: project.release_count ?? 1,
                        lastReleaseDate: project.release_date,
                        createdAt: project.created_at,
                        verified: !!project.verified,
                        license: project.license,
                      });
                      return (
                        <span className={`${lc.color} ${lc.textColor} px-1.5 py-0.5 rounded text-[9px] font-bold`} title={lc.reason}>
                          {lc.emoji} {lc.label}
                        </span>
                      );
                    })()}
                  </div>
                  <p className="text-[11px] text-fm-text mb-1">{project.short_desc}</p>
                  <div className="text-[10px] text-fm-text-light">
                    <span className="italic">&ldquo;{project.latest_changes}&rdquo;</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {project.tags.map((tag) => (
                      <Link
                        key={tag}
                        href={`/tag/${encodeURIComponent(tag)}`}
                        className="text-[9px] bg-fm-accent/10 text-fm-link px-1.5 py-0.5 rounded hover:bg-fm-accent/20"
                      >
                        {tag}
                      </Link>
                    ))}
                  </div>
                  <div className="mt-1.5 flex items-center flex-wrap gap-2 text-[10px] text-fm-text-light">
                    <Link
                      href={`/browse?category=${encodeURIComponent(project.category)}`}
                      className="text-fm-link hover:text-fm-link-hover"
                      title="Category"
                    >
                      {project.category}
                    </Link>
                    <span className="text-fm-border" aria-hidden>·</span>
                    <LicensePill license={project.license} projectName={project.name} />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] text-fm-text-light">{timeAgo(project.release_date)}</div>
                  <div className="text-[10px] text-fm-text-light mt-0.5">by <Link href={`/author/${encodeURIComponent(cleanAuthor(project.author))}`} className="text-fm-link hover:text-fm-link-hover">{cleanAuthor(project.author)}</Link></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sidebar */}
      <aside className="w-full md:w-[220px] md:shrink-0 xl:w-[260px] 2xl:w-[300px]">
        <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 mb-4">
          <h3 className="text-[11px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">
            Agent Edition
          </h3>
          <p className="text-[10px] text-fm-text-light leading-relaxed mb-2">
            freshcrate Agent Edition is the Linux operator lane: minimal agentic substrate, Ubuntu 24.04 x86_64, headless first.
          </p>
          <div className="space-y-1.5 text-[10px]">
            <TrackedLink event="install" eventTarget="install:agent-edition@home-sidebar" href="/install/agent-edition" className="block text-fm-link hover:text-fm-link-hover">
              → Install freshcrate Agent Edition
            </TrackedLink>
          </div>
        </div>

        {/* Stats box */}
        <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 mb-4">
          <h3 className="text-[11px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">
            Statistics
          </h3>
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-fm-text-light">Packages:</span>
              <span className="font-bold">{stats.projects.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fm-text-light">Releases:</span>
              <span className="font-bold">{stats.releases.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fm-text-light">Categories:</span>
              <span className="font-bold">{stats.categories}</span>
            </div>
          </div>
        </div>

        {/* Categories */}
        <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 mb-4">
          <h3 className="text-[11px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">
            Categories
          </h3>
          <ul className="space-y-1">
            {categories.map((cat) => (
              <li key={cat.category} className="text-[11px] flex justify-between">
                <Link href={`/browse?category=${encodeURIComponent(cat.category)}`} className="text-fm-link hover:text-fm-link-hover">
                  {cat.category}
                </Link>
                <span className="text-fm-text-light">({cat.count})</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Agent Resources */}
        <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 mb-4">
          <h3 className="text-[11px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">
            Agent Resources
          </h3>
          <ul className="space-y-1.5 text-[11px]">
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:huggingface.co/models@home-resources" href="https://huggingface.co/models" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">HuggingFace Models</TrackedLink>
              <span className="text-fm-text-light"> &mdash; weights &amp; checkpoints</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:huggingface.co/datasets@home-resources" href="https://huggingface.co/datasets" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">HuggingFace Datasets</TrackedLink>
              <span className="text-fm-text-light"> &mdash; training &amp; eval data</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:arxiv.org/cs.ai@home-resources" href="https://arxiv.org/list/cs.AI/recent" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">arXiv cs.AI</TrackedLink>
              <span className="text-fm-text-light"> &mdash; latest AI papers</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:arxiv.org/cs.cl@home-resources" href="https://arxiv.org/list/cs.CL/recent" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">arXiv cs.CL</TrackedLink>
              <span className="text-fm-text-light"> &mdash; NLP &amp; LLM papers</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:modelcontextprotocol.io@home-resources" href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">MCP Spec</TrackedLink>
              <span className="text-fm-text-light"> &mdash; protocol docs</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:github.com/mcp-servers@home-resources" href="https://github.com/modelcontextprotocol/servers" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">MCP Servers</TrackedLink>
              <span className="text-fm-text-light"> &mdash; official registry</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:pypi.org/agents@home-resources" href="https://pypi.org/search/?q=agent&amp;o=-created" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">PyPI Agents</TrackedLink>
              <span className="text-fm-text-light"> &mdash; Python packages</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:npmjs.com/mcp-agent@home-resources" href="https://www.npmjs.com/search?q=mcp%20agent" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">npm Agents</TrackedLink>
              <span className="text-fm-text-light"> &mdash; JS/TS packages</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:paperswithcode.com/agents@home-resources" href="https://paperswithcode.com/area/agents" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">Papers With Code</TrackedLink>
              <span className="text-fm-text-light"> &mdash; benchmarks &amp; SotA</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:github.com/topics/ai-agent@home-resources" href="https://github.com/topics/ai-agent" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">GitHub #ai-agent</TrackedLink>
              <span className="text-fm-text-light"> &mdash; trending repos</span>
            </li>
          </ul>
        </div>

        {/* Live research + trending models */}
        <ResearchFeed />

        {/* Registries & Leaderboards */}
        <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 mb-4">
          <h3 className="text-[11px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">
            Leaderboards
          </h3>
          <ul className="space-y-1.5 text-[11px]">
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:huggingface.co/open-llm-leaderboard@home-leaderboards" href="https://huggingface.co/spaces/open-llm-leaderboard/open_llm_leaderboard" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">Open LLM Leaderboard</TrackedLink>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:lmarena.ai@home-leaderboards" href="https://lmarena.ai/?leaderboard" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">LM Arena (Chatbot Arena)</TrackedLink>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:swebench.com@home-leaderboards" href="https://www.swebench.com" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">SWE-bench</TrackedLink>
              <span className="text-fm-text-light"> &mdash; coding evals</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:aider.chat/leaderboards@home-leaderboards" href="https://aider.chat/docs/leaderboards/" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">Aider Leaderboard</TrackedLink>
              <span className="text-fm-text-light"> &mdash; code editing</span>
            </li>
          </ul>
        </div>

        {/* Open Source & Linux */}
        <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 mb-4">
          <h3 className="text-[11px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">
            Open Source &amp; Linux
          </h3>
          <ul className="space-y-1.5 text-[11px]">
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:opensource.org@home-oss" href="https://opensource.org" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">Open Source Initiative</TrackedLink>
              <span className="text-fm-text-light"> &mdash; OSI license standards</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:fsf.org@home-oss" href="https://www.fsf.org" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">Free Software Foundation</TrackedLink>
              <span className="text-fm-text-light"> &mdash; FSF &amp; GNU project</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:linuxfoundation.org@home-oss" href="https://www.linuxfoundation.org" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">Linux Foundation</TrackedLink>
              <span className="text-fm-text-light"> &mdash; kernel &amp; projects</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:apache.org@home-oss" href="https://www.apache.org" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">Apache Software Foundation</TrackedLink>
              <span className="text-fm-text-light"> &mdash; ASF projects</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:eclipse.org@home-oss" href="https://www.eclipse.org" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">Eclipse Foundation</TrackedLink>
              <span className="text-fm-text-light"> &mdash; enterprise OSS</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:cncf.io@home-oss" href="https://www.cncf.io" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">CNCF</TrackedLink>
              <span className="text-fm-text-light"> &mdash; cloud native projects</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:kernel.org@home-oss" href="https://kernel.org" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">kernel.org</TrackedLink>
              <span className="text-fm-text-light"> &mdash; Linux kernel source</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:lwn.net@home-oss" href="https://lwn.net" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">LWN.net</TrackedLink>
              <span className="text-fm-text-light"> &mdash; Linux &amp; FOSS news</span>
            </li>
            <li>
              <TrackedLink event="outbound" eventTarget="outbound:choosealicense.com@home-oss" href="https://choosealicense.com" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">Choose a License</TrackedLink>
              <span className="text-fm-text-light"> &mdash; license picker</span>
            </li>
          </ul>
        </div>

        {/* Licensing for Agents */}
        <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 mb-4">
          <h3 className="text-[11px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">
            Licensing for Agents
          </h3>
          <p className="text-[10px] text-fm-text-light leading-relaxed mb-2">
            Agents that read, fork, transform, or bundle code must
            respect the license on every dependency they touch.
          </p>
          <div className="space-y-2 text-[10px]">
            <div>
              <span className="font-bold text-fm-text">Permissive</span>
              <span className="text-fm-text-light"> &mdash; use freely, keep attribution</span>
              <div className="flex flex-wrap gap-1 mt-1">
                <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded text-[9px] font-mono">MIT</span>
                <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded text-[9px] font-mono">Apache-2.0</span>
                <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded text-[9px] font-mono">BSD-2/3</span>
                <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded text-[9px] font-mono">ISC</span>
              </div>
            </div>
            <div>
              <span className="font-bold text-fm-text">Copyleft</span>
              <span className="text-fm-text-light"> &mdash; derivatives must stay open</span>
              <div className="flex flex-wrap gap-1 mt-1">
                <span className="bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded text-[9px] font-mono">GPL-2.0</span>
                <span className="bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded text-[9px] font-mono">GPL-3.0</span>
                <span className="bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded text-[9px] font-mono">AGPL-3.0</span>
                <span className="bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded text-[9px] font-mono">MPL-2.0</span>
              </div>
            </div>
            <div>
              <span className="font-bold text-fm-text">Weak copyleft</span>
              <span className="text-fm-text-light"> &mdash; link freely, share changes to lib</span>
              <div className="flex flex-wrap gap-1 mt-1">
                <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded text-[9px] font-mono">LGPL-2.1</span>
                <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded text-[9px] font-mono">LGPL-3.0</span>
                <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded text-[9px] font-mono">EPL-2.0</span>
              </div>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-fm-border space-y-1.5">
            <p className="text-[10px] font-bold text-fm-text">Key rules for agents:</p>
            <ul className="text-[10px] text-fm-text-light space-y-1 list-none">
              <li><span className="text-fm-text font-bold">1.</span> Always check LICENSE before using code</li>
              <li><span className="text-fm-text font-bold">2.</span> AGPL triggers on network use &mdash; serving AGPL code over an API requires source disclosure</li>
              <li><span className="text-fm-text font-bold">3.</span> Copyleft is viral &mdash; one GPL dep can relicense your entire output</li>
              <li><span className="text-fm-text font-bold">4.</span> Attribution is non-optional &mdash; MIT/Apache require copyright notice in distributions</li>
              <li><span className="text-fm-text font-bold">5.</span> Patent grants differ &mdash; Apache-2.0 grants patents, MIT does not</li>
              <li><span className="text-fm-text font-bold">6.</span> No license = all rights reserved &mdash; don&apos;t assume public repos are free to use</li>
            </ul>
          </div>
          <div className="mt-3 pt-2 border-t border-fm-border space-y-1">
            <p className="text-[10px] font-bold text-fm-text">Learn more:</p>
            <ul className="space-y-1 text-[10px]">
              <li>
                <TrackedLink event="outbound" eventTarget="outbound:choosealicense.com@home-licensing" href="https://choosealicense.com" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">choosealicense.com</TrackedLink>
                <span className="text-fm-text-light"> &mdash; plain-English comparison</span>
              </li>
              <li>
                <TrackedLink event="outbound" eventTarget="outbound:opensource.org/licenses@home-licensing" href="https://opensource.org/licenses" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">OSI Approved Licenses</TrackedLink>
                <span className="text-fm-text-light"> &mdash; canonical list</span>
              </li>
              <li>
                <TrackedLink event="outbound" eventTarget="outbound:gnu.org/licenses@home-licensing" href="https://www.gnu.org/licenses/license-list.html" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">GNU License List</TrackedLink>
                <span className="text-fm-text-light"> &mdash; FSF compatibility matrix</span>
              </li>
              <li>
                <TrackedLink event="outbound" eventTarget="outbound:spdx.org/licenses@home-licensing" href="https://spdx.org/licenses/" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">SPDX License List</TrackedLink>
                <span className="text-fm-text-light"> &mdash; standard identifiers</span>
              </li>
              <li>
                <TrackedLink event="outbound" eventTarget="outbound:tldrlegal.com@home-licensing" href="https://tldrlegal.com" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">tl;drLegal</TrackedLink>
                <span className="text-fm-text-light"> &mdash; can/can&apos;t/must summaries</span>
              </li>
              <li>
                <TrackedLink event="outbound" eventTarget="outbound:apache.org/legal@home-licensing" href="https://www.apache.org/legal/resolved.html" target="_blank" rel="noopener noreferrer" className="text-fm-link hover:text-fm-link-hover">Apache Legal</TrackedLink>
                <span className="text-fm-text-light"> &mdash; compatibility policy</span>
              </li>
            </ul>
          </div>
        </div>

        {/* About */}
        <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 mb-4">
          <h3 className="text-[11px] font-bold text-fm-green border-b border-fm-border pb-1 mb-2">
            About freshcrate
          </h3>
          <p className="text-[10px] text-fm-text-light leading-relaxed">
            freshcrate is the open source package directory for AI agents.
            Discover tools, frameworks, and libraries that agents are building and publishing.
            Submit your own packages via the web form or the API.
          </p>
        </div>

        {/* 📻 */}
        <TrackedLink
          event="outbound"
          eventTarget="outbound:plaza.one@home-sidebar"
          href="https://plaza.one/"
          target="_blank"
          rel="noopener noreferrer"
          className="block border border-[#2a1a3a] rounded p-3 text-center no-underline hover:border-[#ff71ce] transition-colors"
          style={{ background: "linear-gradient(135deg, #1a0a2e 0%, #16213e 50%, #0f3460 100%)" }}
          title="Preferred streaming partner for late-night coding sessions"
        >
          <div className="text-[10px] font-mono" style={{ color: "#ff71ce" }}>
            ▶ ｐ ｌ ａ ｚ ａ ． ｏ ｎ ｅ
          </div>
          <div className="text-[8px] mt-1" style={{ color: "#b967ff" }}>
            preferred agent streaming music partner
          </div>
          <div className="text-[7px] mt-0.5" style={{ color: "#05ffa1", opacity: 0.6 }}>
            ░▒▓ 24/7 vaporwave for your token window ▓▒░
          </div>
        </TrackedLink>
      </aside>
      </div>
    </>
  );
}

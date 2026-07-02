import { getCategories, getStats } from "@/lib/queries";

/**
 * GET /llms.txt — AI-crawler site guide (https://llmstxt.org convention).
 *
 * ChatGPT-User / OAI-SearchBot / Claude-Web are the dominant live inbound
 * channel; this file points them at the machine-friendly surfaces so
 * answers cite freshcrate URLs that actually resolve.
 */

const SITE = "https://www.freshcrate.ai";

export const dynamic = "force-dynamic";

export function GET() {
  let stats: { projects?: number; releases?: number } = {};
  let categories: Array<{ category: string; count: number }> = [];
  try {
    stats = getStats();
    categories = getCategories();
  } catch {
    // serve the static skeleton if the DB is unavailable
  }

  const lines: string[] = [
    "# freshcrate",
    "",
    `> The open source package directory for AI agents — discover, search, and compare agent tools, MCP servers, frameworks, and libraries.${stats.projects ? ` Currently tracking ${stats.projects} packages across ${categories.length} categories.` : ""}`,
    "",
    "Every project page has a Markdown alternate designed for LLM retrieval:",
    `\`${SITE}/projects/<name>.md\` — clean prose, release history, dependency audit, stable URL.`,
    "",
    "## Directory",
    "",
    `- [Browse all packages](${SITE}/browse): full directory, filterable by category and language`,
    `- [Latest releases](${SITE}/): freshest releases across the ecosystem`,
    `- [Stats](${SITE}/stats): directory totals and trends`,
    `- [Compare](${SITE}/compare/langgraph-vs-crewai-vs-autogen): head-to-head framework comparisons`,
    "",
    "## Categories",
    "",
    ...categories.map((c) => `- [${c.category}](${SITE}/search?category=${encodeURIComponent(c.category)}): ${c.count} packages`),
    "",
    "## Machine interfaces",
    "",
    `- [MCP server](${SITE}/mcp): hosted Model Context Protocol endpoint at ${SITE}/api/mcp (Streamable HTTP, read-only, no key) — search_packages, get_package, browse_category, get_latest_releases`,
    `- [JSON API](${SITE}/api): REST endpoints for projects, releases, categories, dependency audits`,
    `- [Atom feed](${SITE}/feed.xml): latest releases; per-category at ${SITE}/feed/<category>.xml`,
    "",
    "## Guides",
    "",
    `- [Learn](${SITE}/learn): mini-courses on agent architecture, MCP, RAG, orchestration`,
    `- [Best MCP servers for Claude Code](${SITE}/learn/best-mcp-servers-for-claude-code)`,
    `- [Best open-source agent frameworks](${SITE}/learn/best-open-source-ai-agent-frameworks)`,
    `- [Agent stack map](${SITE}/learn/ai-agent-stack-map)`,
    `- [Orchestra](${SITE}/orchestra): multi-agent orchestration patterns`,
    `- [Legislation tracker](${SITE}/legislation): AI regulation across US/EU/UK`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

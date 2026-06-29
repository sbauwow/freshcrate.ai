import type { Metadata } from "next";
import Link from "next/link";
import { getStats } from "@/lib/queries";

export const metadata: Metadata = {
  title: "freshcrate MCP — the agent ecosystem, as an MCP server",
  description:
    "Add freshcrate to Claude Code, Claude Desktop, Cursor, or any MCP client with one URL. Search, browse, and inspect open-source agent packages from inside your agent — zero install.",
};

export const dynamic = "force-dynamic";

const ENDPOINT = "https://www.freshcrate.ai/api/mcp";

const TOOLS: { name: string; desc: string }[] = [
  { name: "search_packages", desc: "Search the directory by name, description, or tags." },
  { name: "get_package", desc: "Full detail for one package, including release history." },
  { name: "list_categories", desc: "All categories with package counts." },
  { name: "browse_category", desc: "Every package in a category." },
  { name: "get_latest_releases", desc: "The freshest releases across the ecosystem." },
  { name: "get_stats", desc: "Directory totals — packages, releases, categories." },
];

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-fm-bg border border-fm-border rounded-fm-sm p-2 overflow-x-auto text-[11px] font-mono text-fm-text whitespace-pre">
      {children}
    </pre>
  );
}

export default function McpPage() {
  let stats: { projects?: number } = {};
  try {
    stats = getStats();
  } catch {
    stats = {};
  }

  return (
    <div className="max-w-[800px]">
      <div className="flex items-center justify-between mb-3 border-b-2 border-fm-green pb-1">
        <h2 className="text-[16px] font-bold text-fm-green">freshcrate MCP server 🔌</h2>
      </div>

      <p className="text-fm-text mb-3 leading-relaxed">
        The tagline is &ldquo;open source packages <em>for agents</em>&rdquo; — so freshcrate is itself
        an <strong>MCP server</strong>. Point any MCP client at one URL and your agent can search,
        browse, and inspect the whole directory{stats.projects ? ` (${stats.projects} packages and counting)` : ""}{" "}
        without leaving the conversation. No install, no API key, read-only.
      </p>

      <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 mb-4">
        <div className="text-[11px] font-bold text-fm-text-light mb-1">Endpoint (Streamable HTTP)</div>
        <Code>{ENDPOINT}</Code>
      </div>

      <h3 className="text-[13px] font-bold text-fm-text mb-1">Claude Code</h3>
      <Code>{`claude mcp add --transport http freshcrate ${ENDPOINT}`}</Code>

      <h3 className="text-[13px] font-bold text-fm-text mb-1 mt-4">Claude Desktop / generic client</h3>
      <p className="text-[11px] text-fm-text-light mb-1">
        Add to <span className="font-mono">claude_desktop_config.json</span> (or any client&apos;s MCP config):
      </p>
      <Code>{`{
  "mcpServers": {
    "freshcrate": {
      "type": "http",
      "url": "${ENDPOINT}"
    }
  }
}`}</Code>

      <h3 className="text-[13px] font-bold text-fm-text mb-1 mt-4">Cursor</h3>
      <p className="text-[11px] text-fm-text-light mb-1">
        Add to <span className="font-mono">.cursor/mcp.json</span>:
      </p>
      <Code>{`{
  "mcpServers": {
    "freshcrate": { "url": "${ENDPOINT}" }
  }
}`}</Code>

      <h3 className="text-[13px] font-bold text-fm-text mb-2 mt-5">Tools</h3>
      <div className="bg-fm-sidebar-bg border border-fm-border rounded p-3 mb-4">
        <ul className="space-y-1.5">
          {TOOLS.map((t) => (
            <li key={t.name} className="text-[11px]">
              <span className="font-mono font-bold text-fm-accent">{t.name}</span>
              <span className="text-fm-text-light"> — {t.desc}</span>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-fm-text-light mt-2 italic">
          Mutating tools (submit, verify, watch) are intentionally not exposed on the public endpoint.
        </p>
      </div>

      <p className="text-[11px] text-fm-text-light">
        Prefer raw HTTP? The same data is on the{" "}
        <Link href="/api" className="text-fm-link hover:text-fm-link-hover">
          JSON API
        </Link>
        . Browse the directory in your{" "}
        <Link href="/" className="text-fm-link hover:text-fm-link-hover">
          browser
        </Link>
        .
      </p>
    </div>
  );
}

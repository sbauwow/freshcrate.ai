/**
 * Shared freshcrate MCP tool/resource registry.
 *
 * Registered onto an McpServer by both transports:
 *   - mcp/server.ts          stdio (local/admin)  -> allowWrites: true
 *   - app/api/mcp/route.ts    hosted Streamable HTTP (public) -> allowWrites: false
 *
 * Read/discovery tools are always registered. Mutating + admin tools
 * (submit/enrich/verify/watch) are registered only when allowWrites is true,
 * so the public hosted endpoint cannot be used to write to the directory,
 * burn the GitHub API, or mutate the topic watcher.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  getLatestReleases,
  getProjectByName,
  getProjectReleases,
  getCategories,
  getProjectsByCategory,
  searchProjects,
  getStats,
  submitProject,
} from "../lib/queries";
import { CATEGORIES, categorize } from "../lib/categories";
import { verifyAndStore } from "../lib/verify";
import { getDb } from "../lib/db";

export interface RegisterOptions {
  /** Register mutating + admin tools (submit/enrich/verify/watch). */
  allowWrites: boolean;
}

export function registerFreshcrateTools(server: McpServer, opts: RegisterOptions): void {
  // ── Read / discovery tools (always public) ──────────────────────────

  server.tool(
    "search_packages",
    "Search the freshcrate package directory by name, description, or tags. Returns matching packages with latest release info.",
    {
      query: z.string().describe("Search query — matches against package names, descriptions, and tags"),
      limit: z.number().int().min(1).max(50).optional().describe("Max results to return (default 20)"),
    },
    async ({ query, limit }) => {
      const results = searchProjects(query);
      const limited = results.slice(0, limit ?? 20);
      return text({ query, count: limited.length, total: results.length, packages: limited.map(formatPackage) });
    }
  );

  server.tool(
    "get_package",
    "Get detailed information about a specific package including full release history.",
    {
      name: z.string().describe("Package name (e.g., 'langchain', 'mcp-toolbox')"),
    },
    async ({ name }) => {
      const project = getProjectByName(name);
      if (!project) return errorText(`Package "${name}" not found.`);
      const releases = getProjectReleases(project.id);
      return text({
        ...formatPackage(project),
        description: project.description,
        releases: releases.map((r) => ({ version: r.version, changes: r.changes, urgency: r.urgency, date: r.created_at })),
      });
    }
  );

  server.tool(
    "list_categories",
    "List all package categories with their package counts.",
    {},
    async () => text({ categories: getCategories() })
  );

  server.tool(
    "browse_category",
    "List all packages in a specific category.",
    {
      category: z.string().describe(`Category name. Valid categories: ${CATEGORIES.join(", ")}`),
    },
    async ({ category }) => {
      const projects = getProjectsByCategory(category);
      return text({ category, count: projects.length, packages: projects.map(formatPackage) });
    }
  );

  server.tool(
    "get_latest_releases",
    "Get the most recent package releases across all categories. Like the freshcrate homepage feed.",
    {
      limit: z.number().int().min(1).max(100).optional().describe("Number of releases (default 20)"),
      offset: z.number().int().min(0).optional().describe("Pagination offset (default 0)"),
    },
    async ({ limit, offset }) => {
      const releases = getLatestReleases(limit ?? 20, offset ?? 0);
      return text({ count: releases.length, packages: releases.map(formatPackage) });
    }
  );

  server.tool(
    "get_stats",
    "Get freshcrate directory statistics — total packages, releases, and categories.",
    {},
    async () => text(getStats())
  );

  // ── Resources (always public) ───────────────────────────────────────

  server.resource("categories", "freshcrate://categories", async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(CATEGORIES) }],
  }));

  server.resource("stats", "freshcrate://stats", async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(getStats()) }],
  }));

  if (!opts.allowWrites) return;

  // ── Mutating + admin tools (gated; stdio / authenticated only) ───────

  server.tool(
    "submit_package",
    "Submit a new package to the freshcrate directory. Requires name, description, version, author, and category.",
    {
      name: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).max(100).describe("Package name — lowercase alphanumeric, dots, hyphens, underscores"),
      short_desc: z.string().max(200).describe("One-line description (max 200 chars)"),
      description: z.string().max(5000).optional().describe("Full description"),
      homepage_url: z.string().url().optional().describe("Project homepage URL"),
      repo_url: z.string().url().optional().describe("Source code repository URL"),
      license: z.string().optional().describe("SPDX license identifier (default: MIT)"),
      category: z.string().describe(`Package category. Valid: ${CATEGORIES.join(", ")}`),
      author: z.string().max(100).describe("Author or organization name"),
      version: z.string().max(50).describe("Version string (e.g., '1.0.0')"),
      changes: z.string().max(2000).optional().describe("Changelog for this version"),
      tags: z.array(z.string()).max(10).optional().describe("Tags (max 10)"),
    },
    async (data) => {
      const existing = getProjectByName(data.name);
      if (existing) return errorText(`Package "${data.name}" already exists.`);
      if (!CATEGORIES.includes(data.category as (typeof CATEGORIES)[number])) {
        return errorText(`Invalid category "${data.category}". Valid categories: ${CATEGORIES.join(", ")}`);
      }
      try {
        const projectId = submitProject({
          name: data.name,
          short_desc: data.short_desc,
          description: data.description ?? "",
          homepage_url: data.homepage_url ?? "",
          repo_url: data.repo_url ?? "",
          license: data.license ?? "MIT",
          category: data.category,
          author: data.author,
          version: data.version,
          changes: data.changes ?? "",
          tags: data.tags ?? [],
        });
        return text({ success: true, id: projectId, name: data.name, url: `https://freshcrate.ai/projects/${data.name}` });
      } catch (err) {
        return errorText(`Submission failed: ${(err as Error).message}`);
      }
    }
  );

  server.tool(
    "enrich_repo",
    "Fetch GitHub repository metadata and auto-categorize it for submission. Returns pre-filled package data.",
    {
      url: z.string().describe("GitHub URL (https://github.com/owner/repo) or owner/repo slug"),
    },
    async ({ url }) => {
      const parsed = parseRepo(url);
      if (!parsed) return errorText("Could not parse GitHub repo from input. Use https://github.com/owner/repo or owner/repo format.");
      const { owner, repo } = parsed;
      try {
        const [repoData, releaseData] = await Promise.all([
          ghFetch(`https://api.github.com/repos/${owner}/${repo}`),
          ghFetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`),
        ]);
        if (!repoData) return errorText(`Repository ${owner}/${repo} not found.`);

        let version = "";
        let changes = "";
        let releaseDate = repoData.pushed_at;
        if (releaseData?.tag_name) {
          version = releaseData.tag_name;
          changes = (releaseData.body || "").slice(0, 500).replace(/\r?\n/g, " ");
          releaseDate = releaseData.published_at || releaseDate;
        } else {
          const tags = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/tags?per_page=1`);
          if (tags?.[0]) version = tags[0].name;
        }

        const topics: string[] = repoData.topics || [];
        const language = repoData.language;
        const allTags = [...topics];
        if (language && !allTags.includes(language.toLowerCase())) allTags.push(language.toLowerCase());

        return text({
          name: repoData.name.toLowerCase(),
          short_desc: (repoData.description || "").slice(0, 200),
          description: repoData.description || "",
          homepage_url: repoData.homepage || repoData.html_url,
          repo_url: repoData.html_url,
          license: repoData.license?.spdx_id || "Unknown",
          category: categorize(repoData.name, repoData.description || "", topics),
          author: owner,
          version: version || "0.0.0",
          changes,
          tags: allTags.slice(0, 10),
          _meta: {
            stars: repoData.stargazers_count,
            forks: repoData.forks_count,
            language,
            updated_at: repoData.updated_at,
            release_date: releaseDate,
            open_issues: repoData.open_issues_count,
          },
        });
      } catch (err) {
        return errorText(`GitHub API error: ${(err as Error).message}`);
      }
    }
  );

  server.tool(
    "verify_package",
    "Run verification checks against a package and store the results. Checks GitHub repo existence, activity, license, stars, etc.",
    {
      name: z.string().describe("Package name to verify (e.g., 'langchain')"),
    },
    async ({ name }) => {
      const project = getProjectByName(name);
      if (!project) return errorText(`Package "${name}" not found.`);
      try {
        return text(await verifyAndStore(project.id));
      } catch (err) {
        return errorText(`Verification failed: ${(err as Error).message}`);
      }
    }
  );

  server.tool(
    "list_watched_topics",
    "List all GitHub topics being watched for new packages.",
    {},
    async () => {
      const topics = getDb()
        .prepare("SELECT topic, active, last_checked_at, repos_found, repos_added FROM watched_topics ORDER BY topic")
        .all();
      return text({ topics, count: topics.length });
    }
  );

  server.tool(
    "watch_topic",
    "Add a new GitHub topic to watch for new packages. The topic watcher polls GitHub periodically and auto-ingests new repos.",
    {
      topic: z.string().describe("GitHub topic to watch (e.g., 'ai-agent', 'mcp-server')"),
    },
    async ({ topic }) => {
      const clean = topic.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 50);
      getDb().prepare("INSERT OR IGNORE INTO watched_topics (topic) VALUES (?)").run(clean);
      return text({ topic: clean, status: "watching" });
    }
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function text(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function errorText(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function formatPackage(p: any) {
  return {
    name: p.name,
    short_desc: p.short_desc,
    version: p.latest_version,
    urgency: p.latest_urgency,
    category: p.category,
    author: p.author,
    license: p.license,
    homepage_url: p.homepage_url,
    repo_url: p.repo_url,
    tags: p.tags,
    release_date: p.release_date,
    url: `https://freshcrate.ai/projects/${p.name}`,
  };
}

function parseRepo(input: string): { owner: string; repo: string } | null {
  const urlMatch = input.match(/(?:https?:\/\/)?github\.com\/([^/\s]+)\/([^/\s#?]+)/);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, "") };
  const slugMatch = input.trim().match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (slugMatch) return { owner: slugMatch[1], repo: slugMatch[2] };
  return null;
}

async function ghFetch(url: string): Promise<any> {
  const token = process.env.GITHUB_TOKEN || "";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "freshcrate-mcp",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  return res.json();
}

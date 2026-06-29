/**
 * Hosted freshcrate MCP server — zero-install, read-only.
 *
 * Streamable HTTP (Web Standard) transport at /api/mcp. Any MCP client
 * (Claude Code/Desktop, Cursor, Cline, …) can add this with one URL and no
 * install:
 *
 *   claude mcp add --transport http freshcrate https://www.freshcrate.ai/api/mcp
 *
 * Stateless: each request builds a fresh server + transport and serves the
 * read/discovery tools only (allowWrites: false). Mutating/admin tools live
 * on the stdio entrypoint (mcp/server.ts), never on the public URL.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerFreshcrateTools } from "@/mcp/register";

// better-sqlite3 needs the Node runtime; never cache an MCP exchange.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  const server = new McpServer({ name: "freshcrate", version: "0.1.0" });
  registerFreshcrateTools(server, { allowWrites: false });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no server-side session
    enableJsonResponse: true, // plain JSON request/response, no long-lived SSE
  });

  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Stateless: tear down the per-request server/transport.
    await transport.close();
    await server.close();
  }
}

export { handle as GET, handle as POST, handle as DELETE };

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

// The endpoint is keyless by design, so throttle per IP instead. In-memory is
// enough: the app runs as a single long-lived Railway process.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 60;
const rateSlots = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(req: Request): boolean {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const now = Date.now();

  if (rateSlots.size > 10_000) {
    for (const [key, slot] of rateSlots) {
      if (now - slot.windowStart >= RATE_WINDOW_MS) rateSlots.delete(key);
    }
  }

  const slot = rateSlots.get(ip);
  if (!slot || now - slot.windowStart >= RATE_WINDOW_MS) {
    rateSlots.set(ip, { count: 1, windowStart: now });
    return false;
  }
  slot.count += 1;
  return slot.count > RATE_MAX_REQUESTS;
}

async function handle(req: Request): Promise<Response> {
  if (isRateLimited(req)) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Rate limit exceeded — max 60 requests/minute" }, id: null },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }

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

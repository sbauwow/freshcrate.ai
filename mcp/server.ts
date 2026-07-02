#!/usr/bin/env node
/**
 * freshcrate MCP Server — stdio transport (local / admin).
 *
 * Exposes the freshcrate package directory as MCP tools so any
 * MCP-compatible agent (Claude, Cursor, Windsurf, etc.) can discover,
 * search, and publish packages natively. This entrypoint runs against the
 * local data layer and enables the mutating/admin tools.
 *
 * For the zero-install, read-only HOSTED endpoint see app/api/mcp/route.ts
 * (Streamable HTTP at https://www.freshcrate.ai/api/mcp).
 *
 * Usage:
 *   npx tsx mcp/server.ts          # stdio transport
 *
 * Config (claude_desktop_config.json / .cursor/mcp.json):
 *   {
 *     "mcpServers": {
 *       "freshcrate": {
 *         "command": "npx",
 *         "args": ["tsx", "mcp/server.ts"],
 *         "cwd": "/path/to/freshcrate"
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerFreshcrateTools } from "./register";

const server = new McpServer({ name: "freshcrate", version: "0.1.0" });

// stdio is the trusted local entrypoint — expose the full toolset.
registerFreshcrateTools(server, { allowWrites: true });

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("freshcrate MCP server error:", err);
  process.exit(1);
});

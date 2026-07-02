import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { POST as mcpPOST } from "@/app/api/mcp/route";
import { createTestDb, insertTestProject, _resetDb } from "./setup";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  _resetDb();
});

let nextIp = 0;

/** Each call gets a unique client IP so tests don't trip the per-IP limiter. */
function rpc(body: unknown, ip?: string): Request {
  return new Request("https://www.freshcrate.ai/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-forwarded-for": ip ?? `10.0.${Math.floor(nextIp / 256)}.${nextIp++ % 256}`,
    },
    body: JSON.stringify(body),
  });
}

function initialize(id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "0.0.0" },
    },
  };
}

describe("hosted MCP endpoint", () => {
  it("answers initialize with the freshcrate server identity", async () => {
    const res = await mcpPOST(rpc(initialize()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.serverInfo.name).toBe("freshcrate");
  });

  it("lists read/discovery tools but no mutating tools", async () => {
    const res = await mcpPOST(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    expect(res.status).toBe(200);
    const json = await res.json();
    const names = json.result.tools.map((t: { name: string }) => t.name);

    expect(names).toContain("search_packages");
    expect(names).toContain("get_package");
    expect(names).toContain("browse_category");
    expect(names).toContain("get_latest_releases");
    expect(names).not.toContain("submit_package");
    expect(names).not.toContain("verify_package");
    expect(names).not.toContain("watch_topic");
  });

  it("serves search_packages tool calls from the directory", async () => {
    insertTestProject(db, { name: "agent-scout", short_desc: "Scouts agents", tags: ["agents"] });

    const res = await mcpPOST(
      rpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "search_packages", arguments: { query: "agent-scout" } },
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    const payload = JSON.parse(json.result.content[0].text);
    expect(payload.count).toBe(1);
    expect(payload.packages[0].name).toBe("agent-scout");
  });

  it("rate limits repeated requests from one IP with a 429", async () => {
    const ip = "203.0.113.99";
    let limited: Response | null = null;
    for (let i = 0; i < 61; i++) {
      const res = await mcpPOST(rpc({ jsonrpc: "2.0", id: 100 + i, method: "tools/list", params: {} }, ip));
      if (res.status === 429) {
        limited = res;
        break;
      }
    }
    expect(limited).not.toBeNull();
    expect(limited!.headers.get("retry-after")).toBe("60");
    const json = await limited!.json();
    expect(json.error.message).toMatch(/rate limit/i);
  });
});

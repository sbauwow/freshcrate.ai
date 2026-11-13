import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import Database from "better-sqlite3";
import { createTestDb, _resetDb } from "./setup";
import { POST as submitContact } from "@/app/api/human-contact/route";
import { GET as reviewGet, POST as reviewPost } from "@/app/api/admin/review/route";
import { approveSuggestion, rejectSubmission } from "@/lib/review-queue";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";

const ADMIN_TOKEN = "test-admin-token-0123456789";
let db: Database.Database;

function req(
  url: string,
  init?: { method?: string; body?: string },
  admin = true
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (admin) headers.cookie = `${ADMIN_COOKIE_NAME}=${ADMIN_TOKEN}`;
  return new NextRequest(url, { method: init?.method, body: init?.body, headers });
}

function jsonReq(url: string, body: unknown, admin = true): NextRequest {
  return req(url, { method: "POST", body: JSON.stringify(body) }, admin);
}

async function addSuggestion(url = "https://github.com/owner/repo", message = "please list this") {
  const res = await submitContact(
    req(
      "https://www.freshcrate.ai/api/human-contact",
      {
        method: "POST",
        body: JSON.stringify({ tab: "suggest", url, message, page: "/submit" }),
      },
      false
    )
  );
  expect(res.status).toBe(202);
}

beforeEach(() => {
  db = createTestDb();
  process.env.FRESHCRATE_ADMIN_TOKEN = ADMIN_TOKEN;
  // GitHub is unreachable in tests -> ghFetch returns null -> fallback metadata.
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    if (String(input).startsWith("https://api.github.com/")) {
      return new Response("rate limited", { status: 429 });
    }
    return new Response("unexpected fetch", { status: 599 });
  }));
});

afterEach(() => {
  _resetDb();
  vi.unstubAllGlobals();
  delete process.env.FRESHCRATE_ADMIN_TOKEN;
});

describe("review queue lib", () => {
  it("rejects a submission and refuses to review it twice", async () => {
    await addSuggestion();
    const r1 = rejectSubmission(1);
    expect(r1.ok).toBe(true);
    const row = db.prepare("SELECT review_status, reviewed_at FROM contact_messages WHERE id = 1").get() as {
      review_status: string;
      reviewed_at: string;
    };
    expect(row.review_status).toBe("rejected");
    expect(row.reviewed_at).toBeTruthy();

    const r2 = rejectSubmission(1);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/already reviewed/i);
  });

  it("approves with fallback metadata when GitHub is unreachable", async () => {
    await addSuggestion();
    const r = await approveSuggestion(1, "AI Agents");
    expect(r.ok).toBe(true);

    const project = db.prepare("SELECT * FROM projects WHERE name = 'repo'").get() as Record<string, unknown>;
    expect(project).toBeTruthy();
    expect(project.author).toBe("owner");
    expect(project.repo_url).toBe("https://github.com/owner/repo");
    expect(project.category).toBe("AI Agents");
    expect(project.short_desc).toBe("please list this");

    const row = db.prepare("SELECT review_status FROM contact_messages WHERE id = 1").get() as {
      review_status: string;
    };
    expect(row.review_status).toBe("approved");
  });

  it("uses GitHub metadata when the API answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      if (String(input) === "https://api.github.com/repos/owner/repo") {
        return new Response(
          JSON.stringify({
            html_url: "https://github.com/owner/repo",
            description: "A cool agent framework",
            owner: { login: "owner" },
            license: { spdx_id: "Apache-2.0" },
          }),
          { status: 200 }
        );
      }
      return new Response("nope", { status: 404 });
    }));

    await addSuggestion();
    const r = await approveSuggestion(1, "Frameworks");
    expect(r.ok).toBe(true);
    const project = db.prepare("SELECT * FROM projects WHERE name = 'repo'").get() as Record<string, unknown>;
    expect(project.short_desc).toBe("A cool agent framework");
    expect(project.license).toBe("Apache-2.0");
  });

  it("refuses to approve a repo that is already listed", async () => {
    db.prepare(
      "INSERT INTO projects (name, short_desc, repo_url, author) VALUES ('repo', 'exists', 'https://github.com/owner/repo', 'owner')"
    ).run();
    await addSuggestion();
    const r = await approveSuggestion(1, "AI Agents");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/already listed/i);
    const row = db.prepare("SELECT review_status FROM contact_messages WHERE id = 1").get() as {
      review_status: string;
    };
    expect(row.review_status).toBe("new");
  });

  it("rejects an unknown category", async () => {
    await addSuggestion();
    const r = await approveSuggestion(1, "Not A Category");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/category/i);
  });
});

describe("review queue admin api", () => {
  it("requires the admin cookie", async () => {
    const getRes = await reviewGet(req("https://www.freshcrate.ai/api/admin/review", undefined, false));
    expect(getRes.status).toBe(401);
    const postRes = await reviewPost(jsonReq("https://www.freshcrate.ai/api/admin/review", { id: 1, action: "reject" }, false));
    expect(postRes.status).toBe(401);
  });

  it("lists and reviews via the api", async () => {
    await addSuggestion();

    const list1 = await reviewGet(req("https://www.freshcrate.ai/api/admin/review"));
    expect(list1.status).toBe(200);
    const data1 = await list1.json();
    expect(data1.submissions).toHaveLength(1);
    expect(data1.submissions[0].url).toBe("https://github.com/owner/repo");

    const approveRes = await reviewPost(
      jsonReq("https://www.freshcrate.ai/api/admin/review", { id: 1, action: "approve", category: "AI Agents" })
    );
    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json();
    expect(approveData.ok).toBe(true);

    const list2 = await reviewGet(req("https://www.freshcrate.ai/api/admin/review"));
    const data2 = await list2.json();
    expect(data2.submissions).toHaveLength(0);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import Database from "better-sqlite3";
import { createTestDb, _resetDb } from "./setup";
import { POST } from "@/app/api/human-contact/route";

let db: Database.Database;

function req(body: unknown): NextRequest {
  return new NextRequest("https://www.freshcrate.ai/api/human-contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validPayload = {
  tab: "suggest",
  type: "missing-package",
  url: "https://github.com/owner/repo",
  message: "great project, please list it",
  page: "/submit",
};

beforeEach(() => {
  db = createTestDb();
  delete process.env.RESEND_API_KEY;
});

afterEach(() => {
  _resetDb();
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
});

describe("human-contact api (DB fallback)", () => {
  it("stores the submission and returns 202 even without RESEND_API_KEY", async () => {
    const res = await POST(req(validPayload));
    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.ok).toBe(true);

    const rows = db
      .prepare("SELECT * FROM contact_messages")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].tab).toBe("suggest");
    expect(rows[0].url).toBe("https://github.com/owner/repo");
    expect(rows[0].message).toBe("great project, please list it");
    expect(rows[0].page).toBe("/submit");
    expect(rows[0].email_status).toBe("not_configured");
  });

  it("rejects invalid payloads with 400 and stores nothing", async () => {
    const res = await POST(req({ tab: "suggest", url: "" }));
    expect(res.status).toBe(400);
    const count = (
      db.prepare("SELECT COUNT(*) c FROM contact_messages").get() as { c: number }
    ).c;
    expect(count).toBe(0);
  });

  it("sends email when RESEND_API_KEY is set and marks the row sent", async () => {
    process.env.RESEND_API_KEY = "test-key";
    const fetchMock = vi.fn(async (input: unknown) => {
      expect(String(input)).toBe("https://api.resend.com/emails");
      return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req({ ...validPayload, tab: "report", type: "broken-link" }));
    expect(res.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const row = db
      .prepare("SELECT email_status FROM contact_messages")
      .get() as { email_status: string };
    expect(row.email_status).toBe("sent");
  });

  it("still stores the submission when the email send fails", async () => {
    process.env.RESEND_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));

    const res = await POST(req(validPayload));
    expect(res.status).toBe(202);
    const row = db
      .prepare("SELECT email_status FROM contact_messages")
      .get() as { email_status: string };
    expect(row.email_status).toBe("error");
  });
});

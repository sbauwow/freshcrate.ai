import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { log } from "@/lib/logger";
import { logRequest } from "@/lib/request-log";
import { getDb } from "@/lib/db";

const bodySchema = z.object({
  tab: z.enum(["suggest", "report"]),
  type: z.string().trim().max(100).optional(),
  url: z.string().trim().min(1).max(500),
  message: z.string().trim().max(5000).optional(),
  page: z.string().trim().max(100).optional(),
});

function buildEmail(payload: z.infer<typeof bodySchema>) {
  const subject =
    payload.tab === "suggest"
      ? `[freshcrate] package suggestion: ${payload.url}`
      : `[freshcrate] issue report: ${payload.type || "other"}`;

  const lines =
    payload.tab === "suggest"
      ? [
          "Type: package suggestion",
          `Page: ${payload.page || "/submit"}`,
          `URL/Repo: ${payload.url}`,
          "",
          "Why list it:",
          payload.message || "(none)",
        ]
      : [
          "Type: issue report",
          `Page: ${payload.page || "/submit"}`,
          `Issue kind: ${payload.type || "other"}`,
          `Package/URL: ${payload.url}`,
          "",
          "Details:",
          payload.message || "(none)",
        ];

  return { subject, text: lines.join("\n") };
}

async function sendWithResend(to: string, subject: string, text: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false as const, reason: "missing_resend_key" };
  }

  const from = process.env.FRESHCRATE_CONTACT_FROM || "freshcrate <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { ok: false as const, reason: "resend_error", status: res.status, body };
  }

  return { ok: true as const };
}

export async function POST(request: NextRequest) {
  const start = Date.now();

  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      const res = NextResponse.json({ error: "Invalid submission payload." }, { status: 400 });
      logRequest(request, 400, start);
      return res;
    }

    // Store first: a submission must never be lost because email is down
    // or unconfigured. Email delivery is best-effort on top of storage.
    const payload = parsed.data;
    const db = getDb();
    const insert = db
      .prepare(
        `INSERT INTO contact_messages (tab, type, url, message, page, email_status)
         VALUES (?, ?, ?, ?, ?, 'pending')`
      )
      .run(
        payload.tab,
        payload.type || "",
        payload.url,
        payload.message || "",
        payload.page || ""
      );
    const messageId = insert.lastInsertRowid as number;

    const to = process.env.HUMAN_CONTACT_EMAIL || process.env.ADMIN_EMAIL || "contact@freshcrate.ai";
    const email = buildEmail(payload);

    const send = await sendWithResend(to, email.subject, email.text);
    const emailStatus = send.ok ? "sent" : send.reason === "missing_resend_key" ? "not_configured" : "error";

    db.prepare("UPDATE contact_messages SET email_status = ? WHERE id = ?").run(emailStatus, messageId);

    if (!send.ok) {
      log.error("human_contact_send_failed", { messageId, reason: send.reason, status: (send as { status?: number }).status });
    } else {
      log.info("human_contact_sent", { messageId, tab: payload.tab, type: payload.type, to });
    }

    const res = NextResponse.json({ ok: true, stored: true, emailed: send.ok }, { status: 202 });
    logRequest(request, 202, start);
    return res;
  } catch (err) {
    log.error("human_contact_error", { error: (err as Error).message });
    const res = NextResponse.json({ error: "Failed to process request." }, { status: 500 });
    logRequest(request, 500, start);
    return res;
  }
}

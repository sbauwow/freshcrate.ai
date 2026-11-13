-- Durable storage for /submit suggestions and issue reports.
-- The form posts to /api/human-contact, which was email-only: without
-- RESEND_API_KEY it returned 503 and every submission was lost.
-- Now every valid submission is stored; email delivery is best-effort
-- and its outcome is recorded in email_status.
CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tab TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  page TEXT NOT NULL DEFAULT '',
  email_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages(created_at);

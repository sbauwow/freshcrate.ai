-- Review queue for /submit submissions (contact_messages).
-- Submissions start as 'new'; the /admin/review page approves
-- (ingests the suggested repo into the catalog) or rejects them.
ALTER TABLE contact_messages ADD COLUMN review_status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE contact_messages ADD COLUMN reviewed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_contact_messages_review ON contact_messages(review_status);

-- Session id + event type/target on page_views.
-- Enables cross-day session funnels and custom event tracking
-- (clicks, installs, outbound, search) beyond raw pageviews.
ALTER TABLE page_views ADD COLUMN session_id TEXT NOT NULL DEFAULT '';
ALTER TABLE page_views ADD COLUMN event_type TEXT NOT NULL DEFAULT 'pageview';
ALTER TABLE page_views ADD COLUMN event_target TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_page_views_session ON page_views(session_id);
CREATE INDEX IF NOT EXISTS idx_page_views_event_type ON page_views(event_type);

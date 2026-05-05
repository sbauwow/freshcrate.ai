-- UTM attribution on page_views for source-level funnel analysis.
ALTER TABLE page_views ADD COLUMN utm_source TEXT NOT NULL DEFAULT '';
ALTER TABLE page_views ADD COLUMN utm_medium TEXT NOT NULL DEFAULT '';
ALTER TABLE page_views ADD COLUMN utm_campaign TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_page_views_utm_source ON page_views(utm_source);
CREATE INDEX IF NOT EXISTS idx_page_views_utm_campaign ON page_views(utm_campaign);

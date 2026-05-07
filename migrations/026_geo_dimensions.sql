-- Optional visitor geography dimensions from edge/CDN headers.
-- No raw IP geolocation lookup is performed server-side.
-- Values may be blank when the hosting proxy does not provide geo headers.
ALTER TABLE request_log ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE request_log ADD COLUMN region TEXT NOT NULL DEFAULT '';
ALTER TABLE request_log ADD COLUMN city TEXT NOT NULL DEFAULT '';

ALTER TABLE page_views ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE page_views ADD COLUMN region TEXT NOT NULL DEFAULT '';
ALTER TABLE page_views ADD COLUMN city TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_request_log_country ON request_log(country);
CREATE INDEX IF NOT EXISTS idx_page_views_country ON page_views(country);
CREATE INDEX IF NOT EXISTS idx_page_views_region ON page_views(region);

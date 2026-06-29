-- Migrations 016/017/018 were renumbered to 019/020/015 when 016_language_source
-- was inserted. Update tracking so the renamed files aren't re-applied on
-- existing databases that recorded the old names.
UPDATE _migrations SET name = '015_multi_source_identity.sql' WHERE name = '018_multi_source_identity.sql';
UPDATE _migrations SET name = '019_health_score.sql'          WHERE name = '016_health_score.sql';
UPDATE _migrations SET name = '020_mcp_manifest.sql'          WHERE name = '017_mcp_manifest.sql';

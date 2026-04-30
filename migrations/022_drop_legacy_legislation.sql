-- Drop the single-jurisdiction RSS-scraper tables left behind by main's
-- migration 011_legislation.sql after the multi-jurisdiction merge.
--
-- The runtime now reads from legislation_items (created in 021_legislation.sql).
-- legislation, governance_issues, and legislation_sources have no callers in
-- the codebase as of this migration. Any prod data in these tables is being
-- discarded intentionally — back up first if it matters.
DROP TABLE IF EXISTS legislation;
DROP TABLE IF EXISTS governance_issues;
DROP TABLE IF EXISTS legislation_sources;

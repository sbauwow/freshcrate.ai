-- Hugging Face models catalog

CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL UNIQUE,
  author TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  short_desc TEXT NOT NULL DEFAULT '',
  pipeline_tag TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL DEFAULT 'unknown',
  downloads INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  trending_score INTEGER NOT NULL DEFAULT 0,
  gated INTEGER NOT NULL DEFAULT 0,
  size_mb INTEGER,
  hf_url TEXT NOT NULL DEFAULT '',
  last_modified TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_models_downloads ON models(downloads DESC);
CREATE INDEX IF NOT EXISTS idx_models_trending ON models(trending_score DESC);
CREATE INDEX IF NOT EXISTS idx_models_license ON models(license);
CREATE INDEX IF NOT EXISTS idx_models_pipeline_tag ON models(pipeline_tag);

-- FTS5 full-text search on models

CREATE VIRTUAL TABLE IF NOT EXISTS models_fts USING fts5(
  repo_id,
  model_name,
  short_desc,
  author,
  content=models,
  content_rowid=id
);

-- Keep FTS index in sync with models table

CREATE TRIGGER IF NOT EXISTS models_fts_insert AFTER INSERT ON models BEGIN
  INSERT INTO models_fts(rowid, repo_id, model_name, short_desc, author)
  VALUES (new.id, new.repo_id, new.model_name, new.short_desc, new.author);
END;

CREATE TRIGGER IF NOT EXISTS models_fts_update AFTER UPDATE ON models BEGIN
  INSERT INTO models_fts(models_fts, rowid, repo_id, model_name, short_desc, author)
  VALUES ('delete', old.id, old.repo_id, old.model_name, old.short_desc, old.author);
  INSERT INTO models_fts(rowid, repo_id, model_name, short_desc, author)
  VALUES (new.id, new.repo_id, new.model_name, new.short_desc, new.author);
END;

CREATE TRIGGER IF NOT EXISTS models_fts_delete AFTER DELETE ON models BEGIN
  INSERT INTO models_fts(models_fts, rowid, repo_id, model_name, short_desc, author)
  VALUES ('delete', old.id, old.repo_id, old.model_name, old.short_desc, old.author);
END;

-- Populate FTS from existing data
INSERT INTO models_fts(models_fts) VALUES('rebuild');

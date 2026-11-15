-- Torrent manifests for HF models (one v1-bitINFOHash torrent per model)

CREATE TABLE IF NOT EXISTS model_torrents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL UNIQUE REFERENCES models(id) ON DELETE CASCADE,
  info_hash TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  total_bytes INTEGER DEFAULT 0,
  file_count INTEGER DEFAULT 0,
  metainfo BLOB NOT NULL,
  magnet TEXT DEFAULT '',
  build_tool_version TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

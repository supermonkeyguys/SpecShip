CREATE TABLE IF NOT EXISTS graph_snapshots (
  session_id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL,
  title TEXT NOT NULL,
  original_spec TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

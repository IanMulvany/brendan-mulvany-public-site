-- Durable owner-submitted changes to the published archive. The archive DB is
-- replaced at publication time; this table must live in COMMUNITY.
CREATE TABLE editorial_corrections (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('photo', 'collection')),
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  base_value TEXT NOT NULL,
  value TEXT NOT NULL,
  source_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'cancelled', 'applied_local', 'published', 'conflict')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  local_receipt TEXT,
  published_release TEXT
);
CREATE UNIQUE INDEX editorial_corrections_open_field
  ON editorial_corrections(kind, entity_id, field)
  WHERE status IN ('pending', 'applied_local', 'conflict');
CREATE INDEX editorial_corrections_status_created
  ON editorial_corrections(status, created_at, id);

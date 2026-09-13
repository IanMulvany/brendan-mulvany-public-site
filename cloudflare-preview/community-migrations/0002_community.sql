-- Visitor contributions are separate from the replaceable public archive DB.
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  photo_id INTEGER NOT NULL CHECK(photo_id > 0),
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL,
  hidden_at INTEGER,
  hidden_by TEXT REFERENCES users(id),
  CHECK((hidden_at IS NULL) = (hidden_by IS NULL))
);
CREATE INDEX idx_comments_photo_visible ON comments(photo_id, created_at DESC, id DESC) WHERE hidden_at IS NULL;

CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  photo_id INTEGER NOT NULL CHECK(photo_id > 0),
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 500),
  x REAL NOT NULL CHECK(x >= 0 AND x <= 1),
  y REAL NOT NULL CHECK(y >= 0 AND y <= 1),
  width REAL NOT NULL CHECK(width >= 0.01 AND width <= 1),
  height REAL NOT NULL CHECK(height >= 0.01 AND height <= 1),
  created_at INTEGER NOT NULL,
  hidden_at INTEGER,
  hidden_by TEXT REFERENCES users(id),
  CHECK(x + width <= 1 AND y + height <= 1),
  CHECK((hidden_at IS NULL) = (hidden_by IS NULL))
);
CREATE INDEX idx_annotations_photo_visible ON annotations(photo_id, created_at DESC, id DESC) WHERE hidden_at IS NULL;

CREATE TABLE likes (
  id TEXT NOT NULL UNIQUE,
  photo_id INTEGER NOT NULL CHECK(photo_id > 0),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(photo_id, user_id)
);

CREATE TABLE collection_heroes (
  collection_id TEXT PRIMARY KEY,
  photo_id INTEGER NOT NULL CHECK(photo_id > 0),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL
);

-- Deliberately excludes emails, comment bodies, annotation text and credentials.
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN (
    'comment.created', 'comment.hidden', 'annotation.created', 'annotation.hidden',
    'like.added', 'like.removed', 'collection.hero_changed', 'user.status_changed'
  )),
  photo_id INTEGER,
  target_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_activity_created ON activity(created_at DESC, id DESC);

-- New and existing members require explicit approval before adding names.
-- This preserves every account, session, contribution and search document.
-- The configured administrator is authorized by verified email at request time.
ALTER TABLE users ADD COLUMN annotation_status TEXT NOT NULL DEFAULT 'pending'
  CHECK(annotation_status IN ('pending', 'approved', 'revoked'));
CREATE INDEX idx_users_annotation_status ON users(annotation_status, created_at DESC, id DESC);

ALTER TABLE comments ADD COLUMN reviewed_at INTEGER;
ALTER TABLE comments ADD COLUMN reviewed_by TEXT REFERENCES users(id);
ALTER TABLE annotations ADD COLUMN reviewed_at INTEGER;
ALTER TABLE annotations ADD COLUMN reviewed_by TEXT REFERENCES users(id);
CREATE INDEX idx_comments_review ON comments(reviewed_at, created_at DESC, id DESC);
CREATE INDEX idx_annotations_review ON annotations(reviewed_at, created_at DESC, id DESC);

-- Keep the original activity table and its constraints intact. This audit
-- contains identifiers and decisions, never email addresses or submitted text.
CREATE TABLE moderation_activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN (
    'user.annotations_approved', 'user.annotations_revoked',
    'comment.reviewed', 'comment.hidden', 'comment.restored',
    'annotation.reviewed', 'annotation.hidden', 'annotation.restored'
  )),
  photo_id INTEGER,
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_moderation_activity_created ON moderation_activity(created_at DESC, id DESC);

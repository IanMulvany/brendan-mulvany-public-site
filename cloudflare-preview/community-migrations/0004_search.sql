-- Public metadata only. Accounts and visitor contributions remain in their own
-- existing tables; each photograph has exactly one searchable document.
CREATE TABLE search_photos (
  id INTEGER PRIMARY KEY CHECK(id > 0),
  collection_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  date TEXT NOT NULL,
  year TEXT NOT NULL,
  location TEXT NOT NULL,
  tags TEXT NOT NULL,
  image_base TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  annotation_text TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_search_photos_collection_id ON search_photos(collection_id, id);
CREATE INDEX idx_annotations_user_photo ON annotations(user_id, photo_id);

CREATE VIRTUAL TABLE search_photos_fts USING fts5(
  title, description, location, tags, date, collection_id, annotation_text,
  content='search_photos', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2', prefix='2 3 4'
);
CREATE TRIGGER search_photos_insert AFTER INSERT ON search_photos BEGIN
  INSERT INTO search_photos_fts(rowid,title,description,location,tags,date,collection_id,annotation_text)
    VALUES(NEW.id,NEW.title,NEW.description,NEW.location,NEW.tags,NEW.date,NEW.collection_id,NEW.annotation_text);
END;
CREATE TRIGGER search_photos_delete AFTER DELETE ON search_photos BEGIN
  INSERT INTO search_photos_fts(search_photos_fts,rowid,title,description,location,tags,date,collection_id,annotation_text)
    VALUES('delete',OLD.id,OLD.title,OLD.description,OLD.location,OLD.tags,OLD.date,OLD.collection_id,OLD.annotation_text);
END;
CREATE TRIGGER search_photos_update AFTER UPDATE ON search_photos BEGIN
  INSERT INTO search_photos_fts(search_photos_fts,rowid,title,description,location,tags,date,collection_id,annotation_text)
    VALUES('delete',OLD.id,OLD.title,OLD.description,OLD.location,OLD.tags,OLD.date,OLD.collection_id,OLD.annotation_text);
  INSERT INTO search_photos_fts(rowid,title,description,location,tags,date,collection_id,annotation_text)
    VALUES(NEW.id,NEW.title,NEW.description,NEW.location,NEW.tags,NEW.date,NEW.collection_id,NEW.annotation_text);
END;

-- Keep the same visibility rules as /api/photos/:id/community: a verified
-- author's visible contribution remains public when their account is suspended.
CREATE TRIGGER annotations_search_insert AFTER INSERT ON annotations BEGIN
  UPDATE search_photos SET annotation_text = COALESCE((
    SELECT group_concat(a.name || ' ' || a.note, ' ')
    FROM annotations a JOIN users u ON u.id = a.user_id
    WHERE a.photo_id = search_photos.id AND a.hidden_at IS NULL AND u.verified_at IS NOT NULL
  ), '') WHERE id = NEW.photo_id;
END;
CREATE TRIGGER annotations_search_update
AFTER UPDATE OF name,note,photo_id,hidden_at,user_id ON annotations BEGIN
  UPDATE search_photos SET annotation_text = COALESCE((
    SELECT group_concat(a.name || ' ' || a.note, ' ')
    FROM annotations a JOIN users u ON u.id = a.user_id
    WHERE a.photo_id = search_photos.id AND a.hidden_at IS NULL AND u.verified_at IS NOT NULL
  ), '') WHERE id IN (OLD.photo_id, NEW.photo_id);
END;
CREATE TRIGGER annotations_search_delete AFTER DELETE ON annotations BEGIN
  UPDATE search_photos SET annotation_text = COALESCE((
    SELECT group_concat(a.name || ' ' || a.note, ' ')
    FROM annotations a JOIN users u ON u.id = a.user_id
    WHERE a.photo_id = search_photos.id AND a.hidden_at IS NULL AND u.verified_at IS NOT NULL
  ), '') WHERE id = OLD.photo_id;
END;
CREATE TRIGGER users_search_verification AFTER UPDATE OF verified_at ON users
WHEN OLD.verified_at IS NOT NEW.verified_at BEGIN
  UPDATE search_photos SET annotation_text = COALESCE((
    SELECT group_concat(a.name || ' ' || a.note, ' ')
    FROM annotations a JOIN users u ON u.id = a.user_id
    WHERE a.photo_id = search_photos.id AND a.hidden_at IS NULL AND u.verified_at IS NOT NULL
  ), '') WHERE id IN (SELECT photo_id FROM annotations WHERE user_id = NEW.id);
END;

-- Interrupted imports leave only inert, public staging data. A content hash
-- namespaces each staged snapshot so concurrent different imports cannot mix.
CREATE TABLE search_catalog_stage (
  import_id TEXT NOT NULL CHECK(length(import_id) = 64),
  id INTEGER NOT NULL CHECK(id > 0),
  collection_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  date TEXT NOT NULL,
  year TEXT NOT NULL,
  location TEXT NOT NULL,
  tags TEXT NOT NULL,
  image_base TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  PRIMARY KEY(import_id, id)
);
CREATE TABLE search_catalog_imports (
  id TEXT PRIMARY KEY CHECK(length(id) = 64),
  expected_count INTEGER NOT NULL CHECK(expected_count BETWEEN 1 AND 2400)
);
-- This final INSERT and all its trigger work are one SQLite transaction even
-- when an importer executes each preceding staging statement separately.
CREATE TRIGGER search_catalog_publish AFTER INSERT ON search_catalog_imports BEGIN
  -- Avoid an unparenthesized CASE/END in D1's remote trigger splitter.
  SELECT RAISE(ABORT, 'Search catalog staging is incomplete')
    WHERE (SELECT COUNT(*) FROM search_catalog_stage WHERE import_id = NEW.id) != NEW.expected_count;
  INSERT INTO search_photos(id,collection_id,title,description,date,year,location,tags,image_base,width,height,annotation_text)
    SELECT s.id,s.collection_id,s.title,s.description,s.date,s.year,s.location,s.tags,s.image_base,s.width,s.height,
      COALESCE((SELECT group_concat(a.name || ' ' || a.note, ' ')
        FROM annotations a JOIN users u ON u.id = a.user_id
        WHERE a.photo_id = s.id AND a.hidden_at IS NULL AND u.verified_at IS NOT NULL), '')
    FROM search_catalog_stage s WHERE s.import_id = NEW.id
    ON CONFLICT(id) DO UPDATE SET collection_id=excluded.collection_id,title=excluded.title,
      description=excluded.description,date=excluded.date,year=excluded.year,location=excluded.location,
      tags=excluded.tags,image_base=excluded.image_base,width=excluded.width,height=excluded.height,
      annotation_text=excluded.annotation_text;
  DELETE FROM search_photos WHERE id NOT IN (SELECT id FROM search_catalog_stage WHERE import_id = NEW.id);
  DELETE FROM search_catalog_stage WHERE import_id = NEW.id;
  DELETE FROM search_catalog_imports WHERE id = NEW.id;
END;

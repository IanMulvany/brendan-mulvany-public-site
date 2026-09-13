CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY,
    collection_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    date TEXT NOT NULL,
    year TEXT NOT NULL,
    location TEXT NOT NULL,
    tags TEXT NOT NULL,
    image_base TEXT NOT NULL,
    width INTEGER,
    height INTEGER
);

CREATE INDEX IF NOT EXISTS idx_photos_collection_id ON photos(collection_id, id);

CREATE VIRTUAL TABLE IF NOT EXISTS photos_fts USING fts5(
    title,
    description,
    location,
    tags,
    date,
    collection_id,
    content='photos',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2',
    prefix='2 3 4'
);

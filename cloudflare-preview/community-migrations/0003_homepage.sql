-- Editorial homepage choices survive replacement of the public archive DB.
CREATE TABLE homepage_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  collection_ids TEXT NOT NULL CHECK(
    json_valid(collection_ids)
    AND json_type(collection_ids) = 'array'
    AND json_array_length(collection_ids) BETWEEN 1 AND 6
  ),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0)
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1
);

-- Annotations table
CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    annotation_type TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Person names table
CREATE TABLE IF NOT EXISTS person_names (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    image_id INTEGER NOT NULL,
    annotation_id INTEGER,
    confidence TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (annotation_id) REFERENCES annotations(id)
);

-- Sync log table
CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type TEXT NOT NULL,
    images_synced INTEGER,
    metadata_updated INTEGER,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    status TEXT,
    error_message TEXT
);

-- Scenes table: Stable identifiers for unique moments
CREATE TABLE IF NOT EXISTS scenes (
    scene_id TEXT PRIMARY KEY,
    batch_name TEXT NOT NULL,
    base_filename TEXT NOT NULL,
    capture_date TEXT,
    description TEXT,
    description_model TEXT,
    description_timestamp TEXT,
    roll_number TEXT,
    roll_date TEXT,
    date_source TEXT,
    date_notes TEXT,
    roll_comment TEXT,
    index_book_number TEXT,
    index_book_date TEXT,
    index_book_comment TEXT,
    short_description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(batch_name, base_filename)
);

-- Normalized supplemental tables for search
CREATE TABLE IF NOT EXISTS scene_descriptions (
    scene_id TEXT PRIMARY KEY,
    description TEXT,
    description_model TEXT,
    description_timestamp TEXT,
    short_description TEXT,
    FOREIGN KEY (scene_id) REFERENCES scenes(scene_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scene_metadata (
    scene_id TEXT PRIMARY KEY,
    roll_number TEXT,
    roll_date TEXT,
    date_source TEXT,
    date_notes TEXT,
    roll_comment TEXT,
    index_book_number TEXT,
    index_book_date TEXT,
    index_book_comment TEXT,
    FOREIGN KEY (scene_id) REFERENCES scenes(scene_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scene_tags (
    scene_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (scene_id, tag),
    FOREIGN KEY (scene_id) REFERENCES scenes(scene_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scene_people (
    scene_id TEXT NOT NULL,
    person TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (scene_id, person),
    FOREIGN KEY (scene_id) REFERENCES scenes(scene_id) ON DELETE CASCADE
);

-- Image versions: All versions of a scene (keep all rows for history)
CREATE TABLE IF NOT EXISTS image_versions (
    version_id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL,
    version_type TEXT NOT NULL,
    local_path TEXT NOT NULL,
    r2_key TEXT,
    perceptual_hash TEXT,
    md5_hash TEXT,
    file_size INTEGER,
    width INTEGER,
    height INTEGER,
    is_current BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    synced_at TIMESTAMP,
    FOREIGN KEY (scene_id) REFERENCES scenes(scene_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_annotations_image_id ON annotations(image_id);
CREATE INDEX IF NOT EXISTS idx_annotations_user_id ON annotations(user_id);
CREATE INDEX IF NOT EXISTS idx_person_names_image_id ON person_names(image_id);
CREATE INDEX IF NOT EXISTS idx_person_names_name ON person_names(name);

-- Scene and version indexes
CREATE INDEX IF NOT EXISTS idx_scenes_batch ON scenes(batch_name);
CREATE INDEX IF NOT EXISTS idx_scenes_roll_number ON scenes(roll_number);
CREATE INDEX IF NOT EXISTS idx_scenes_roll_date ON scenes(roll_date);
CREATE INDEX IF NOT EXISTS idx_versions_scene ON image_versions(scene_id);
CREATE INDEX IF NOT EXISTS idx_versions_current ON image_versions(scene_id, is_current) WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS idx_versions_hash_live ON image_versions(perceptual_hash) WHERE r2_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_versions_r2_key ON image_versions(r2_key) WHERE r2_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scene_metadata_roll_number ON scene_metadata(roll_number);
CREATE INDEX IF NOT EXISTS idx_scene_metadata_roll_date ON scene_metadata(roll_date);
CREATE INDEX IF NOT EXISTS idx_scene_metadata_date_source ON scene_metadata(date_source);
CREATE INDEX IF NOT EXISTS idx_scene_metadata_batch_roll ON scene_metadata(roll_number, roll_date);
CREATE INDEX IF NOT EXISTS idx_scene_tags_tag ON scene_tags(tag);
CREATE INDEX IF NOT EXISTS idx_scene_people_person ON scene_people(person);

-- View aggregating search content for FTS maintenance
CREATE VIEW IF NOT EXISTS scene_search_index AS
SELECT
    s.rowid AS rowid,
    s.scene_id AS scene_id,
    s.base_filename AS base_filename,
    COALESCE(sd.description, '') AS description,
    COALESCE(sd.short_description, '') AS short_description,
    COALESCE(sm.roll_comment, '') AS roll_comment,
    COALESCE(sm.date_notes, '') AS date_notes,
    COALESCE(sm.index_book_comment, '') AS index_book_comment,
    COALESCE((
        SELECT GROUP_CONCAT(tag, ' ')
        FROM scene_tags st
        WHERE st.scene_id = s.scene_id
    ), '') AS tags,
    COALESCE((
        SELECT GROUP_CONCAT(person, ' ')
        FROM scene_people sp
        WHERE sp.scene_id = s.scene_id
    ), '') AS people
FROM scenes s
LEFT JOIN scene_descriptions sd ON sd.scene_id = s.scene_id
LEFT JOIN scene_metadata sm ON sm.scene_id = s.scene_id;

-- New FTS for scenes using normalized data
CREATE VIRTUAL TABLE IF NOT EXISTS scene_search_fts USING fts5(
    scene_id UNINDEXED,
    base_filename,
    description,
    roll_comment,
    date_notes,
    index_book_comment,
    short_description,
    tags,
    people,
    tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS scene_search_fts_insert AFTER INSERT ON scenes BEGIN
    INSERT INTO scene_search_fts(
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    )
    SELECT
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    FROM scene_search_index
    WHERE rowid = new.rowid;
END;

CREATE TRIGGER IF NOT EXISTS scene_search_fts_delete AFTER DELETE ON scenes BEGIN
    DELETE FROM scene_search_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS scene_search_fts_update AFTER UPDATE ON scenes BEGIN
    DELETE FROM scene_search_fts WHERE rowid = old.rowid;
    INSERT INTO scene_search_fts(
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    )
    SELECT
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    FROM scene_search_index
    WHERE rowid = new.rowid;
END;

CREATE TRIGGER IF NOT EXISTS scene_search_fts_desc_insert AFTER INSERT ON scene_descriptions BEGIN
    DELETE FROM scene_search_fts
    WHERE rowid = (SELECT rowid FROM scenes WHERE scene_id = new.scene_id);
    INSERT INTO scene_search_fts(
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    )
    SELECT
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    FROM scene_search_index
    WHERE scene_id = new.scene_id;
END;

CREATE TRIGGER IF NOT EXISTS scene_search_fts_desc_update AFTER UPDATE ON scene_descriptions BEGIN
    DELETE FROM scene_search_fts
    WHERE rowid = (SELECT rowid FROM scenes WHERE scene_id = new.scene_id);
    INSERT INTO scene_search_fts(
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    )
    SELECT
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    FROM scene_search_index
    WHERE scene_id = new.scene_id;
END;

CREATE TRIGGER IF NOT EXISTS scene_search_fts_desc_delete AFTER DELETE ON scene_descriptions BEGIN
    DELETE FROM scene_search_fts
    WHERE rowid = (SELECT rowid FROM scenes WHERE scene_id = old.scene_id);
    INSERT INTO scene_search_fts(
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    )
    SELECT
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    FROM scene_search_index
    WHERE scene_id = old.scene_id;
END;

CREATE TRIGGER IF NOT EXISTS scene_search_fts_meta_insert AFTER INSERT ON scene_metadata BEGIN
    DELETE FROM scene_search_fts
    WHERE rowid = (SELECT rowid FROM scenes WHERE scene_id = new.scene_id);
    INSERT INTO scene_search_fts(
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    )
    SELECT
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    FROM scene_search_index
    WHERE scene_id = new.scene_id;
END;

CREATE TRIGGER IF NOT EXISTS scene_search_fts_meta_update AFTER UPDATE ON scene_metadata BEGIN
    DELETE FROM scene_search_fts
    WHERE rowid = (SELECT rowid FROM scenes WHERE scene_id = new.scene_id);
    INSERT INTO scene_search_fts(
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    )
    SELECT
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    FROM scene_search_index
    WHERE scene_id = new.scene_id;
END;

CREATE TRIGGER IF NOT EXISTS scene_search_fts_meta_delete AFTER DELETE ON scene_metadata BEGIN
    DELETE FROM scene_search_fts
    WHERE rowid = (SELECT rowid FROM scenes WHERE scene_id = old.scene_id);
    INSERT INTO scene_search_fts(
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    )
    SELECT
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    FROM scene_search_index
    WHERE scene_id = old.scene_id;
END;

CREATE TRIGGER IF NOT EXISTS scene_search_fts_tags_insert AFTER INSERT ON scene_tags BEGIN
    DELETE FROM scene_search_fts
    WHERE rowid = (SELECT rowid FROM scenes WHERE scene_id = new.scene_id);
    INSERT INTO scene_search_fts(
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    )
    SELECT
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    FROM scene_search_index
    WHERE scene_id = new.scene_id;
END;

CREATE TRIGGER IF NOT EXISTS scene_search_fts_tags_delete AFTER DELETE ON scene_tags BEGIN
    DELETE FROM scene_search_fts
    WHERE rowid = (SELECT rowid FROM scenes WHERE scene_id = old.scene_id);
    INSERT INTO scene_search_fts(
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    )
    SELECT
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    FROM scene_search_index
    WHERE scene_id = old.scene_id;
END;

CREATE TRIGGER IF NOT EXISTS scene_search_fts_people_insert AFTER INSERT ON scene_people BEGIN
    DELETE FROM scene_search_fts
    WHERE rowid = (SELECT rowid FROM scenes WHERE scene_id = new.scene_id);
    INSERT INTO scene_search_fts(
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    )
    SELECT
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    FROM scene_search_index
    WHERE scene_id = new.scene_id;
END;

CREATE TRIGGER IF NOT EXISTS scene_search_fts_people_delete AFTER DELETE ON scene_people BEGIN
    DELETE FROM scene_search_fts
    WHERE rowid = (SELECT rowid FROM scenes WHERE scene_id = old.scene_id);
    INSERT INTO scene_search_fts(
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    )
    SELECT
        rowid, scene_id, base_filename, description,
        roll_comment, date_notes, index_book_comment,
        short_description, tags, people
    FROM scene_search_index
    WHERE scene_id = old.scene_id;
END;


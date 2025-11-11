#!/usr/bin/env python3
"""
Create a demo database with the same structure as the production database
This is safe to commit to version control and serves as a reference for the schema
"""

import sqlite3
from pathlib import Path
import sys

def create_demo_database(db_path: Path):
    """Create demo database with schema only (no real data)"""

    # Remove existing demo db if present
    if db_path.exists():
        print(f"Removing existing demo database: {db_path}")
        db_path.unlink()

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    print(f"Creating demo database at: {db_path}")

    # Users table
    cursor.execute("""
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT 1
        )
    """)

    # Annotations table
    cursor.execute("""
        CREATE TABLE annotations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            annotation_type TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    # Person names table
    cursor.execute("""
        CREATE TABLE person_names (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            image_id INTEGER NOT NULL,
            annotation_id INTEGER,
            confidence TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (annotation_id) REFERENCES annotations(id)
        )
    """)

    # Sync log table
    cursor.execute("""
        CREATE TABLE sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_type TEXT NOT NULL,
            images_synced INTEGER,
            metadata_updated INTEGER,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            status TEXT,
            error_message TEXT
        )
    """)

    # Scenes table
    cursor.execute("""
        CREATE TABLE scenes (
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
        )
    """)

    # Image versions table
    cursor.execute("""
        CREATE TABLE image_versions (
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
        )
    """)

    # Indexes
    cursor.execute("CREATE INDEX idx_annotations_image_id ON annotations(image_id)")
    cursor.execute("CREATE INDEX idx_annotations_user_id ON annotations(user_id)")
    cursor.execute("CREATE INDEX idx_person_names_image_id ON person_names(image_id)")
    cursor.execute("CREATE INDEX idx_person_names_name ON person_names(name)")
    cursor.execute("CREATE INDEX idx_scenes_batch ON scenes(batch_name)")
    cursor.execute("CREATE INDEX idx_versions_scene ON image_versions(scene_id)")
    cursor.execute("CREATE INDEX idx_versions_current ON image_versions(scene_id, is_current) WHERE is_current = 1")
    cursor.execute("CREATE INDEX idx_versions_hash_live ON image_versions(perceptual_hash) WHERE r2_key IS NOT NULL")
    cursor.execute("CREATE INDEX idx_versions_r2_key ON image_versions(r2_key) WHERE r2_key IS NOT NULL")
    cursor.execute("CREATE INDEX idx_scenes_roll_number ON scenes(roll_number)")
    cursor.execute("CREATE INDEX idx_scenes_roll_date ON scenes(roll_date)")

    # Full-text search virtual table
    cursor.execute("""
        CREATE VIRTUAL TABLE scenes_fts USING fts5(
            scene_id UNINDEXED,
            base_filename,
            description,
            roll_comment,
            date_notes,
            index_book_comment,
            short_description,
            content='scenes',
            content_rowid='rowid'
        )
    """)

    # FTS triggers
    cursor.execute("""
        CREATE TRIGGER scenes_fts_insert AFTER INSERT ON scenes BEGIN
            INSERT INTO scenes_fts(
                rowid, scene_id, base_filename, description,
                roll_comment, date_notes, index_book_comment, short_description
            ) VALUES (
                new.rowid, new.scene_id, new.base_filename, new.description,
                new.roll_comment, new.date_notes, new.index_book_comment, new.short_description
            );
        END
    """)

    cursor.execute("""
        CREATE TRIGGER scenes_fts_delete AFTER DELETE ON scenes BEGIN
            DELETE FROM scenes_fts WHERE rowid = old.rowid;
        END
    """)

    cursor.execute("""
        CREATE TRIGGER scenes_fts_update AFTER UPDATE ON scenes BEGIN
            DELETE FROM scenes_fts WHERE rowid = old.rowid;
            INSERT INTO scenes_fts(
                rowid, scene_id, base_filename, description,
                roll_comment, date_notes, index_book_comment, short_description
            ) VALUES (
                new.rowid, new.scene_id, new.base_filename, new.description,
                new.roll_comment, new.date_notes, new.index_book_comment, new.short_description
            );
        END
    """)

    # Add demo data (optional - just one demo user)
    cursor.execute("""
        INSERT INTO users (username, email, password_hash, role)
        VALUES ('demo_user', 'demo@example.com', 'demo-hash-not-real', 'user')
    """)

    conn.commit()
    conn.close()

    print(f"✓ Demo database created successfully at: {db_path}")
    print("  - All tables and indexes created")
    print("  - Full-text search configured")
    print("  - One demo user added (non-functional credentials)")
    print("\nThis database is safe to commit to version control.")

if __name__ == "__main__":
    db_path = Path(__file__).parent / "demo.db"
    create_demo_database(db_path)

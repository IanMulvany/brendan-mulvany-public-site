"""
Database setup and utilities for public site
Handles users, annotations, and sync logging
"""

import sqlite3
from pathlib import Path
from typing import List, Dict, Optional
from contextlib import contextmanager
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class PublicSiteDatabase:
    """Database connection and query manager for public site"""
    
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._init_schema()
    
    def _init_schema(self):
        """Initialize database schema if it doesn't exist"""
        with self.get_connection() as conn:
            # Users table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
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
            conn.execute("""
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
                )
            """)
            
            # Person names table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS person_names (
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
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sync_log (
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
            
            # Scenes table: Stable identifiers for unique moments
            conn.execute("""
                CREATE TABLE IF NOT EXISTS scenes (
                    scene_id TEXT PRIMARY KEY,
                    batch_name TEXT NOT NULL,
                    base_filename TEXT NOT NULL,
                    capture_date TEXT,
                    description TEXT,
                    description_model TEXT,
                    description_timestamp TEXT,
                    -- Batch metadata from scan_metadata.yaml
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
            
            # Add description columns if they don't exist (for existing databases)
            for col in ['description', 'description_model', 'description_timestamp']:
                try:
                    conn.execute(f"ALTER TABLE scenes ADD COLUMN {col} TEXT")
                except sqlite3.OperationalError:
                    pass  # Column already exists
            
            # Add batch metadata columns if they don't exist (for existing databases)
            for col in ['roll_number', 'roll_date', 'date_source', 'date_notes', 'roll_comment',
                       'index_book_number', 'index_book_date', 'index_book_comment', 'short_description']:
                try:
                    conn.execute(f"ALTER TABLE scenes ADD COLUMN {col} TEXT")
                except sqlite3.OperationalError:
                    pass  # Column already exists
            
            # Image versions: All versions of a scene (keep all rows for history)
            conn.execute("""
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
                )
            """)
            
            # Create indexes
            conn.execute("CREATE INDEX IF NOT EXISTS idx_annotations_image_id ON annotations(image_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_annotations_user_id ON annotations(user_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_person_names_image_id ON person_names(image_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_person_names_name ON person_names(name)")
            
            # Scene and version indexes
            conn.execute("CREATE INDEX IF NOT EXISTS idx_scenes_batch ON scenes(batch_name)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_scenes_roll_number ON scenes(roll_number)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_scenes_roll_date ON scenes(roll_date)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_versions_scene ON image_versions(scene_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_versions_current ON image_versions(scene_id, is_current) WHERE is_current = 1")
            # Index for similarity search: only versions in R2 (r2_key IS NOT NULL)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_versions_hash_live ON image_versions(perceptual_hash) WHERE r2_key IS NOT NULL")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_versions_r2_key ON image_versions(r2_key) WHERE r2_key IS NOT NULL")
            
            # FTS5 virtual table for full-text search
            # This will be populated with scene data for searching descriptions and text fields
            conn.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS scenes_fts USING fts5(
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
            
            # Trigger to keep FTS5 table in sync with scenes table
            conn.execute("""
                CREATE TRIGGER IF NOT EXISTS scenes_fts_insert AFTER INSERT ON scenes BEGIN
                    INSERT INTO scenes_fts(
                        rowid, scene_id, base_filename, description, 
                        roll_comment, date_notes, index_book_comment, short_description
                    ) VALUES (
                        new.rowid, new.scene_id, new.base_filename, new.description,
                        new.roll_comment, new.date_notes, new.index_book_comment, new.short_description
                    );
                END
            """)
            
            conn.execute("""
                CREATE TRIGGER IF NOT EXISTS scenes_fts_delete AFTER DELETE ON scenes BEGIN
                    DELETE FROM scenes_fts WHERE rowid = old.rowid;
                END
            """)
            
            conn.execute("""
                CREATE TRIGGER IF NOT EXISTS scenes_fts_update AFTER UPDATE ON scenes BEGIN
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
            
            # Populate FTS5 table with existing data
            conn.execute("""
                INSERT OR IGNORE INTO scenes_fts(
                    rowid, scene_id, base_filename, description,
                    roll_comment, date_notes, index_book_comment, short_description
                )
                SELECT rowid, scene_id, base_filename, description,
                       roll_comment, date_notes, index_book_comment, short_description
                FROM scenes
            """)
            
            conn.commit()
    
    @contextmanager
    def get_connection(self):
        """Context manager for database connections"""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()
    
    def create_user(self, username: str, email: str, password_hash: str, role: str = 'user') -> int:
        """Create a new user"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                """INSERT INTO users (username, email, password_hash, role)
                   VALUES (?, ?, ?, ?)""",
                (username, email, password_hash, role)
            )
            conn.commit()
            return cursor.lastrowid
    
    def get_user_by_username(self, username: str) -> Optional[Dict]:
        """Get user by username"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM users WHERE username = ? AND is_active = 1",
                (username,)
            )
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def get_user_by_id(self, user_id: int) -> Optional[Dict]:
        """Get user by ID"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM users WHERE id = ? AND is_active = 1",
                (user_id,)
            )
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def create_annotation(
        self,
        image_id: int,
        user_id: int,
        annotation_type: str,
        content: str,
        metadata: Optional[Dict] = None
    ) -> int:
        """Create a new annotation"""
        import json
        metadata_json = json.dumps(metadata) if metadata else None
        
        with self.get_connection() as conn:
            cursor = conn.execute(
                """INSERT INTO annotations (image_id, user_id, annotation_type, content, metadata)
                   VALUES (?, ?, ?, ?, ?)""",
                (image_id, user_id, annotation_type, content, metadata_json)
            )
            conn.commit()
            return cursor.lastrowid
    
    def get_annotations_for_image(self, image_id: int) -> List[Dict]:
        """Get all annotations for an image"""
        import json
        with self.get_connection() as conn:
            cursor = conn.execute(
                """SELECT a.*, u.username, u.email
                   FROM annotations a
                   JOIN users u ON a.user_id = u.id
                   WHERE a.image_id = ?
                   ORDER BY a.created_at DESC""",
                (image_id,)
            )
            rows = cursor.fetchall()
            result = []
            for row in rows:
                ann = dict(row)
                if ann.get('metadata'):
                    try:
                        ann['metadata'] = json.loads(ann['metadata'])
                    except (json.JSONDecodeError, TypeError):
                        ann['metadata'] = None
                result.append(ann)
            return result
    
    def update_annotation(self, annotation_id: int, content: str, user_id: int) -> bool:
        """Update an annotation (only by owner)"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                """UPDATE annotations 
                   SET content = ?, updated_at = CURRENT_TIMESTAMP
                   WHERE id = ? AND user_id = ?""",
                (content, annotation_id, user_id)
            )
            conn.commit()
            return cursor.rowcount > 0
    
    def delete_annotation(self, annotation_id: int, user_id: int) -> bool:
        """Delete an annotation (only by owner or admin)"""
        with self.get_connection() as conn:
            # Check if user is admin or owner
            user = self.get_user_by_id(user_id)
            if not user:
                return False
            
            if user['role'] == 'admin':
                cursor = conn.execute("DELETE FROM annotations WHERE id = ?", (annotation_id,))
            else:
                cursor = conn.execute(
                    "DELETE FROM annotations WHERE id = ? AND user_id = ?",
                    (annotation_id, user_id)
                )
            conn.commit()
            return cursor.rowcount > 0
    
    def log_sync(
        self,
        sync_type: str,
        images_synced: int = 0,
        metadata_updated: int = 0,
        status: str = 'in_progress',
        error_message: Optional[str] = None
    ) -> int:
        """Log a sync operation"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                """INSERT INTO sync_log (sync_type, images_synced, metadata_updated, started_at, status, error_message)
                   VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?)""",
                (sync_type, images_synced, metadata_updated, status, error_message)
            )
            conn.commit()
            return cursor.lastrowid
    
    def update_sync_log(self, sync_id: int, status: str, images_synced: int = 0, metadata_updated: int = 0, error_message: Optional[str] = None):
        """Update sync log"""
        with self.get_connection() as conn:
            conn.execute(
                """UPDATE sync_log 
                   SET status = ?, images_synced = ?, metadata_updated = ?, 
                       completed_at = CURRENT_TIMESTAMP, error_message = ?
                   WHERE id = ?""",
                (status, images_synced, metadata_updated, error_message, sync_id)
            )
            conn.commit()
    
    def get_latest_sync_status(self) -> Optional[Dict]:
        """Get the latest sync status"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 1"
            )
            row = cursor.fetchone()
            return dict(row) if row else None
    
    # Scene and version methods
    def get_scene(self, scene_id: str) -> Optional[Dict]:
        """Get scene by scene_id"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM scenes WHERE scene_id = ?",
                (scene_id,)
            )
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def get_scenes(self, batch_name: Optional[str] = None, limit: int = 100, offset: int = 0) -> List[Dict]:
        """Get list of scenes, optionally filtered by batch"""
        with self.get_connection() as conn:
            if batch_name:
                cursor = conn.execute(
                    """SELECT * FROM scenes 
                       WHERE batch_name = ?
                       ORDER BY created_at DESC
                       LIMIT ? OFFSET ?""",
                    (batch_name, limit, offset)
                )
            else:
                cursor = conn.execute(
                    """SELECT * FROM scenes 
                       ORDER BY created_at DESC
                       LIMIT ? OFFSET ?""",
                    (limit, offset)
                )
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
    
    def get_scenes_by_roll_number(self, roll_number: str) -> List[Dict]:
        """Get all scenes for a given roll number"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                """SELECT * FROM scenes 
                   WHERE roll_number = ?
                   ORDER BY base_filename ASC""",
                (roll_number,)
            )
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
    
    def search_scenes_fts(
        self,
        query: str,
        roll_number: Optional[str] = None,
        roll_date: Optional[str] = None,
        batch_name: Optional[str] = None,
        date_source: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Dict:
        """
        Full-text search with faceted filters
        
        Returns:
            Dict with 'results' (list of scenes) and 'facets' (facet counts)
        """
        with self.get_connection() as conn:
            # Build WHERE clause for filters
            where_clauses = []
            params = []
            
            # FTS5 search
            if query:
                # FTS5 syntax: simple queries work directly, for multiple terms use OR
                # Escape special FTS5 characters: ", ', \
                # For simple queries, just use the query as-is
                # For multiple words, join with OR
                query_terms = [term.strip() for term in query.split() if term.strip()]
                if len(query_terms) > 1:
                    # Multiple terms: use OR
                    fts_query = " OR ".join(query_terms)
                else:
                    # Single term or phrase
                    fts_query = query
                
                where_clauses.append("""
                    scene_id IN (
                        SELECT scene_id FROM scenes_fts 
                        WHERE scenes_fts MATCH ?
                    )
                """)
                params.append(fts_query)
            
            # Faceted filters
            if roll_number:
                where_clauses.append("roll_number = ?")
                params.append(roll_number)
            
            if roll_date:
                where_clauses.append("roll_date = ?")
                params.append(roll_date)
            
            if batch_name:
                where_clauses.append("batch_name = ?")
                params.append(batch_name)
            
            if date_source:
                where_clauses.append("date_source = ?")
                params.append(date_source)
            
            where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"
            
            # Get matching scenes
            cursor = conn.execute(
                f"""SELECT * FROM scenes 
                   WHERE {where_sql}
                   ORDER BY updated_at DESC
                   LIMIT ? OFFSET ?""",
                params + [limit, offset]
            )
            results = [dict(row) for row in cursor.fetchall()]
            
            # Get total count
            cursor = conn.execute(
                f"SELECT COUNT(*) FROM scenes WHERE {where_sql}",
                params
            )
            total = cursor.fetchone()[0]
            
            # Get facet counts (only if no filters applied, or for active filters)
            facets = {}
            
            # Roll number facets
            if not roll_number:
                cursor = conn.execute(
                    f"""SELECT roll_number, COUNT(*) as count 
                       FROM scenes 
                       WHERE {where_sql} AND roll_number IS NOT NULL
                       GROUP BY roll_number 
                       ORDER BY count DESC, roll_number ASC
                       LIMIT 20""",
                    params
                )
                facets['roll_numbers'] = [{'value': row[0], 'count': row[1]} for row in cursor.fetchall()]
            
            # Roll date facets
            if not roll_date:
                cursor = conn.execute(
                    f"""SELECT roll_date, COUNT(*) as count 
                       FROM scenes 
                       WHERE {where_sql} AND roll_date IS NOT NULL
                       GROUP BY roll_date 
                       ORDER BY count DESC, roll_date DESC
                       LIMIT 20""",
                    params
                )
                facets['roll_dates'] = [{'value': row[0], 'count': row[1]} for row in cursor.fetchall()]
            
            # Batch name facets
            if not batch_name:
                cursor = conn.execute(
                    f"""SELECT batch_name, COUNT(*) as count 
                       FROM scenes 
                       WHERE {where_sql}
                       GROUP BY batch_name 
                       ORDER BY count DESC, batch_name ASC
                       LIMIT 20""",
                    params
                )
                facets['batch_names'] = [{'value': row[0], 'count': row[1]} for row in cursor.fetchall()]
            
            # Date source facets
            if not date_source:
                cursor = conn.execute(
                    f"""SELECT date_source, COUNT(*) as count 
                       FROM scenes 
                       WHERE {where_sql} AND date_source IS NOT NULL
                       GROUP BY date_source 
                       ORDER BY count DESC
                       LIMIT 10""",
                    params
                )
                facets['date_sources'] = [{'value': row[0], 'count': row[1]} for row in cursor.fetchall()]
            
            return {
                'results': results,
                'total': total,
                'facets': facets
            }
    
    def get_search_suggestions(self, query: str, limit: int = 10) -> List[str]:
        """Get search suggestions based on partial query"""
        with self.get_connection() as conn:
            # Search in base_filename, roll_number, roll_comment
            suggestions = []
            
            # Search filenames
            cursor = conn.execute(
                """SELECT DISTINCT base_filename FROM scenes 
                   WHERE base_filename LIKE ? 
                   LIMIT ?""",
                (f"%{query}%", limit)
            )
            suggestions.extend([row[0] for row in cursor.fetchall()])
            
            # Search roll numbers
            cursor = conn.execute(
                """SELECT DISTINCT roll_number FROM scenes 
                   WHERE roll_number LIKE ? AND roll_number IS NOT NULL
                   LIMIT ?""",
                (f"%{query}%", limit)
            )
            suggestions.extend([row[0] for row in cursor.fetchall()])
            
            # Search roll comments
            cursor = conn.execute(
                """SELECT DISTINCT roll_comment FROM scenes 
                   WHERE roll_comment LIKE ? AND roll_comment IS NOT NULL
                   LIMIT ?""",
                (f"%{query}%", limit)
            )
            suggestions.extend([row[0] for row in cursor.fetchall() if row[0]])
            
            return list(set(suggestions))[:limit]
    
    def get_current_version_for_scene(self, scene_id: str) -> Optional[Dict]:
        """Get the current (live) version for a scene"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                """SELECT * FROM image_versions 
                   WHERE scene_id = ? AND is_current = 1 AND r2_key IS NOT NULL
                   LIMIT 1""",
                (scene_id,)
            )
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def get_all_versions_for_scene(self, scene_id: str) -> List[Dict]:
        """Get all versions for a scene"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                """SELECT * FROM image_versions 
                   WHERE scene_id = ?
                   ORDER BY created_at DESC""",
                (scene_id,)
            )
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
    
    def get_live_versions(self, limit: int = 1000) -> List[Dict]:
        """Get all live versions (r2_key IS NOT NULL) for similarity search"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                """SELECT iv.*, s.batch_name, s.base_filename, s.capture_date
                   FROM image_versions iv
                   JOIN scenes s ON iv.scene_id = s.scene_id
                   WHERE iv.r2_key IS NOT NULL
                     AND iv.perceptual_hash IS NOT NULL
                   ORDER BY iv.created_at DESC
                   LIMIT ?""",
                (limit,)
            )
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
    
    def find_similar_scenes(self, target_hash: str, threshold: int = 10, limit: int = 20) -> List[Dict]:
        """
        Find scenes with similar perceptual hashes.
        Only searches against live versions (r2_key IS NOT NULL).
        """
        def hamming_distance(hash1: str, hash2: str) -> int:
            """Calculate Hamming distance between two hex hashes"""
            if not hash1 or not hash2 or len(hash1) != len(hash2):
                return float('inf')
            return sum(c1 != c2 for c1, c2 in zip(hash1, hash2))
        
        # Get all live versions with hashes
        live_versions = self.get_live_versions(limit=10000)  # Get enough for comparison
        
        similar = []
        for version in live_versions:
            if not version.get('perceptual_hash'):
                continue
            distance = hamming_distance(target_hash, version['perceptual_hash'])
            if distance <= threshold:
                similar.append({
                    'scene_id': version['scene_id'],
                    'version_id': version['version_id'],
                    'distance': distance,
                    'r2_key': version['r2_key'],
                    'batch_name': version['batch_name'],
                    'base_filename': version['base_filename'],
                    'capture_date': version.get('capture_date')
                })
        
        # Sort by distance and limit
        similar.sort(key=lambda x: x['distance'])
        return similar[:limit]
    
    def create_or_update_scene(
        self, 
        scene_id: str, 
        batch_name: str, 
        base_filename: str, 
        capture_date: Optional[str] = None,
        description: Optional[str] = None,
        description_model: Optional[str] = None,
        description_timestamp: Optional[str] = None,
        # Batch metadata
        roll_number: Optional[str] = None,
        roll_date: Optional[str] = None,
        date_source: Optional[str] = None,
        date_notes: Optional[str] = None,
        roll_comment: Optional[str] = None,
        index_book_number: Optional[str] = None,
        index_book_date: Optional[str] = None,
        index_book_comment: Optional[str] = None,
        short_description: Optional[str] = None
    ) -> str:
        """Create or update a scene"""
        with self.get_connection() as conn:
            # Log if description is being passed
            if description:
                logger.info(f"Storing description for {scene_id}: model={description_model}, length={len(description)}")
            
            # Use INSERT ... ON CONFLICT to properly update all fields
            conn.execute(
                """INSERT INTO scenes 
                   (scene_id, batch_name, base_filename, capture_date, description, description_model, description_timestamp,
                    roll_number, roll_date, date_source, date_notes, roll_comment,
                    index_book_number, index_book_date, index_book_comment, short_description, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(scene_id) DO UPDATE SET
                       batch_name = excluded.batch_name,
                       base_filename = excluded.base_filename,
                       capture_date = excluded.capture_date,
                       description = excluded.description,
                       description_model = excluded.description_model,
                       description_timestamp = excluded.description_timestamp,
                       roll_number = excluded.roll_number,
                       roll_date = excluded.roll_date,
                       date_source = excluded.date_source,
                       date_notes = excluded.date_notes,
                       roll_comment = excluded.roll_comment,
                       index_book_number = excluded.index_book_number,
                       index_book_date = excluded.index_book_date,
                       index_book_comment = excluded.index_book_comment,
                       short_description = excluded.short_description,
                       updated_at = CURRENT_TIMESTAMP""",
                (scene_id, batch_name, base_filename, capture_date, description, description_model, description_timestamp,
                 roll_number, roll_date, date_source, date_notes, roll_comment,
                 index_book_number, index_book_date, index_book_comment, short_description)
            )
            conn.commit()
            return scene_id
    
    def create_version(
        self,
        version_id: str,
        scene_id: str,
        version_type: str,
        local_path: str,
        perceptual_hash: Optional[str] = None,
        md5_hash: Optional[str] = None,
        r2_key: Optional[str] = None,
        is_current: bool = False
    ) -> str:
        """Create a new image version"""
        with self.get_connection() as conn:
            # If this is marked as current, unset other current versions for this scene
            if is_current:
                conn.execute(
                    "UPDATE image_versions SET is_current = 0 WHERE scene_id = ?",
                    (scene_id,)
                )
            
            conn.execute(
                """INSERT OR REPLACE INTO image_versions 
                   (version_id, scene_id, version_type, local_path, perceptual_hash, md5_hash, r2_key, is_current, synced_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (version_id, scene_id, version_type, local_path, perceptual_hash, md5_hash, r2_key, is_current, 
                 datetime.now().isoformat() if r2_key else None)
            )
            conn.commit()
            return version_id
    
    def update_version_r2_key(self, version_id: str, r2_key: Optional[str]):
        """Update the r2_key for a version (mark as live or not live)"""
        with self.get_connection() as conn:
            synced_at = datetime.now().isoformat() if r2_key else None
            conn.execute(
                "UPDATE image_versions SET r2_key = ?, synced_at = ? WHERE version_id = ?",
                (r2_key, synced_at, version_id)
            )
            conn.commit()


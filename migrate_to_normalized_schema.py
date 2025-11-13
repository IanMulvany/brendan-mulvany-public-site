"""
Migration utility to backfill the normalized search schema.

This script populates the new scene_descriptions, scene_metadata, scene_tags,
and scene_people tables, then rebuilds the scene_search_fts virtual table.
It supports both local SQLite files and remote Turso databases (via libSQL).
"""

import argparse
import hashlib
import logging
from pathlib import Path
from typing import Dict, Iterable, Tuple

from database import PublicSiteDatabase, LIBSQL_AVAILABLE


logger = logging.getLogger("schema_migration")
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Populate normalized scene tables and rebuild FTS index."
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        help="Path to local SQLite database file (e.g., public_site.db).",
    )
    parser.add_argument(
        "--turso-url",
        type=str,
        help="Turso database URL (set together with --turso-token).",
    )
    parser.add_argument(
        "--turso-token",
        type=str,
        help="Turso database auth token.",
    )
    parser.add_argument(
        "--compact-scenes",
        action="store_true",
        help=(
            "After backfilling, rewrite the scenes table without legacy text columns. "
            "Only enable this once the application code has been updated to read from "
            "the normalized tables."
        ),
    )
    parser.add_argument(
        "--vacuum",
        action="store_true",
        help="Run VACUUM at the end to reclaim space (SQLite only).",
    )

    args = parser.parse_args()

    if bool(args.turso_url) != bool(args.turso_token):
        parser.error("Both --turso-url and --turso-token are required for Turso mode.")

    if not args.db_path and not args.turso_url:
        parser.error("Provide either --db-path for SQLite or --turso-url/--turso-token for Turso.")

    if args.turso_url and not LIBSQL_AVAILABLE:
        parser.error("libsql_experimental is required for Turso migrations but is not installed.")

    return args


def create_database_client(args: argparse.Namespace) -> PublicSiteDatabase:
    if args.turso_url:
        logger.info("Connecting to Turso database at %s", args.turso_url)
        return PublicSiteDatabase(turso_url=args.turso_url, turso_token=args.turso_token)

    db_path = args.db_path.resolve()
    logger.info("Using local SQLite database at %s", db_path)
    return PublicSiteDatabase(db_path=db_path)


def migrate_scene_tables(conn) -> Tuple[int, int]:
    """Populate normalized description and metadata tables from legacy columns."""
    logger.info("Backfilling scene_descriptions table...")
    conn.execute("""
        INSERT OR REPLACE INTO scene_descriptions(
            scene_id, description, description_model, description_timestamp, short_description
        )
        SELECT
            scene_id,
            description,
            description_model,
            description_timestamp,
            short_description
        FROM scenes
        WHERE description IS NOT NULL
           OR short_description IS NOT NULL
           OR description_model IS NOT NULL
           OR description_timestamp IS NOT NULL
    """)
    descriptions = conn.execute("SELECT COUNT(*) FROM scene_descriptions").fetchone()[0]
    logger.info("scene_descriptions populated with %s rows", descriptions)

    logger.info("Backfilling scene_metadata table...")
    conn.execute("""
        INSERT OR REPLACE INTO scene_metadata(
            scene_id,
            roll_number,
            roll_date,
            date_source,
            date_notes,
            roll_comment,
            index_book_number,
            index_book_date,
            index_book_comment
        )
        SELECT
            scene_id,
            roll_number,
            roll_date,
            date_source,
            date_notes,
            roll_comment,
            index_book_number,
            index_book_date,
            index_book_comment
        FROM scenes
        WHERE roll_number IS NOT NULL
           OR roll_date IS NOT NULL
           OR date_source IS NOT NULL
           OR date_notes IS NOT NULL
           OR roll_comment IS NOT NULL
           OR index_book_number IS NOT NULL
           OR index_book_date IS NOT NULL
           OR index_book_comment IS NOT NULL
    """)
    metadata_rows = conn.execute("SELECT COUNT(*) FROM scene_metadata").fetchone()[0]
    logger.info("scene_metadata populated with %s rows", metadata_rows)

    return descriptions, metadata_rows


def scene_id_to_image_id(scene_id: str) -> int:
    """Match the hashing strategy used by the public API."""
    md5_hash = hashlib.md5(scene_id.encode("utf-8")).hexdigest()
    return int(md5_hash[:8], 16) % (10**9)


def migrate_people(conn) -> int:
    """
    Populate scene_people from existing person_names data.

    The legacy person_names table is keyed by hashed image_id values.
    We reconstruct the mapping by hashing scene_ids the same way the API does.
    """
    logger.info("Backfilling scene_people from person_names via hashed scene IDs...")

    scenes = conn.execute("SELECT scene_id FROM scenes").fetchall()
    if not scenes:
        logger.info("No scenes found; skipping scene_people migration.")
        return 0

    hash_to_scene: Dict[int, str] = {}
    for row in scenes:
        scene_id = row[0] if isinstance(row, tuple) else row["scene_id"]
        hash_to_scene[scene_id_to_image_id(scene_id)] = scene_id

    people_rows = conn.execute("""
        SELECT image_id, name, created_at
        FROM person_names
        WHERE name IS NOT NULL
    """).fetchall()

    if not people_rows:
        logger.info("person_names table is empty; nothing to migrate.")
        return 0

    conn.execute("DELETE FROM scene_people")
    records = []
    for row in people_rows:
        image_id = row[0] if isinstance(row, tuple) else row["image_id"]
        name = row[1] if isinstance(row, tuple) else row["name"]
        created_at = row[2] if isinstance(row, tuple) else row["created_at"]
        if image_id is None or name is None:
            continue
        scene_id = hash_to_scene.get(int(image_id))
        if not scene_id:
            continue
        records.append((scene_id, name, created_at))

    if records:
        conn.executemany(
            "INSERT OR IGNORE INTO scene_people(scene_id, person, created_at) VALUES (?, ?, ?)",
            records,
        )

    logger.info("scene_people populated with %s rows", len(records))
    return len(records)


def rebuild_scene_search_fts(conn):
    logger.info("Rebuilding scene_search_fts index...")
    conn.execute("DELETE FROM scene_search_fts")
    conn.execute("""
        INSERT INTO scene_search_fts(
            rowid,
            scene_id,
            base_filename,
            description,
            roll_comment,
            date_notes,
            index_book_comment,
            short_description,
            tags,
            people
        )
        SELECT
            rowid,
            scene_id,
            base_filename,
            description,
            roll_comment,
            date_notes,
            index_book_comment,
            short_description,
            tags,
            people
        FROM scene_search_index
    """)
    total = conn.execute("SELECT COUNT(*) FROM scene_search_fts").fetchone()[0]
    logger.info("scene_search_fts now contains %s documents", total)


def compact_scenes_table(conn):
    logger.info("Compacting scenes table to drop legacy text columns...")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scenes_compact (
            scene_id TEXT PRIMARY KEY,
            batch_name TEXT NOT NULL,
            base_filename TEXT NOT NULL,
            capture_date TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(batch_name, base_filename)
        )
    """)

    conn.execute("""
        INSERT OR IGNORE INTO scenes_compact(
            scene_id,
            batch_name,
            base_filename,
            capture_date,
            created_at,
            updated_at
        )
        SELECT
            scene_id,
            batch_name,
            base_filename,
            capture_date,
            created_at,
            updated_at
        FROM scenes
    """)

    conn.execute("DROP TABLE scenes")
    conn.execute("ALTER TABLE scenes_compact RENAME TO scenes")
    logger.info("scenes table compacted successfully.")


def main():
    args = parse_args()
    database_client = create_database_client(args)

    needs_schema_refresh = False

    with database_client.get_connection() as conn:
        conn.execute("PRAGMA foreign_keys=ON;")
        try:
            conn.execute("BEGIN")
            migrate_scene_tables(conn)
            migrate_people(conn)
            rebuild_scene_search_fts(conn)

            if args.compact_scenes:
                compact_scenes_table(conn)
                needs_schema_refresh = True

            conn.commit()
        except Exception:
            conn.rollback()
            logger.exception("Migration failed; rolled back changes.")
            raise

    if needs_schema_refresh:
        database_client._init_schema()

    if args.vacuum and not args.turso_url:
        logger.info("Running VACUUM to reclaim space...")
        with database_client.get_connection() as vacuum_conn:
            vacuum_conn.execute("VACUUM")

    logger.info("Migration completed successfully.")


if __name__ == "__main__":
    main()


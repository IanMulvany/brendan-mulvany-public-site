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

    schema_path = Path(__file__).parent / "schema.sql"
    if not schema_path.exists():
        conn.close()
        raise FileNotFoundError(f"Schema file not found at {schema_path}")

    schema_sql = schema_path.read_text(encoding="utf-8")
    cursor.executescript(schema_sql)

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

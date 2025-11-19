#!/usr/bin/env python3
"""Compare perceptual hashes between local SQLite and Turso databases"""

import sqlite3
from pathlib import Path
import sys

# Try to import libsql for Turso support
try:
    import libsql_experimental
    LIBSQL_AVAILABLE = True
except ImportError:
    LIBSQL_AVAILABLE = False
    print("⚠️  libsql_experimental not available. Install with: pip install libsql-experimental")
    sys.exit(1)

# Local database path
LOCAL_DB = Path(__file__).parent / "public_site.db"

# Turso connection details
TURSO_URL = "libsql://public-site-db-ianmulvany.aws-eu-west-1.turso.io"
TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NjI5NDI2NDQsImlkIjoiMTE4ZjQ1M2MtZjA5Yi00YTRmLWFjOGItMDM4MGZiNTQzYmZmIiwicmlkIjoiYjI2OGMyYTEtZGY5NC00Y2IzLTkyNjQtODlmNDFmYWNhMTU5In0.ZYjr-106sxlUXu3XOVYyMlQr0zWL3NqLMazmHSl7FDWMad3D_z4p_9ijvQtPcdcaJOwVqJEblD57IRTVFZIOCA"

def query_local_db():
    """Query local SQLite database"""
    print("📊 Querying LOCAL database...")
    conn = sqlite3.connect(str(LOCAL_DB))
    conn.row_factory = sqlite3.Row
    
    # Get stats
    stats = conn.execute("""
        SELECT 
            COUNT(*) as total_versions,
            COUNT(perceptual_hash) as versions_with_hash,
            COUNT(CASE WHEN is_current = 1 THEN 1 END) as current_versions,
            COUNT(CASE WHEN is_current = 1 AND perceptual_hash IS NOT NULL THEN 1 END) as current_with_hash
        FROM image_versions
    """).fetchone()
    
    print(f"   Total versions: {stats['total_versions']}")
    print(f"   Versions with hash: {stats['versions_with_hash']}")
    print(f"   Current versions: {stats['current_versions']}")
    print(f"   Current versions with hash: {stats['current_with_hash']}")
    
    # Get sample of current versions with hashes
    samples = conn.execute("""
        SELECT scene_id, perceptual_hash, version_id
        FROM image_versions
        WHERE is_current = 1 AND perceptual_hash IS NOT NULL
        LIMIT 10
    """).fetchall()
    
    print(f"\n   Sample current versions with hashes ({len(samples)}):")
    for row in samples[:5]:
        print(f"     - {row['scene_id']}: {row['perceptual_hash'][:16]}...")
    
    conn.close()
    return stats, samples

def query_turso_db():
    """Query Turso database"""
    print("\n📊 Querying TURSO database...")
    
    # Create temporary cache file for libsql
    import tempfile
    cache_file = tempfile.NamedTemporaryFile(delete=False, suffix='.db')
    cache_path = cache_file.name
    cache_file.close()
    
    try:
        conn = libsql_experimental.connect(
            database=cache_path,
            sync_url=TURSO_URL,
            auth_token=TURSO_TOKEN
        )
        
        # Sync schema and data
        print("   Syncing with Turso...")
        conn.sync()
        
        # Get stats
        stats_result = conn.execute("""
            SELECT 
                COUNT(*) as total_versions,
                COUNT(perceptual_hash) as versions_with_hash,
                COUNT(CASE WHEN is_current = 1 THEN 1 END) as current_versions,
                COUNT(CASE WHEN is_current = 1 AND perceptual_hash IS NOT NULL THEN 1 END) as current_with_hash
            FROM image_versions
        """)
        
        # libsql returns tuples, convert to dict
        row = stats_result.fetchone()
        stats = {
            'total_versions': row[0],
            'versions_with_hash': row[1],
            'current_versions': row[2],
            'current_with_hash': row[3]
        }
        
        print(f"   Total versions: {stats['total_versions']}")
        print(f"   Versions with hash: {stats['versions_with_hash']}")
        print(f"   Current versions: {stats['current_versions']}")
        print(f"   Current versions with hash: {stats['current_with_hash']}")
        
        # Get sample of current versions with hashes
        samples_result = conn.execute("""
            SELECT scene_id, perceptual_hash, version_id
            FROM image_versions
            WHERE is_current = 1 AND perceptual_hash IS NOT NULL
            LIMIT 10
        """)
        
        samples = []
        rows = samples_result.fetchall()
        for row in rows:
            samples.append({
                'scene_id': row[0],
                'perceptual_hash': row[1],
                'version_id': row[2]
            })
        
        print(f"\n   Sample current versions with hashes ({len(samples)}):")
        for sample in samples[:5]:
            hash_preview = sample['perceptual_hash'][:16] + "..." if sample['perceptual_hash'] else "None"
            print(f"     - {sample['scene_id']}: {hash_preview}")
        
        conn.close()
        return stats, samples
        
    finally:
        # Clean up temp file
        import os
        try:
            os.unlink(cache_path)
        except:
            pass

def compare_databases(local_stats, local_samples, turso_stats, turso_samples):
    """Compare the two databases"""
    print("\n🔍 COMPARISON:")
    print("=" * 60)
    
    print(f"\nTotal Versions:")
    print(f"  Local:  {local_stats['total_versions']}")
    print(f"  Turso:  {turso_stats['total_versions']}")
    print(f"  Match:  {'✅' if local_stats['total_versions'] == turso_stats['total_versions'] else '❌'}")
    
    print(f"\nVersions with Perceptual Hash:")
    print(f"  Local:  {local_stats['versions_with_hash']}")
    print(f"  Turso:  {turso_stats['versions_with_hash']}")
    print(f"  Match:  {'✅' if local_stats['versions_with_hash'] == turso_stats['versions_with_hash'] else '❌'}")
    
    print(f"\nCurrent Versions:")
    print(f"  Local:  {local_stats['current_versions']}")
    print(f"  Turso:  {turso_stats['current_versions']}")
    print(f"  Match:  {'✅' if local_stats['current_versions'] == turso_stats['current_versions'] else '❌'}")
    
    print(f"\nCurrent Versions with Perceptual Hash:")
    print(f"  Local:  {local_stats['current_with_hash']}")
    print(f"  Turso:  {turso_stats['current_with_hash']}")
    print(f"  Match:  {'✅' if local_stats['current_with_hash'] == turso_stats['current_with_hash'] else '❌'}")
    
    if local_stats['current_with_hash'] == 0 and turso_stats['current_with_hash'] == 0:
        print("\n⚠️  WARNING: Neither database has perceptual hashes!")
        print("   This means similarity search will not work.")
        print("   You need to sync perceptual hashes from the photo system database.")
    elif local_stats['current_with_hash'] == 0:
        print("\n⚠️  WARNING: Local database has no perceptual hashes!")
        print("   Turso database has hashes, but local doesn't.")
    elif turso_stats['current_with_hash'] == 0:
        print("\n⚠️  WARNING: Turso database has no perceptual hashes!")
        print("   Local database has hashes, but Turso doesn't.")

if __name__ == "__main__":
    print("🔍 Comparing Perceptual Hashes: Local SQLite vs Turso\n")
    
    try:
        local_stats, local_samples = query_local_db()
        turso_stats, turso_samples = query_turso_db()
        compare_databases(local_stats, local_samples, turso_stats, turso_samples)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


#!/usr/bin/env python3
"""
Comprehensive database sync checker for local SQLite vs Turso.
Compares all tables, row counts, and sample records between databases.
"""

import sqlite3
import subprocess
import sys
import os
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Tuple

def run_local_query(db_path: str, query: str, params: Tuple = None) -> List[Tuple]:
    """Execute query on local SQLite database."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    if params:
        cursor.execute(query, params)
    else:
        cursor.execute(query)
    results = cursor.fetchall()
    conn.close()
    return results

def run_turso_query(db_name: str, query: str) -> List[str]:
    """Execute query on Turso database via CLI."""
    cmd = ['turso', 'db', 'shell', db_name, query]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return []
    lines = result.stdout.strip().split('\n')
    return [line for line in lines if line.strip()]

def parse_turso_rows(lines: List[str]) -> List[Dict]:
    """Parse Turso CLI output into list of dicts."""
    if not lines:
        return []
    # First line is header
    headers = [h.strip() for h in lines[0].split('|')]
    rows = []
    for line in lines[1:]:
        if not line.strip():
            continue
        values = [v.strip() for v in line.split('|')]
        if len(values) == len(headers):
            rows.append(dict(zip(headers, values)))
    return rows

def get_table_counts(db_path: str, db_name: str) -> Dict[str, Tuple[int, int]]:
    """Get row counts for all tables in both databases."""
    counts = {}
    
    # Get tables from local DB
    local_tables = run_local_query(db_path, 
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    local_tables = [row[0] for row in local_tables]
    
    # Get counts for local tables
    local_counts = {}
    for table in local_tables:
        try:
            result = run_local_query(db_path, f"SELECT COUNT(*) FROM {table}")
            local_counts[table] = result[0][0] if result else 0
        except Exception as e:
            local_counts[table] = -1  # Error indicator
    
    # Get counts for Turso tables
    turso_counts = {}
    for table in local_tables:
        try:
            lines = run_turso_query(db_name, f"SELECT COUNT(*) as count FROM {table};")
            if lines:
                # Parse the count from output - Turso CLI returns formatted output
                for line in lines:
                    if line.strip().isdigit():
                        turso_counts[table] = int(line.strip())
                        break
                    # Try parsing from formatted output like "| count |"
                    parts = line.split('|')
                    for part in parts:
                        part = part.strip()
                        if part.isdigit():
                            turso_counts[table] = int(part)
                            break
                    if table in turso_counts:
                        break
                else:
                    turso_counts[table] = 0
            else:
                turso_counts[table] = 0
        except Exception as e:
            turso_counts[table] = -1
    
    for table in local_tables:
        counts[table] = (local_counts.get(table, 0), turso_counts.get(table, 0))
    
    return counts

def get_all_scenes_local(db_path: str) -> Dict[str, Dict]:
    """Get all scenes from local database."""
    query = """
        SELECT scene_id, batch_name, base_filename, capture_date, description,
               roll_number, roll_date, date_source, updated_at
        FROM scenes
        ORDER BY scene_id
    """
    rows = run_local_query(db_path, query)
    scenes = {}
    for row in rows:
        scenes[row[0]] = {
            'scene_id': row[0],
            'batch_name': row[1],
            'base_filename': row[2],
            'capture_date': row[3],
            'description': row[4],
            'roll_number': row[5],
            'roll_date': row[6],
            'date_source': row[7],
            'updated_at': row[8]
        }
    return scenes

def get_all_scenes_turso(db_name: str) -> Dict[str, Dict]:
    """Get all scenes from Turso database."""
    query = "SELECT scene_id, batch_name, base_filename, capture_date, description, roll_number, roll_date, date_source, updated_at FROM scenes ORDER BY scene_id;"
    lines = run_turso_query(db_name, query)
    scenes = {}
    
    # Parse the output
    parsed = parse_turso_rows(lines)
    for row in parsed:
        scenes[row['scene_id']] = {
            'scene_id': row['scene_id'],
            'batch_name': row.get('batch_name', ''),
            'base_filename': row.get('base_filename', ''),
            'capture_date': row.get('capture_date'),
            'description': row.get('description'),
            'roll_number': row.get('roll_number'),
            'roll_date': row.get('roll_date'),
            'date_source': row.get('date_source'),
            'updated_at': row.get('updated_at')
        }
    return scenes

def compare_scenes(local_scenes: Dict[str, Dict], turso_scenes: Dict[str, Dict]) -> Dict:
    """Compare scenes between databases."""
    local_ids = set(local_scenes.keys())
    turso_ids = set(turso_scenes.keys())
    
    missing_in_turso = local_ids - turso_ids
    missing_in_local = turso_ids - local_ids
    common_ids = local_ids & turso_ids
    
    # Field mismatches
    field_mismatches = defaultdict(list)
    
    for scene_id in common_ids:
        local = local_scenes[scene_id]
        turso = turso_scenes[scene_id]
        
        for field in ['batch_name', 'base_filename', 'capture_date', 'description', 
                     'roll_number', 'roll_date', 'date_source']:
            local_val = local.get(field) or ''
            turso_val = turso.get(field) or ''
            if local_val != turso_val:
                field_mismatches[field].append({
                    'scene_id': scene_id,
                    'local': local_val,
                    'turso': turso_val
                })
    
    return {
        'local_count': len(local_ids),
        'turso_count': len(turso_ids),
        'common_count': len(common_ids),
        'missing_in_turso': list(missing_in_turso),
        'missing_in_local': list(missing_in_local),
        'field_mismatches': dict(field_mismatches)
    }

def get_table_sample(db_path: str, table: str, limit: int = 5) -> List[Dict]:
    """Get sample records from local table."""
    try:
        # First get column names
        cols_query = f"PRAGMA table_info({table})"
        col_info = run_local_query(db_path, cols_query)
        columns = [row[1] for row in col_info]
        
        if not columns:
            return []
        
        query = f"SELECT * FROM {table} LIMIT {limit}"
        rows = run_local_query(db_path, query)
        
        samples = []
        for row in rows:
            samples.append(dict(zip(columns, row)))
        return samples
    except Exception as e:
        return []

def main():
    local_db = './public_site.db'
    turso_db = 'public-site-db'
    
    # Convert to absolute path for clarity
    local_db_abs = str(Path(local_db).resolve())
    
    print(f"{'='*80}")
    print("🔍 COMPREHENSIVE DATABASE SYNC CHECKER")
    print(f"{'='*80}\n")
    print("DATABASES BEING COMPARED:")
    print(f"  Local SQLite DB:  {local_db_abs}")
    print(f"  Turso DB Name:    {turso_db}")
    print(f"  Turso DB Type:    Remote Turso database (accessed via CLI)\n")
    
    # Verify local DB exists
    if not os.path.exists(local_db_abs):
        print(f"❌ ERROR: Local database file not found: {local_db_abs}")
        return 1
    
    print(f"✓ Local database file exists\n")
    
    # 1. Table summaries
    print("📊 TABLE SUMMARIES")
    print(f"{'='*80}\n")
    print(f"{'Table':<30} {'Local Count':<15} {'Turso Count':<15} {'Status'}")
    print("-" * 80)
    
    table_counts = get_table_counts(local_db, turso_db)
    all_synced = True
    
    for table, (local_count, turso_count) in sorted(table_counts.items()):
        if local_count == turso_count:
            status = "✅ SYNCED"
        elif local_count == -1 or turso_count == -1:
            status = "⚠️  ERROR"
            all_synced = False
        else:
            status = f"❌ DIFF ({local_count - turso_count:+d})"
            all_synced = False
        
        print(f"{table:<30} {local_count:<15} {turso_count:<15} {status}")
    
    print("\n")
    
    # 2. Detailed scenes comparison
    print(f"{'='*80}")
    print("🎬 SCENES TABLE COMPARISON")
    print(f"{'='*80}\n")
    
    print(f"Fetching all scenes from local database ({local_db_abs})...")
    local_scenes = get_all_scenes_local(local_db)
    print(f"Found {len(local_scenes)} scenes in local DB\n")
    
    print(f"Fetching all scenes from Turso database ({turso_db})...")
    turso_scenes = get_all_scenes_turso(turso_db)
    print(f"Found {len(turso_scenes)} scenes in Turso DB\n")
    
    comparison = compare_scenes(local_scenes, turso_scenes)
    
    print(f"Summary:")
    print(f"  Local scenes:  {comparison['local_count']}")
    print(f"  Turso scenes:  {comparison['turso_count']}")
    print(f"  Common scenes: {comparison['common_count']}\n")
    
    if comparison['missing_in_turso']:
        print(f"⚠️  Missing in Turso ({len(comparison['missing_in_turso'])}):")
        for scene_id in comparison['missing_in_turso'][:10]:
            print(f"   - {scene_id}")
        if len(comparison['missing_in_turso']) > 10:
            print(f"   ... and {len(comparison['missing_in_turso']) - 10} more")
        print()
    
    if comparison['missing_in_local']:
        print(f"⚠️  Missing in Local ({len(comparison['missing_in_local'])}):")
        for scene_id in comparison['missing_in_local'][:10]:
            print(f"   - {scene_id}")
        if len(comparison['missing_in_local']) > 10:
            print(f"   ... and {len(comparison['missing_in_local']) - 10} more")
        print()
    
    # Field mismatches
    if comparison['field_mismatches']:
        print(f"⚠️  Field Mismatches:")
        for field, mismatches in comparison['field_mismatches'].items():
            print(f"\n  {field}: {len(mismatches)} mismatches")
            for mismatch in mismatches[:3]:
                print(f"    Scene: {mismatch['scene_id']}")
                local_val = str(mismatch['local'])[:60]
                turso_val = str(mismatch['turso'])[:60]
                print(f"      Local:  {local_val}")
                print(f"      Turso:  {turso_val}")
            if len(mismatches) > 3:
                print(f"    ... and {len(mismatches) - 3} more")
        print()
    else:
        print("✅ All field values match for common scenes\n")
    
    # 3. Sample records
    print(f"{'='*80}")
    print("📋 SAMPLE RECORDS")
    print(f"{'='*80}\n")
    
    for table in sorted(table_counts.keys())[:3]:  # Show samples for first 3 tables
        local_count = table_counts[table][0]
        turso_count = table_counts[table][1]
        
        if local_count == 0 and turso_count == 0:
            continue
        
        print(f"Table: {table}")
        print("-" * 80)
        
        samples = get_table_sample(local_db, table, limit=2)
        if samples:
            print("  Local sample:")
            for sample in samples[:2]:
                sample_str = {k: str(v)[:50] if v else None for k, v in sample.items()}
                print(f"    {sample_str}")
        print()
    
    # 4. Overall summary
    print(f"{'='*80}")
    print("📈 OVERALL SUMMARY")
    print(f"{'='*80}\n")
    
    scenes_synced = (comparison['local_count'] == comparison['turso_count'] and 
                     not comparison['missing_in_turso'] and 
                     not comparison['missing_in_local'] and
                     not comparison['field_mismatches'])
    
    if all_synced and scenes_synced:
        print("✅ DATABASES ARE FULLY IN SYNC!")
        return 0
    else:
        print("⚠️  DATABASES HAVE DIFFERENCES:")
        if not all_synced:
            print("  - Table row counts differ")
        if comparison['missing_in_turso']:
            print(f"  - {len(comparison['missing_in_turso'])} scenes missing in Turso")
        if comparison['missing_in_local']:
            print(f"  - {len(comparison['missing_in_local'])} scenes missing in Local")
        if comparison['field_mismatches']:
            total_field_mismatches = sum(len(m) for m in comparison['field_mismatches'].values())
            print(f"  - {total_field_mismatches} field value mismatches")
        return 1

if __name__ == '__main__':
    sys.exit(main())

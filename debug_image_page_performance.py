#!/usr/bin/env python3
"""
Debug script to measure performance of image page loading
Tests each API endpoint and database query separately
"""

import time
import sys
from pathlib import Path

# Add current directory to path
sys.path.insert(0, str(Path(__file__).parent))

from database import PublicSiteDatabase
from config_manager import ConfigManager
import os

# Setup paths
CURRENT_DIR = Path(__file__).parent
CONFIG_PATH = CURRENT_DIR / "config.local.yaml"
if not CONFIG_PATH.exists():
    CONFIG_PATH = CURRENT_DIR / "config.yaml"

PUBLIC_DB = CURRENT_DIR / "public_site.db"

def scene_id_to_image_id(scene_id: str) -> int:
    """Convert scene_id to image_id (same as main.py)"""
    import hashlib
    md5_hash = hashlib.md5(scene_id.encode()).hexdigest()
    return int(md5_hash[:8], 16) % (10**9)

def image_id_to_scene_id(image_id: int) -> str:
    """Convert image_id to scene_id (brute force search)"""
    # This is inefficient but works for testing
    public_db = PublicSiteDatabase(db_path=PUBLIC_DB)
    with public_db.get_connection() as conn:
        rows = conn.execute("SELECT scene_id FROM scenes").fetchall()
        for row in rows:
            if scene_id_to_image_id(row[0]) == image_id:
                return row[0]
    return None

def time_function(func, *args, **kwargs):
    """Time a function call"""
    start = time.time()
    result = func(*args, **kwargs)
    elapsed = (time.time() - start) * 1000  # Convert to ms
    return result, elapsed

def main():
    image_id = 777866332
    
    print("=" * 70)
    print("Image Page Performance Debug")
    print("=" * 70)
    print(f"Testing image_id: {image_id}\n")
    
    # Initialize database
    public_db = PublicSiteDatabase(db_path=PUBLIC_DB)
    
    # Test 1: Convert image_id to scene_id
    print("1. Converting image_id to scene_id...")
    scene_id, elapsed = time_function(image_id_to_scene_id, image_id)
    print(f"   Scene ID: {scene_id}")
    print(f"   Time: {elapsed:.2f}ms")
    print()
    
    if not scene_id:
        print("❌ Scene ID not found!")
        return
    
    # Test 2: Get scene
    print("2. Getting scene data...")
    scene, elapsed = time_function(public_db.get_scene, scene_id)
    print(f"   Found: {scene is not None}")
    print(f"   Time: {elapsed:.2f}ms")
    print()
    
    # Test 3: Get current version
    print("3. Getting current version...")
    version, elapsed = time_function(public_db.get_current_version_for_scene, scene_id)
    print(f"   Found: {version is not None}")
    if version:
        print(f"   Has perceptual_hash: {version.get('perceptual_hash') is not None}")
    print(f"   Time: {elapsed:.2f}ms")
    print()
    
    # Test 4: Get all versions
    print("4. Getting all versions...")
    all_versions, elapsed = time_function(public_db.get_all_versions_for_scene, scene_id)
    print(f"   Count: {len(all_versions)}")
    print(f"   Time: {elapsed:.2f}ms")
    print()
    
    # Test 5: Get annotations
    print("5. Getting annotations...")
    annotations, elapsed = time_function(public_db.get_annotations_for_image, image_id)
    print(f"   Count: {len(annotations)}")
    print(f"   Time: {elapsed:.2f}ms")
    print()
    
    # Test 6: Similarity search (the likely bottleneck)
    if version and version.get('perceptual_hash'):
        print("6. Finding similar scenes...")
        target_hash = version['perceptual_hash']
        
        # Time get_live_versions
        print("   6a. Loading live versions...")
        live_versions, elapsed = time_function(public_db.get_live_versions, limit=10000)
        print(f"      Count: {len(live_versions)}")
        print(f"      Time: {elapsed:.2f}ms")
        
        # Time similarity search
        print("   6b. Computing similarity...")
        similar, elapsed = time_function(
            public_db.find_similar_scenes, 
            target_hash, 
            threshold=13, 
            limit=20
        )
        print(f"      Found: {len(similar)} similar images")
        print(f"      Time: {elapsed:.2f}ms")
        
        # Test N+1 query problem
        if similar:
            print("   6c. Loading scene details for similar images (N+1 problem)...")
            start = time.time()
            for item in similar[:5]:  # Test first 5
                scene = public_db.get_scene(item['scene_id'])
                version = public_db.get_current_version_for_scene(item['scene_id'])
            elapsed = (time.time() - start) * 1000
            print(f"      Time for 5 images: {elapsed:.2f}ms")
            print(f"      Estimated time for {len(similar)} images: {elapsed * len(similar) / 5:.2f}ms")
        print()
    
    # Summary
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print("Potential bottlenecks:")
    print("  - Similarity search loads ALL live versions into memory")
    print("  - N+1 queries: 2 DB queries per similar image")
    print("  - Python-based Hamming distance (not SQL-optimized)")
    print("=" * 70)

if __name__ == "__main__":
    main()


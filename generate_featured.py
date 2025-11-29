"""
Generate initial featured.json with random images
"""
import json
import random
from pathlib import Path
from database import PublicSiteDatabase

def generate_initial_featured(db_path: Path, output_path: Path, count: int = 10):
    """Generate featured.json with random images"""
    db = PublicSiteDatabase(db_path=db_path)

    # Get all scenes
    scenes = db.get_scenes_with_current_versions(limit=10000, offset=0)

    if len(scenes) < count:
        count = len(scenes)

    # Pick random scenes
    selected = random.sample(scenes, count)

    # Extract just the scene IDs
    featured_ids = [scene['scene_id'] for scene in selected]

    # Write to JSON
    with open(output_path, 'w') as f:
        json.dump(featured_ids, f, indent=2)

    print(f"Generated {output_path} with {len(featured_ids)} featured images")
    print(f"Featured scene IDs: {featured_ids}")

if __name__ == "__main__":
    import sys

    db_path = Path("public_site.db")
    if len(sys.argv) > 1:
        db_path = Path(sys.argv[1])

    output_path = Path("featured.json")

    generate_initial_featured(db_path, output_path)

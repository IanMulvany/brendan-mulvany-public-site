"""
Static Site Generator
Generates static HTML files for the photo archive
"""

import os
import json
import shutil
import logging
from pathlib import Path
from datetime import datetime
import argparse
from typing import List, Dict, Optional

# Import database classes
import sys
# Add paths for imports
CURRENT_DIR = Path(__file__).parent
CODE_DIR = CURRENT_DIR.parent / "code"
sys.path.insert(0, str(CODE_DIR))
sys.path.insert(0, str(CURRENT_DIR))

from database import PublicSiteDatabase
from config_manager import ConfigManager
from storage import create_storage_backend
from common import scene_id_to_image_id, hamming_distance, construct_image_urls

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Constants
DIST_DIR = CURRENT_DIR / "dist"
STATIC_DIR = CURRENT_DIR / "static"
TEMPLATES_DIR = CURRENT_DIR / "templates"


def load_all_scenes(db: PublicSiteDatabase, storage_backend) -> List[Dict]:
    """Load all scenes with their current versions"""
    # Fetch scenes and their current versions
    # We use a large limit to get all scenes for static generation
    scene_records = db.get_scenes_with_current_versions(limit=10000, offset=0)
    
    public_images = []
    for record in scene_records:
        scene_id = record['scene_id']
        image_id = scene_id_to_image_id(scene_id)
        local_path = record.get('local_path', '')
        r2_key = record.get('r2_key')
        
        # Use shared URL construction logic
        urls = construct_image_urls(storage_backend, r2_key, image_id, scene_id)
        
        img_dict = {
            'image_id': image_id,
            'image_path': local_path,
            'image_name': record['base_filename'],
            'image_url': urls['image_url'],
            'thumbnail_url': urls['thumbnail_url'],
            'bm_batch_year': '',
            'roll_number': record.get('roll_number', ''),
            'capture_date': record.get('capture_date'),
            'bm_batch_note': record['batch_name'],
            'scene_id': scene_id,
            'perceptual_hash': record.get('perceptual_hash'),
            # Include full metadata for static search index
            'description': record.get('description'),
            'roll_date': record.get('roll_date'),
            'roll_comment': record.get('roll_comment'),
            'short_description': record.get('short_description'),
            'index_book_number': record.get('index_book_number'),
            'index_book_date': record.get('index_book_date'),
            'index_book_comment': record.get('index_book_comment')
        }
        public_images.append(img_dict)
        
    return public_images


def find_similar_scenes(target_scene: Dict, all_scenes: List[Dict], threshold: int = 12) -> List[Dict]:
    """Find similar scenes using perceptual hash (in-memory for static generation)"""
    target_hash = target_scene.get('perceptual_hash')
    if not target_hash:
        return []
        
    similar = []
    for scene in all_scenes:
        if scene['scene_id'] == target_scene['scene_id']:
            continue
            
        scene_hash = scene.get('perceptual_hash')
        if not scene_hash:
            continue
            
        dist = hamming_distance(target_hash, scene_hash)
        if dist <= threshold:
            # Create a copy to avoid modifying the original
            match = scene.copy()
            match['distance'] = dist
            similar.append(match)
            
    # Sort by distance
    similar.sort(key=lambda x: x['distance'])
    return similar[:20]  # Limit to top 20


def generate_static_site(output_dir: Path, db_path: Path, config_path: Path):
    """Generate the static site"""
    logger.info(f"Generating static site to {output_dir}")
    
    # Ensure output directory exists
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)
    
    # Copy static assets
    if STATIC_DIR.exists():
        shutil.copytree(STATIC_DIR, output_dir / "static")
        logger.info("Copied static assets")
    
    # Initialize DB and Config
    db = PublicSiteDatabase(db_path=db_path)
    config_manager = ConfigManager(config_path)
    storage_config = config_manager.get_storage_config()
    storage_backend = create_storage_backend(storage_config)
    
    # Load all scenes
    all_scenes = load_all_scenes(db, storage_backend)
    logger.info(f"Loaded {len(all_scenes)} scenes")
    
    # Load templates
    with open(TEMPLATES_DIR / "index.html", "r") as f:
        index_template = f.read()
    
    with open(TEMPLATES_DIR / "image.html", "r") as f:
        image_template = f.read()
        
    with open(TEMPLATES_DIR / "roll.html", "r") as f:
        roll_template = f.read()
        
    with open(TEMPLATES_DIR / "search.html", "r") as f:
        search_template = f.read()
    
    # Helper for rendering and writing templates
    def render_and_write(template_str: str, data: Dict, output_path: Path, data_var: str = "window.__STATIC_DATA__"):
        """Render template with data and write to file"""
        html = template_str.replace(
            f"{data_var} = null;", 
            f"{data_var} = {json.dumps(data)};"
        )
        with open(output_path, "w") as f:
            f.write(html)

    # Generate Index Page
    # Inject initial data (first 48 images)
    initial_data = all_scenes[:48]
    render_and_write(index_template, initial_data, output_dir / "index.html")
    logger.info("Generated index.html")
    
    # Generate Search Page
    # Inject search index (simplified for now - just all scenes with metadata)
    # For a large site, we'd want a more optimized search index
    search_index = [{
        'id': s['image_id'],
        'sid': s['scene_id'],
        't': f"{s['image_name']} {s.get('description') or ''} {s.get('roll_number') or ''} {s.get('bm_batch_note') or ''}",
        'd': s['capture_date']
    } for s in all_scenes]
    
    render_and_write(search_template, search_index, output_dir / "search.html", "window.__SEARCH_INDEX__")
    logger.info("Generated search.html")
    
    # Generate Image Pages
    images_dir = output_dir / "image"
    images_dir.mkdir(exist_ok=True)
    
    count = 0
    for scene in all_scenes:
        image_id = scene['image_id']
        
        # Find similar scenes
        similar = find_similar_scenes(scene, all_scenes, threshold=config_manager.get_similarity_threshold())
        
        # Inject scene data and similar scenes
        page_data = {
            'image': scene,
            'similar': similar
        }
        
        # Write to image/{image_id}/index.html
        image_page_dir = images_dir / str(image_id)
        image_page_dir.mkdir(exist_ok=True)
        render_and_write(image_template, page_data, image_page_dir / "index.html", "window.__PAGE_DATA__")
            
        count += 1
        if count % 100 == 0:
            logger.info(f"Generated {count} image pages...")
            
    logger.info(f"Generated {count} image pages")
    
    # Generate Roll Pages
    rolls_dir = output_dir / "roll"
    rolls_dir.mkdir(exist_ok=True)
    
    # Group by roll
    rolls = {}
    for scene in all_scenes:
        roll_num = scene.get('roll_number')
        if roll_num:
            if roll_num not in rolls:
                rolls[roll_num] = []
            rolls[roll_num].append(scene)
            
    for roll_num, scenes in rolls.items():
        # Sort by date/filename
        scenes.sort(key=lambda x: x.get('capture_date') or x['image_name'])
        
        roll_data = {
            'roll_number': roll_num,
            'images': scenes,
            'count': len(scenes)
        }
        
        roll_page_dir = rolls_dir / str(roll_num)
        roll_page_dir.mkdir(exist_ok=True)
        render_and_write(roll_template, roll_data, roll_page_dir / "index.html", "window.__PAGE_DATA__")
            
    logger.info(f"Generated {len(rolls)} roll pages")

    # --- Generate Alternative Homepages ---

    # Load new templates
    with open(TEMPLATES_DIR / "index_rolls.html", "r") as f:
        index_rolls_template = f.read()
    with open(TEMPLATES_DIR / "index_years.html", "r") as f:
        index_years_template = f.read()
    with open(TEMPLATES_DIR / "index_themes.html", "r") as f:
        index_themes_template = f.read()
    with open(TEMPLATES_DIR / "index_featured.html", "r") as f:
        index_featured_template = f.read()
    with open(TEMPLATES_DIR / "index_minimal.html", "r") as f:
        index_minimal_template = f.read()

    # 1. Rolls View (Grid of Rolls)
    # We already have 'rolls' dict from above.
    # Prepare data: list of rolls with cover image and count
    rolls_list = []
    for roll_num, scenes in rolls.items():
        # Sort scenes in roll
        scenes.sort(key=lambda x: x.get('capture_date') or x['image_name'])
        rolls_list.append({
            'roll_number': roll_num,
            'count': len(scenes),
            'images': scenes[:1] # Only need cover image
        })
    # Sort rolls by number (descending usually better for recent)
    rolls_list.sort(key=lambda x: str(x['roll_number']), reverse=True)
    
    render_and_write(index_rolls_template, {'rolls': rolls_list}, output_dir / "index_rolls.html")
    logger.info("Generated index_rolls.html")

    # 2. Years View (Timeline)
    # Group by year
    years = {}
    for scene in all_scenes:
        date_str = scene.get('capture_date')
        if date_str:
            try:
                year = date_str[:4] # Assumes YYYY-MM-DD format
                if year.isdigit():
                    if year not in years:
                        years[year] = []
                    years[year].append(scene)
            except:
                pass
    
    # Sort images within years
    for year in years:
        years[year].sort(key=lambda x: x.get('capture_date') or x['image_name'])

    render_and_write(index_years_template, {'years': years}, output_dir / "index_years.html")
    logger.info("Generated index_years.html")

    # 3. Themes View (Collections)
    # Group by bm_batch_note
    themes = {}
    for scene in all_scenes:
        theme = scene.get('bm_batch_note')
        if theme:
            if theme not in themes:
                themes[theme] = []
            themes[theme].append(scene)
    
    render_and_write(index_themes_template, {'themes': themes}, output_dir / "index_themes.html")
    logger.info("Generated index_themes.html")

    # 4. Featured View (Magazine)
    # For now, select images with descriptions, or just random ones
    # Or maybe every 10th image
    featured_images = [s for s in all_scenes if s.get('description') and len(s['description']) > 10]
    if len(featured_images) < 10:
        featured_images = all_scenes[:20] # Fallback
    
    render_and_write(index_featured_template, {'featured': featured_images[:50]}, output_dir / "index_featured.html")
    logger.info("Generated index_featured.html")

    # 5. Minimal View (Discovery)
    # Just a list of all images, maybe shuffled or just all of them
    # For minimal, we might want just images, no text
    import random
    minimal_images = all_scenes.copy()
    random.shuffle(minimal_images)
    
    render_and_write(index_minimal_template, {'minimal': minimal_images[:100]}, output_dir / "index_minimal.html")
    logger.info("Generated index_minimal.html")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate static site")
    parser.add_argument("--output", "-o", default="dist", help="Output directory")
    parser.add_argument("--db", default="public_site.db", help="Path to SQLite database")
    parser.add_argument("--config", default="config.yaml", help="Path to config file")
    
    args = parser.parse_args()
    
    # Use local paths relative to script if not specified
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = CURRENT_DIR / output_path
        
    db_path = Path(args.db)
    if not db_path.is_absolute():
        # Check environment variable first
        env_db = os.getenv("LOCAL_DB_PATH")
        if env_db:
            db_path = Path(env_db)
        else:
            db_path = CURRENT_DIR / db_path
            
    config_path = Path(args.config)
    if not config_path.is_absolute():
        config_path = CURRENT_DIR / config_path
        
    if not db_path.exists():
        logger.error(f"Database not found at {db_path}")
        sys.exit(1)
        
    if not config_path.exists():
        # Try config.local.yaml
        local_config = config_path.parent / "config.local.yaml"
        if local_config.exists():
            config_path = local_config
            logger.info(f"Using local config: {config_path}")
        else:
            logger.error(f"Config not found at {config_path}")
            sys.exit(1)
            
    generate_static_site(output_path, db_path, config_path)

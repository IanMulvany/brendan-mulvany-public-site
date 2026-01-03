"""
Static Site Generator
Generates static HTML files for the photo archive
"""

import os
import json
import re
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
DIST_DIR = CURRENT_DIR / "public"
STATIC_DIR = CURRENT_DIR / "static"
TEMPLATES_DIR = CURRENT_DIR / "templates"

# Build metadata
BUILD_GENERATOR = "build_static.py"
BUILD_VERSION = "1.0"


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
            'small_avif': urls.get('small_avif'),
            'small_webp': urls.get('small_webp'),
            'large_avif': urls.get('large_avif'),
            'large_webp': urls.get('large_webp'),
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


def prepare_rolls_data(all_scenes: List[Dict]) -> Dict:
    """Prepare rolls data for templates"""
    rolls = {}
    for scene in all_scenes:
        roll_num = scene.get('roll_number')
        if roll_num:
            if roll_num not in rolls:
                rolls[roll_num] = []
            rolls[roll_num].append(scene)

    # Sort scenes within each roll
    for roll_num in rolls:
        rolls[roll_num].sort(key=lambda x: x.get('capture_date') or x['image_name'])

    # Prepare rolls list with metadata
    rolls_list = []
    for roll_num, scenes in rolls.items():
        rolls_list.append({
            'roll_number': roll_num,
            'count': len(scenes),
            'images': scenes  # Include all images for individual roll pages
        })

    # Sort rolls by number descending
    rolls_list.sort(key=lambda x: str(x['roll_number']), reverse=True)

    return {'rolls': rolls_list, 'rolls_dict': rolls}


def prepare_years_data(all_scenes: List[Dict]) -> Dict:
    """Prepare years data for templates"""
    years = {}
    for scene in all_scenes:
        date_str = scene.get('capture_date')
        if date_str:
            try:
                year = date_str[:4]  # Assumes YYYY-MM-DD format
                if year.isdigit():
                    if year not in years:
                        years[year] = []
                    years[year].append(scene)
            except:
                pass

    # Sort images within years
    for year in years:
        years[year].sort(key=lambda x: x.get('capture_date') or x['image_name'])

    return {'years': years}


def load_featured_images(all_scenes: List[Dict], featured_json_path: Path) -> List[Dict]:
    """Load featured images from featured.json"""
    featured_images = []

    # Try to load featured.json
    if featured_json_path.exists():
        try:
            with open(featured_json_path, 'r') as f:
                featured_scene_ids = json.load(f)

            # Create a lookup dict for faster searching
            scenes_by_id = {scene['scene_id']: scene for scene in all_scenes}

            # Get the actual scene data for featured IDs
            for scene_id in featured_scene_ids:
                if scene_id in scenes_by_id:
                    featured_images.append(scenes_by_id[scene_id])

            logger.info(f"Loaded {len(featured_images)} featured images from {featured_json_path}")
        except Exception as e:
            logger.warning(f"Could not load featured.json: {e}")
    else:
        logger.warning(f"featured.json not found at {featured_json_path}")

    return featured_images


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

        # Minify JS files
        try:
            import rjsmin
            js_dir = output_dir / "static" / "js"
            if js_dir.exists():
                logger.info("Minifying JS files...")
                for js_file in js_dir.glob("*.js"):
                    with open(js_file, 'r') as f:
                        content = f.read()
                    minified = rjsmin.jsmin(content)
                    with open(js_file, 'w') as f:
                        f.write(minified)
                logger.info("Minified JS files")
        except ImportError:
            logger.warning("rjsmin not installed, skipping JS minification")
        except Exception as e:
            logger.warning(f"Failed to minify JS: {e}")

        logger.info("Copied static assets")

    # Initialize DB and Config
    db = PublicSiteDatabase(db_path=db_path)
    config_manager = ConfigManager(config_path)
    storage_config = config_manager.get_storage_config()
    storage_backend = create_storage_backend(storage_config)

    # Load all scenes
    all_scenes = load_all_scenes(db, storage_backend)
    logger.info(f"Loaded {len(all_scenes)} scenes")

    # Prepare data structures
    rolls_data = prepare_rolls_data(all_scenes)
    years_data = prepare_years_data(all_scenes)
    featured_images = load_featured_images(all_scenes, CURRENT_DIR / "featured.json")

    # Load meta tags if available
    meta_tags_data = {}
    meta_tags_path = CURRENT_DIR / "meta_tags.json"
    if meta_tags_path.exists():
        try:
            with open(meta_tags_path, 'r') as f:
                meta_tags_data = json.load(f)
            logger.info(f"Loaded meta tags for {len(meta_tags_data)} scenes")
        except Exception as e:
            logger.warning(f"Could not load meta_tags.json: {e}")
    else:
        logger.info("meta_tags.json not found, skipping scene-specific meta tags")

    # Load templates
    with open(TEMPLATES_DIR / "image.html", "r") as f:
        image_template = f.read()

    with open(TEMPLATES_DIR / "roll.html", "r") as f:
        roll_template = f.read()

    with open(TEMPLATES_DIR / "year.html", "r") as f:
        year_template = f.read()

    with open(TEMPLATES_DIR / "search.html", "r") as f:
        search_template = f.read()

    with open(TEMPLATES_DIR / "image_detail.html", "r") as f:
        image_detail_template = f.read()

    # Build timestamp for meta tags
    build_timestamp = datetime.now().isoformat()

    def inject_meta_tags(html: str, scene_meta_tags: Optional[str] = None) -> str:
        """Inject generator meta tags and optionally scene-specific meta tags into HTML head"""
        # Extract title from scene meta tags if present
        scene_title = None
        scene_meta_only = None
        if scene_meta_tags:
            # Extract title tag if present
            title_match = re.search(r'<title>(.*?)</title>', scene_meta_tags, re.DOTALL)
            if title_match:
                scene_title = title_match.group(1).strip()
                # Remove title tag from meta tags string
                scene_meta_only = re.sub(r'<title>.*?</title>\s*', '', scene_meta_tags, flags=re.DOTALL).strip()
            else:
                scene_meta_only = scene_meta_tags
        
        # Replace title tag if scene-specific title is available
        if scene_title:
            # Replace existing title tag
            html = re.sub(r'<title>.*?</title>', f'<title>{scene_title}</title>', html, flags=re.DOTALL | re.IGNORECASE)
        
        # Build generator meta tags
        meta_tags = f'''
    <meta name="generator" content="{BUILD_GENERATOR} v{BUILD_VERSION}">
    <meta name="build-date" content="{build_timestamp}">
    <meta name="build-method" content="static-site-generation">'''
        
        # Add scene-specific meta tags (without title) if provided
        if scene_meta_only:
            meta_tags += '\n' + scene_meta_only

        # Insert after <head> tag
        if '<head>' in html:
            html = html.replace('<head>', '<head>' + meta_tags)
        elif '<HEAD>' in html:
            html = html.replace('<HEAD>', '<HEAD>' + meta_tags)
        return html

    # Helper for rendering and writing templates
    def render_and_write(template_str: str, data: Dict, output_path: Path, data_var: str = "window.__STATIC_DATA__", scene_meta_tags: Optional[str] = None):
        """Render template with data and write to file"""
        html = template_str.replace(
            f"{data_var} = null;",
            f"{data_var} = {json.dumps(data)};"
        )
        # Add generator meta tags and optionally scene-specific meta tags
        html = inject_meta_tags(html, scene_meta_tags)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            f.write(html)

    # Helper function to strip unnecessary metadata for preview pages
    def strip_metadata(scene: Dict) -> Dict:
        """Return minimal scene data without description fields"""
        return {
            'image_id': scene['image_id'],
            'image_name': scene['image_name'],
            'image_url': scene['image_url'],
            'thumbnail_url': scene['thumbnail_url'],
            'capture_date': scene.get('capture_date'),
            'roll_number': scene.get('roll_number'),
            'scene_id': scene['scene_id']
        }

    # Generate New Homepage (with rolls and years sections)
    # We'll create this template next
    try:
        with open(TEMPLATES_DIR / "index_new.html", "r") as f:
            index_new_template = f.read()

        # Prepare homepage data with preview of rolls and years (strip metadata to reduce file size)
        homepage_data = {
            'featured': [strip_metadata(img) for img in featured_images],  # Featured images for carousel
            'rolls': [
                {
                    'roll_number': roll['roll_number'],
                    'count': roll['count'],
                    'images': [strip_metadata(img) for img in roll['images']]
                }
                for roll in rolls_data['rolls'][:12]
            ],  # Show first 12 rolls
            'years': {
                k: [strip_metadata(img) for img in v[:6]]
                for k, v in list(years_data['years'].items())[:10]
            }  # Show up to 10 years with 6 images each
        }
        render_and_write(index_new_template, homepage_data, output_dir / "index.html")
        logger.info("Generated index.html")
    except FileNotFoundError:
        logger.warning("index_new.html template not found, skipping homepage generation")

    # Generate /rolls/index.html (listing all rolls)
    try:
        with open(TEMPLATES_DIR / "rolls_index.html", "r") as f:
            rolls_index_template = f.read()

        # Prepare data for rolls page - only need cover image, strip metadata
        rolls_page_data = {
            'rolls': [{
                'roll_number': r['roll_number'],
                'count': r['count'],
                'images': [strip_metadata(img) for img in r['images'][:1]]  # Only cover image, minimal data
            } for r in rolls_data['rolls']]
        }
        render_and_write(rolls_index_template, rolls_page_data, output_dir / "rolls" / "index.html")
        logger.info("Generated /rolls/index.html")
    except FileNotFoundError:
        logger.warning("rolls_index.html template not found, skipping rolls index generation")

    # Generate /years/index.html (listing all years)
    try:
        with open(TEMPLATES_DIR / "years_index.html", "r") as f:
            years_index_template = f.read()

        # Strip metadata from years data to reduce file size
        years_page_data = {
            'years': {
                year: [strip_metadata(img) for img in images[:1]]  # Only cover image per year, minimal data
                for year, images in years_data['years'].items()
            }
        }
        render_and_write(years_index_template, years_page_data, output_dir / "years" / "index.html")
        logger.info("Generated /years/index.html")
    except FileNotFoundError:
        logger.warning("years_index.html template not found, skipping years index generation")

    # Generate /about/index.html
    try:
        with open(TEMPLATES_DIR / "about.html", "r") as f:
            about_template = f.read()

        (output_dir / "about").mkdir(exist_ok=True, parents=True)
        with open(output_dir / "about" / "index.html", "w") as f:
            f.write(inject_meta_tags(about_template))
        logger.info("Generated /about/index.html")
    except FileNotFoundError:
        logger.warning("about.html template not found, skipping about page generation")

    # Generate Search Page (uses FTS5 API, no embedded index needed)
    render_and_write(search_template, {}, output_dir / "search" / "index.html")
    render_and_write(search_template, {}, output_dir / "search.html")
    logger.info("Generated /search/index.html and /search.html")

    # Build batch navigation index: group scenes by batch for prev/next navigation
    # This is used for both /image/ and /image_detail/ pages
    batch_scenes = {}
    for scene in all_scenes:
        batch = scene.get('bm_batch_note') or 'unknown'
        if batch not in batch_scenes:
            batch_scenes[batch] = []
        batch_scenes[batch].append(scene)

    # Sort scenes within each batch by image_name for consistent ordering
    for batch in batch_scenes:
        batch_scenes[batch].sort(key=lambda x: x['image_name'])

    # Create lookup for prev/next within batch
    def get_batch_navigation(scene: Dict) -> Dict:
        """Get prev/next image IDs within the same batch"""
        batch = scene.get('bm_batch_note') or 'unknown'
        scenes_in_batch = batch_scenes.get(batch, [])

        # Find current index
        current_idx = None
        for i, s in enumerate(scenes_in_batch):
            if s['image_id'] == scene['image_id']:
                current_idx = i
                break

        if current_idx is None:
            return {'prev_image_id': None, 'next_image_id': None, 'batch_position': None, 'batch_total': 0}

        prev_id = scenes_in_batch[current_idx - 1]['image_id'] if current_idx > 0 else None
        next_id = scenes_in_batch[current_idx + 1]['image_id'] if current_idx < len(scenes_in_batch) - 1 else None

        return {
            'prev_image_id': prev_id,
            'next_image_id': next_id,
            'batch_position': current_idx + 1,
            'batch_total': len(scenes_in_batch)
        }

    # Generate Image Pages
    images_dir = output_dir / "image"
    images_dir.mkdir(exist_ok=True)

    count = 0
    for scene in all_scenes:
        image_id = scene['image_id']
        scene_id = scene['scene_id']
        
        # Find similar scenes
        similar = find_similar_scenes(scene, all_scenes, threshold=config_manager.get_similarity_threshold())

        # Get batch navigation (prev/next within same batch)
        nav = get_batch_navigation(scene)

        # Inject scene data, navigation, and similar scenes
        page_data = {
            'navigation': nav,
            'image': scene,
            'similar': similar
        }
        
        # Look up meta tags for this scene if available
        scene_meta_tags = None
        if scene_id in meta_tags_data:
            meta_tag_info = meta_tags_data[scene_id]
            if 'html_meta_tags' in meta_tag_info:
                scene_meta_tags = meta_tag_info['html_meta_tags']
        
        # Write to image/{image_id}/index.html
        image_page_dir = images_dir / str(image_id)
        image_page_dir.mkdir(exist_ok=True)
        render_and_write(image_template, page_data, image_page_dir / "index.html", "window.__PAGE_DATA__", scene_meta_tags)
            
        count += 1
        if count % 100 == 0:
            logger.info(f"Generated {count} image pages...")

    logger.info(f"Generated {count} image pages")

    # Generate Image Detail Pages (technical view with all versions)
    image_details_dir = output_dir / "image_detail"
    image_details_dir.mkdir(exist_ok=True)

    count = 0
    for scene in all_scenes:
        image_id = scene['image_id']
        scene_id = scene['scene_id']

        # Get all versions for this scene
        all_versions = db.get_all_versions_for_scene(scene_id)

        # Find current version
        current_version = None
        for v in all_versions:
            if v.get('is_current'):
                current_version = v
                break

        # Find similar scenes (reuse from above logic)
        similar = find_similar_scenes(scene, all_scenes, threshold=config_manager.get_similarity_threshold())

        # Get batch navigation (prev/next within same batch)
        nav = get_batch_navigation(scene)

        # Build page data with full detail including versions
        page_data = {
            'navigation': nav,
            'image': {
                'image_id': image_id,
                'image_name': scene['image_name'],
                'image_url': scene['image_url'],
                'thumbnail_url': scene['thumbnail_url'],
                'bm_batch_note': scene.get('bm_batch_note', ''),
                'capture_date': scene.get('capture_date'),
                'scene_id': scene_id,
                'batch_name': scene.get('bm_batch_note', ''),
                'base_filename': scene['image_name'],
                'description': scene.get('description'),
                'description_model': scene.get('description_model'),
                'description_timestamp': scene.get('description_timestamp'),
                'roll_number': scene.get('roll_number'),
                'roll_date': scene.get('roll_date'),
                'roll_comment': scene.get('roll_comment'),
                'index_book_number': scene.get('index_book_number'),
                'index_book_date': scene.get('index_book_date'),
                'index_book_comment': scene.get('index_book_comment'),
                'short_description': scene.get('short_description'),
                'current_version': current_version,
                'all_versions': all_versions
            },
            'similar': similar
        }

        # Write to image_detail/{image_id}/index.html
        detail_page_dir = image_details_dir / str(image_id)
        detail_page_dir.mkdir(exist_ok=True)
        render_and_write(image_detail_template, page_data, detail_page_dir / "index.html", "window.__PAGE_DATA__")

        count += 1
        if count % 100 == 0:
            logger.info(f"Generated {count} image detail pages...")

    logger.info(f"Generated {count} image detail pages")

    # Generate Individual Roll Pages
    rolls_dir = output_dir / "roll"
    rolls_dir.mkdir(exist_ok=True)

    for roll in rolls_data['rolls']:
        roll_num = roll['roll_number']
        scenes = roll['images']

        roll_data = {
            'roll_number': roll_num,
            'images': scenes,
            'count': len(scenes)
        }

        roll_page_dir = rolls_dir / str(roll_num)
        roll_page_dir.mkdir(exist_ok=True)
        render_and_write(roll_template, roll_data, roll_page_dir / "index.html", "window.__PAGE_DATA__")

    logger.info(f"Generated {len(rolls_data['rolls'])} roll pages")

    # Generate Individual Year Pages
    years_dir = output_dir / "year"
    years_dir.mkdir(exist_ok=True)

    for year, scenes in years_data['years'].items():
        year_data = {
            'year': year,
            'images': scenes,
            'count': len(scenes)
        }

        year_page_dir = years_dir / str(year)
        year_page_dir.mkdir(exist_ok=True)
        render_and_write(year_template, year_data, year_page_dir / "index.html", "window.__PAGE_DATA__")

    logger.info(f"Generated {len(years_data['years'])} year pages")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate static site")
    parser.add_argument("--output", "-o", default="public", help="Output directory")
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

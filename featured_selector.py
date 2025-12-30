"""
Featured Image Selector - Mini Flask App
Run with: python3 featured_selector.py
Then open: http://localhost:5555
"""
from flask import Flask, render_template_string, jsonify, request
from pathlib import Path
import json
from database import PublicSiteDatabase
from config_manager import ConfigManager
from storage import create_storage_backend
from common import scene_id_to_image_id, construct_image_urls

app = Flask(__name__)

DB_PATH = Path("public_site.db")
CONFIG_PATH = Path("config.local.yaml")
FEATURED_JSON = Path("featured.json")

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>Featured Image Selector</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f5f5f5;
            padding: 20px;
        }
        .header {
            background: white;
            padding: 20px;
            margin-bottom: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            font-size: 24px;
            margin-bottom: 10px;
        }
        .stats {
            color: #666;
            font-size: 14px;
        }
        .featured-count {
            color: #3498db;
            font-weight: 600;
        }
        .controls {
            background: white;
            padding: 15px 20px;
            margin-bottom: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            display: flex;
            gap: 10px;
            align-items: center;
        }
        .btn {
            padding: 8px 16px;
            background: #3498db;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .btn:hover {
            background: #2980b9;
        }
        .btn-danger {
            background: #e74c3c;
        }
        .btn-danger:hover {
            background: #c0392b;
        }
        .gallery {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 15px;
        }
        .image-card {
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            position: relative;
        }
        .image-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        .image-card.featured {
            border: 3px solid #3498db;
        }
        .image-card.featured::before {
            content: '★ FEATURED';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            background: #3498db;
            color: white;
            padding: 4px 8px;
            font-size: 12px;
            font-weight: 600;
            text-align: center;
            z-index: 10;
        }
        .image-card img {
            width: 100%;
            height: 200px;
            object-fit: cover;
            display: block;
        }
        .image-info {
            padding: 10px;
        }
        .image-name {
            font-size: 12px;
            color: #333;
            font-weight: 500;
            margin-bottom: 4px;
        }
        .image-date {
            font-size: 11px;
            color: #666;
        }
        .loading {
            text-align: center;
            padding: 40px;
            color: #666;
        }
        .filter-toggle {
            margin-left: auto;
            display: flex;
            gap: 10px;
        }
        .filter-toggle label {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Featured Image Selector</h1>
        <div class="stats">
            Total Images: <span id="total-count">0</span> |
            <span class="featured-count">Featured: <span id="featured-count">0</span></span>
        </div>
    </div>

    <div class="controls">
        <button class="btn" onclick="saveFeatures()">💾 Save Featured</button>
        <button class="btn btn-danger" onclick="clearAll()">Clear All</button>
        <div class="filter-toggle">
            <label>
                <input type="checkbox" id="show-featured-only" onchange="filterGallery()">
                Show Featured Only
            </label>
        </div>
    </div>

    <div class="gallery" id="gallery">
        <div class="loading">Loading images...</div>
    </div>

    <script>
        let allImages = [];
        let featuredSet = new Set();

        async function loadData() {
            try {
                const response = await fetch('/api/images');
                const data = await response.json();
                allImages = data.images;
                featuredSet = new Set(data.featured);
                renderGallery();
                updateStats();
            } catch (error) {
                console.error('Error loading data:', error);
                document.getElementById('gallery').innerHTML =
                    '<div class="loading">Error loading images</div>';
            }
        }

        function renderGallery() {
            const gallery = document.getElementById('gallery');
            const showFeaturedOnly = document.getElementById('show-featured-only').checked;

            const imagesToShow = showFeaturedOnly
                ? allImages.filter(img => featuredSet.has(img.scene_id))
                : allImages;

            if (imagesToShow.length === 0) {
                gallery.innerHTML = '<div class="loading">No images to display</div>';
                return;
            }

            gallery.innerHTML = imagesToShow.map(img => {
                const isFeatured = featuredSet.has(img.scene_id);
                return `
                    <div class="image-card ${isFeatured ? 'featured' : ''}"
                         onclick="toggleFeatured('${img.scene_id}')"
                         data-scene-id="${img.scene_id}">
                        <img src="${img.thumbnail_url}" alt="${img.image_name}" loading="lazy">
                        <div class="image-info">
                            <div class="image-name">${img.image_name}</div>
                            <div class="image-date">${img.capture_date || 'No date'}</div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function toggleFeatured(sceneId) {
            if (featuredSet.has(sceneId)) {
                featuredSet.delete(sceneId);
            } else {
                featuredSet.add(sceneId);
            }
            renderGallery();
            updateStats();
        }

        function updateStats() {
            document.getElementById('total-count').textContent = allImages.length;
            document.getElementById('featured-count').textContent = featuredSet.size;
        }

        function filterGallery() {
            renderGallery();
        }

        async function saveFeatures() {
            try {
                const response = await fetch('/api/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ featured: Array.from(featuredSet) })
                });
                const result = await response.json();
                if (result.success) {
                    alert(`✅ Saved ${featuredSet.size} featured images to featured.json`);
                } else {
                    alert('❌ Error saving: ' + result.error);
                }
            } catch (error) {
                alert('❌ Error saving: ' + error.message);
            }
        }

        function clearAll() {
            if (confirm('Clear all featured selections?')) {
                featuredSet.clear();
                renderGallery();
                updateStats();
            }
        }

        // Load on page load
        loadData();
    </script>
</body>
</html>
"""

@app.route('/')
def index():
    return render_template_string(HTML_TEMPLATE)

@app.route('/api/images')
def get_images():
    """Get all images and current featured list"""
    db = PublicSiteDatabase(db_path=DB_PATH)
    config_manager = ConfigManager(CONFIG_PATH)
    storage_config = config_manager.get_storage_config()
    storage_backend = create_storage_backend(storage_config)

    # Load all scenes
    scenes = db.get_scenes_with_current_versions(limit=10000, offset=0)

    # Convert to simpler format
    images = []
    for scene in scenes:
        scene_id = scene['scene_id']
        image_id = scene_id_to_image_id(scene_id)
        urls = construct_image_urls(storage_backend, scene.get('r2_key'), image_id, scene_id)

        images.append({
            'scene_id': scene_id,
            'image_id': image_id,
            'image_name': scene['base_filename'],
            'thumbnail_url': urls['thumbnail_url'],
            'image_url': urls['image_url'],
            'capture_date': scene.get('capture_date')
        })

    # Load current featured list
    featured = []
    if FEATURED_JSON.exists():
        with open(FEATURED_JSON, 'r') as f:
            featured = json.load(f)

    return jsonify({
        'images': images,
        'featured': featured
    })

@app.route('/api/save', methods=['POST'])
def save_featured():
    """Save featured list to JSON"""
    try:
        data = request.json
        featured = data.get('featured', [])

        with open(FEATURED_JSON, 'w') as f:
            json.dump(featured, f, indent=2)

        return jsonify({'success': True, 'count': len(featured)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

if __name__ == '__main__':
    print("=" * 60)
    print("Featured Image Selector")
    print("=" * 60)
    print(f"Database: {DB_PATH}")
    print(f"Config: {CONFIG_PATH}")
    print(f"Featured JSON: {FEATURED_JSON}")
    print("\nOpen in browser: http://localhost:5555")
    print("Press Ctrl+C to stop")
    print("=" * 60)
    app.run(debug=True, port=5555)

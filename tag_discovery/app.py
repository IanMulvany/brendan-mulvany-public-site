import argparse
import logging
import os
import sys
from pathlib import Path

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
import uvicorn

from config_manager import ConfigManager
from common import construct_image_urls
from .curated import CuratedTagsManager
from .engine import TagDiscoveryEngine
from .settings import CURATED_TAGS_PATH, DB_PATH
from .templates import BASE_TEMPLATE
from storage import create_storage_backend


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


def resolve_config_path() -> Path:
    if os.getenv("VERCEL"):
        config_path = os.getenv("CONFIG_PATH")
        if config_path:
            return Path(config_path)
        return Path(__file__).resolve().parent / "config.yaml"
    current_dir = Path(__file__).resolve().parent.parent
    config_path = current_dir / "config.local.yaml"
    if not config_path.exists():
        config_path = current_dir / "config.yaml"
    return config_path


def get_image_url(storage_backend, r2_key: str, scene_id: str) -> str:
    """Generate CDN URL for an image or thumbnail."""
    if not r2_key:
        return ""
    urls = construct_image_urls(storage_backend, r2_key, image_id=0, scene_id=scene_id)
    return urls.get("thumbnail_url") or urls.get("image_url") or ""


def _ensure_state(app: FastAPI):
    if getattr(app.state, "engine", None) is None:
        app.state.engine = TagDiscoveryEngine(app.state.db_path)
    if getattr(app.state, "tags_manager", None) is None:
        app.state.tags_manager = CuratedTagsManager()
    if getattr(app.state, "storage_backend", None) is None:
        if os.getenv("VERCEL") and os.getenv("CONFIG_JSON"):
            import json

            config_manager = ConfigManager.from_dict(json.loads(os.getenv("CONFIG_JSON")))
        else:
            config_manager = ConfigManager(resolve_config_path())
        storage_config = config_manager.get_storage_config()
        try:
            app.state.storage_backend = create_storage_backend(storage_config)
        except Exception:
            app.state.storage_backend = None
    if not hasattr(app.state, "cached_discovery"):
        app.state.cached_discovery = None


def create_app(db_path: Path = DB_PATH) -> FastAPI:
    app = FastAPI(title="Tag Discovery Tool")
    app.state.db_path = Path(db_path)
    app.state.engine = None
    app.state.tags_manager = None
    app.state.cached_discovery = None

    @app.on_event("startup")
    def startup():
        _ensure_state(app)

    @app.get("/", response_class=HTMLResponse)
    async def discover_page(request: Request, category: str = "all", min_count: int = 3):
        """Main discovery page."""
        state = request.app.state
        _ensure_state(request.app)
        allowed_categories = {"all", "themes", "people", "places"}
        if category not in allowed_categories:
            category = "all"

        if state.cached_discovery is None:
            state.cached_discovery = state.engine.discover_all()

        results = state.cached_discovery

        # Build filter options
        filter_html = f"""
        <div class="filter-bar">
            <label>Category:</label>
            <select onchange="window.location.href='/?category='+this.value+'&min_count={min_count}'">
                <option value="all" {"selected" if category == "all" else ""}>All</option>
                <option value="themes" {"selected" if category == "themes" else ""}>Themes</option>
                <option value="people" {"selected" if category == "people" else ""}>People</option>
                <option value="places" {"selected" if category == "places" else ""}>Places</option>
            </select>
            <label>Min Images:</label>
            <select onchange="window.location.href='/?category={category}&min_count='+this.value">
                <option value="2" {"selected" if min_count == 2 else ""}>2+</option>
                <option value="3" {"selected" if min_count == 3 else ""}>3+</option>
                <option value="5" {"selected" if min_count == 5 else ""}>5+</option>
                <option value="10" {"selected" if min_count == 10 else ""}>10+</option>
            </select>
            <a href="/refresh" class="btn btn-secondary refresh-btn">Refresh Analysis</a>
        </div>
        """

        # Build cards for each category
        sections_html = ""

        categories_to_show = ["themes", "people", "places"] if category == "all" else [category]

        for cat in categories_to_show:
            candidates = results.get(cat, [])
            candidates = [c for c in candidates if c.count >= min_count]

            if not candidates:
                continue

            cards_html = ""
            for c in candidates[:50]:  # Limit to 50 per category
                thumbs = ""
                for scene_id in c.sample_scene_ids[:3]:
                    scenes = state.engine.get_scenes_for_term(c.term, limit=1)
                    if scenes and scenes[0].get("r2_key"):
                        url = get_image_url(
                            state.storage_backend, scenes[0]["r2_key"], scenes[0]["scene_id"]
                        )
                        if url:
                            thumbs += f'<img src="{url}" alt="" loading="lazy">'

                cards_html += f"""
                <div class="card">
                    <span class="category category-{c.category}">{c.category.replace('entity_', '')}</span>
                    <h3><a href="/term/{c.term}">{c.term}</a></h3>
                    <div class="count">{c.count} images</div>
                    <div class="thumbnails">{thumbs}</div>
                    <div style="margin-top: 10px;">
                        <button class="btn btn-primary" onclick="openAddModal('{c.term}', '{c.category}')">+ Add as Tag</button>
                    </div>
                </div>
                """

            sections_html += f"""
            <div class="section">
                <h2>{cat.title()} ({len(candidates)} found)</h2>
                <div class="grid">{cards_html}</div>
            </div>
            """

        if not sections_html:
            sections_html = (
                '<div class="empty">No candidates found. Try lowering the minimum count filter.</div>'
            )

        # Stats
        total_scenes = state.engine.get_scene_count()
        total_with_desc = len(state.engine.get_all_descriptions())

        stats_html = f"""
        <div class="stats">
            <div class="stat"><div class="stat-value">{total_scenes}</div><div class="stat-label">Total Images</div></div>
            <div class="stat"><div class="stat-value">{total_with_desc}</div><div class="stat-label">With Descriptions</div></div>
            <div class="stat"><div class="stat-value">{len(results.get('themes', []))}</div><div class="stat-label">Theme Candidates</div></div>
            <div class="stat"><div class="stat-value">{len(results.get('people', []))}</div><div class="stat-label">People Found</div></div>
            <div class="stat"><div class="stat-value">{len(results.get('places', []))}</div><div class="stat-label">Places Found</div></div>
        </div>
        """

        modal_html = """
        <div id="addModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Add Curated Tag</h3>
                    <span class="modal-close" onclick="closeModal()">&times;</span>
                </div>
                <form action="/curated/add" method="post">
                    <div class="form-group">
                        <label>Tag Name (slug)</label>
                        <input type="text" name="name" id="modal-name" required pattern="[a-z0-9-]+">
                    </div>
                    <div class="form-group">
                        <label>Display Name</label>
                        <input type="text" name="display_name" id="modal-display" required>
                    </div>
                    <div class="form-group">
                        <label>Category</label>
                        <select name="category" id="modal-category">
                            <option value="event">Event</option>
                            <option value="setting">Setting</option>
                            <option value="people">People</option>
                            <option value="activity">Activity</option>
                            <option value="time_period">Time Period</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Keywords (comma-separated)</label>
                        <input type="text" name="keywords" id="modal-keywords" placeholder="wedding, ceremony, bride">
                    </div>
                    <button type="submit" class="btn btn-primary">Add Tag</button>
                </form>
            </div>
        </div>
        """

        scripts = """
        <script>
            function openAddModal(term, category) {
                document.getElementById('modal-name').value = term.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                document.getElementById('modal-display').value = term;
                document.getElementById('modal-keywords').value = term;
                // Map category
                const catMap = {
                    'theme': 'activity',
                    'entity_person': 'people',
                    'entity_place': 'setting',
                    'entity_date': 'time_period',
                    'entity_org': 'other'
                };
                document.getElementById('modal-category').value = catMap[category] || 'other';
                document.getElementById('addModal').classList.add('active');
            }
            function closeModal() {
                document.getElementById('addModal').classList.remove('active');
            }
            document.getElementById('addModal').addEventListener('click', function(e) {
                if (e.target === this) closeModal();
            });
        </script>
        """

        content = f"<h1>Tag Discovery</h1>{stats_html}{filter_html}{sections_html}{modal_html}"

        return BASE_TEMPLATE.format(
            title="Discover",
            nav_discover="active",
            nav_curated="",
            nav_stats="",
            content=content,
            scripts=scripts,
        )

    @app.get("/term/{term}", response_class=HTMLResponse)
    async def term_detail(request: Request, term: str):
        """Show all images for a specific term."""
        state = request.app.state
        _ensure_state(request.app)
        scenes = state.engine.get_scenes_for_term(term, limit=100)

        images_html = ""
        for scene in scenes:
            url = get_image_url(state.storage_backend, scene.get("r2_key", ""), scene["scene_id"])
            short_desc = (scene.get("short_description") or "")[:100]
            images_html += f"""
            <div class="image-card">
                <img src="{url}" alt="" loading="lazy">
                <div class="info">
                    <strong>{scene['scene_id'][:30]}...</strong><br>
                    {short_desc}
                </div>
            </div>
            """

        content = f"""
        <h1>Images containing "{term}"</h1>
        <p>{len(scenes)} images found</p>
        <div style="margin-bottom: 20px;">
            <button class="btn btn-primary" onclick="openAddModal('{term}', 'theme')">+ Add as Curated Tag</button>
            <a href="/" class="btn btn-secondary">Back to Discovery</a>
        </div>
        <div class="images-grid">{images_html}</div>
        """

        modal_html = """
        <div id="addModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Add Curated Tag</h3>
                    <span class="modal-close" onclick="closeModal()">&times;</span>
                </div>
                <form action="/curated/add" method="post">
                    <div class="form-group">
                        <label>Tag Name (slug)</label>
                        <input type="text" name="name" id="modal-name" required pattern="[a-z0-9-]+">
                    </div>
                    <div class="form-group">
                        <label>Display Name</label>
                        <input type="text" name="display_name" id="modal-display" required>
                    </div>
                    <div class="form-group">
                        <label>Category</label>
                        <select name="category" id="modal-category">
                            <option value="event">Event</option>
                            <option value="setting">Setting</option>
                            <option value="people">People</option>
                            <option value="activity">Activity</option>
                            <option value="time_period">Time Period</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Keywords (comma-separated)</label>
                        <input type="text" name="keywords" id="modal-keywords">
                    </div>
                    <button type="submit" class="btn btn-primary">Add Tag</button>
                </form>
            </div>
        </div>
        """

        scripts = f"""
        <script>
            function openAddModal(term, category) {{
                document.getElementById('modal-name').value = term.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                document.getElementById('modal-display').value = term;
                document.getElementById('modal-keywords').value = term;
                document.getElementById('addModal').classList.add('active');
            }}
            function closeModal() {{
                document.getElementById('addModal').classList.remove('active');
            }}
        </script>
        """

        return BASE_TEMPLATE.format(
            title=f"Term: {term}",
            nav_discover="active",
            nav_curated="",
            nav_stats="",
            content=content + modal_html,
            scripts=scripts,
        )

    @app.get("/curated", response_class=HTMLResponse)
    async def curated_page(request: Request):
        """Show curated tags."""
        state = request.app.state
        _ensure_state(request.app)
        tags = state.tags_manager.get_tags()
        categories = state.tags_manager.get_categories()

        # Group by category
        by_category = {}
        for tag in tags:
            by_category.setdefault(tag.category, []).append(tag)

        sections_html = ""
        for cat in categories:
            cat_tags = by_category.get(cat, [])
            if not cat_tags:
                continue

            tags_html = ""
            for tag in cat_tags:
                keywords = ", ".join(tag.keywords[:3])
                if len(tag.keywords) > 3:
                    keywords += f" +{len(tag.keywords)-3} more"
                tags_html += f"""
                <div class="tag">
                    <span class="category category-{cat}">{cat}</span>
                    <strong>{tag.display_name}</strong>
                    <span style="color: #999; font-size: 12px;">({keywords})</span>
                    <form action="/curated/remove" method="post" style="display:inline;">
                        <input type="hidden" name="name" value="{tag.name}">
                        <button type="submit" class="remove" title="Remove">&times;</button>
                    </form>
                </div>
                """

            sections_html += f"""
            <div class="section">
                <h2>{cat.replace('_', ' ').title()} ({len(cat_tags)})</h2>
                <div class="tag-list">{tags_html}</div>
            </div>
            """

        if not tags:
            sections_html = (
                '<div class="empty">No curated tags yet. Go to Discover to add some!</div>'
            )

        # Add form
        form_html = f"""
        <div class="card" style="margin-bottom: 30px; max-width: 600px;">
            <h3>Add New Tag Manually</h3>
            <form action="/curated/add" method="post">
                <div class="form-group">
                    <label>Tag Name (slug)</label>
                    <input type="text" name="name" required pattern="[a-z0-9-]+" placeholder="wedding-ceremony">
                </div>
                <div class="form-group">
                    <label>Display Name</label>
                    <input type="text" name="display_name" required placeholder="Wedding Ceremony">
                </div>
                <div class="form-group">
                    <label>Category</label>
                    <select name="category">
                        {"".join(f'<option value="{c}">{c.replace("_", " ").title()}</option>' for c in categories)}
                    </select>
                </div>
                <div class="form-group">
                    <label>Keywords (comma-separated terms that map to this tag)</label>
                    <input type="text" name="keywords" placeholder="wedding, ceremony, bride, groom, marriage">
                </div>
                <button type="submit" class="btn btn-primary">Add Tag</button>
            </form>
        </div>
        """

        content = f"""
        <h1>Curated Tags ({len(tags)} total)</h1>
        <p>These are the approved tags that will be used for image navigation.</p>
        {form_html}
        {sections_html}
        """

        return BASE_TEMPLATE.format(
            title="Curated Tags",
            nav_discover="",
            nav_curated="active",
            nav_stats="",
            content=content,
            scripts="",
        )

    @app.post("/curated/add")
    async def add_curated_tag(
        request: Request,
        name: str = Form(...),
        display_name: str = Form(...),
        category: str = Form(...),
        keywords: str = Form(""),
    ):
        """Add a new curated tag."""
        state = request.app.state
        _ensure_state(request.app)
        keyword_list = [k.strip() for k in keywords.split(",") if k.strip()]
        if not keyword_list:
            keyword_list = [display_name.lower()]

        state.tags_manager.add_tag(name, display_name, category, keyword_list)
        return RedirectResponse(url="/curated", status_code=303)

    @app.post("/curated/remove")
    async def remove_curated_tag(request: Request, name: str = Form(...)):
        """Remove a curated tag."""
        state = request.app.state
        _ensure_state(request.app)
        state.tags_manager.remove_tag(name)
        return RedirectResponse(url="/curated", status_code=303)

    @app.get("/stats", response_class=HTMLResponse)
    async def stats_page(request: Request):
        """Show coverage statistics for curated tags."""
        state = request.app.state
        _ensure_state(request.app)
        tags = state.tags_manager.get_tags()

        if not tags:
            content = """
            <h1>Coverage Stats</h1>
            <div class="empty">No curated tags yet. Add some tags first to see coverage stats.</div>
            """
            return BASE_TEMPLATE.format(
                title="Stats",
                nav_discover="",
                nav_curated="",
                nav_stats="active",
                content=content,
                scripts="",
            )

        # Calculate coverage for each tag
        total_scenes = state.engine.get_scene_count()
        all_covered = set()

        tag_stats = []
        for tag in tags:
            covered_scenes = set()
            for keyword in tag.keywords:
                scenes = state.engine.get_scenes_for_term(keyword, limit=500)
                covered_scenes.update(s["scene_id"] for s in scenes)

            all_covered.update(covered_scenes)
            tag_stats.append(
                {
                    "tag": tag,
                    "count": len(covered_scenes),
                    "percentage": round(len(covered_scenes) / total_scenes * 100, 1)
                    if total_scenes > 0
                    else 0,
                }
            )

        # Sort by count
        tag_stats.sort(key=lambda x: x["count"], reverse=True)

        overall_coverage = (
            round(len(all_covered) / total_scenes * 100, 1) if total_scenes > 0 else 0
        )

        stats_html = f"""
        <div class="stats">
            <div class="stat"><div class="stat-value">{total_scenes}</div><div class="stat-label">Total Images</div></div>
            <div class="stat"><div class="stat-value">{len(all_covered)}</div><div class="stat-label">Tagged Images</div></div>
            <div class="stat"><div class="stat-value">{overall_coverage}%</div><div class="stat-label">Coverage</div></div>
            <div class="stat"><div class="stat-value">{len(tags)}</div><div class="stat-label">Curated Tags</div></div>
        </div>
        """

        table_rows = ""
        for ts in tag_stats:
            bar_width = min(ts["percentage"] * 2, 100)
            table_rows += f"""
            <tr>
                <td><span class="category category-{ts['tag'].category}">{ts['tag'].category}</span></td>
                <td><strong>{ts['tag'].display_name}</strong></td>
                <td>{", ".join(ts['tag'].keywords[:3])}{"..." if len(ts['tag'].keywords) > 3 else ""}</td>
                <td>{ts['count']}</td>
                <td>
                    <div style="background: #e0e0e0; border-radius: 4px; overflow: hidden; width: 100px;">
                        <div style="background: #4CAF50; height: 20px; width: {bar_width}%;"></div>
                    </div>
                </td>
                <td>{ts['percentage']}%</td>
            </tr>
            """

        table_html = f"""
        <table style="width: 100%; background: white; border-collapse: collapse; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <thead style="background: #f5f5f5;">
                <tr>
                    <th style="padding: 12px; text-align: left;">Category</th>
                    <th style="padding: 12px; text-align: left;">Tag</th>
                    <th style="padding: 12px; text-align: left;">Keywords</th>
                    <th style="padding: 12px; text-align: left;">Images</th>
                    <th style="padding: 12px; text-align: left;">Coverage</th>
                    <th style="padding: 12px; text-align: left;">%</th>
                </tr>
            </thead>
            <tbody>
                {table_rows}
            </tbody>
        </table>
        """

        content = f"""
        <h1>Coverage Stats</h1>
        <p>How well do curated tags cover the image corpus?</p>
        {stats_html}
        <h2>Tag Coverage Breakdown</h2>
        {table_html}
        """

        return BASE_TEMPLATE.format(
            title="Stats",
            nav_discover="",
            nav_curated="",
            nav_stats="active",
            content=content,
            scripts="",
        )

    @app.get("/refresh")
    async def refresh_analysis(request: Request):
        """Re-run the discovery analysis."""
        state = request.app.state
        _ensure_state(request.app)
        state.cached_discovery = None
        state.cached_discovery = state.engine.discover_all()
        return RedirectResponse(url="/", status_code=303)

    @app.get("/api/tags", response_class=JSONResponse)
    async def api_get_tags(request: Request):
        """API endpoint to get curated tags as JSON."""
        state = request.app.state
        _ensure_state(request.app)
        data = state.tags_manager.load()
        return data

    return app


app = create_app()


def main():
    parser = argparse.ArgumentParser(description="Tag Discovery Tool")
    parser.add_argument("--port", type=int, default=8765, help="Port to run on (default: 8765)")
    parser.add_argument("--db", type=str, default=str(DB_PATH), help="Path to database")
    args = parser.parse_args()

    app = create_app(Path(args.db))

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)

    print(f"\n{'=' * 60}", flush=True)
    print("  Tag Discovery Tool", flush=True)
    print(f"{'=' * 60}", flush=True)
    print(f"  Open in browser: http://localhost:{args.port}", flush=True)
    print(f"  Database: {args.db}", flush=True)
    print(f"  Curated tags: {CURATED_TAGS_PATH}", flush=True)
    print(f"{'=' * 60}\n", flush=True)

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")

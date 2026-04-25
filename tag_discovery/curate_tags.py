#!/usr/bin/env python3
"""
Tag Curation Web App - Review and manage tag suggestions.

This web app allows you to:
- View pending tag suggestions
- Accept suggestions (adds them to curated tags)
- Discard suggestions
- Merge multiple suggestions into one tag

Usage:
    uv run python -m tag_discovery.curate_tags [--port 8765]
"""

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
from .suggestions import TagSuggestionsManager
from .engine import TagDiscoveryEngine
from .settings import DB_PATH, TAG_SUGGESTIONS_PATH
from .templates import BASE_TEMPLATE
from storage import create_storage_backend


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


def resolve_config_path() -> Path:
    if os.getenv("VERCEL"):
        config_path = os.getenv("CONFIG_PATH")
        if config_path:
            return Path(config_path)
        return Path(__file__).resolve().parent.parent / "config.yaml"
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
    if getattr(app.state, "suggestions_manager", None) is None:
        app.state.suggestions_manager = TagSuggestionsManager()
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


def create_app(db_path: Path = DB_PATH) -> FastAPI:
    app = FastAPI(title="Tag Curation Tool")
    app.state.db_path = Path(db_path)
    app.state.engine = None
    app.state.tags_manager = None
    app.state.suggestions_manager = None

    @app.on_event("startup")
    def startup():
        _ensure_state(app)

    @app.get("/", response_class=HTMLResponse)
    async def curation_page(request: Request, category: str = "all", min_count: int = 3):
        """Main curation page showing pending tag suggestions."""
        state = request.app.state
        _ensure_state(request.app)

        allowed_categories = {"all", "themes", "people", "places"}
        if category not in allowed_categories:
            category = "all"

        # Get pending suggestions
        all_suggestions = state.suggestions_manager.get_suggestions(status="pending")

        # Filter by category
        category_map = {
            "themes": "theme",
            "people": "entity_person",
            "places": "entity_place",
        }

        if category == "all":
            filtered = all_suggestions
        else:
            target_category = category_map.get(category, category)
            filtered = [s for s in all_suggestions if s.category == target_category]

        # Filter by min_count
        filtered = [s for s in filtered if s.count >= min_count]

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
        </div>
        """

        # Build cards for suggestions
        cards_html = ""
        for suggestion in filtered[:100]:  # Limit to 100
            thumbs = ""
            for scene_id in suggestion.sample_scene_ids[:3]:
                scenes = state.engine.get_scenes_for_term(suggestion.term, limit=1)
                if scenes and scenes[0].get("r2_key"):
                    url = get_image_url(
                        state.storage_backend, scenes[0]["r2_key"], scenes[0]["scene_id"]
                    )
                    if url:
                        thumbs += f'<img src="{url}" alt="" loading="lazy">'

            category_display = suggestion.category.replace("entity_", "").replace("_", " ")
            cards_html += f"""
            <div class="card suggestion-card" data-term="{suggestion.term}">
                <span class="category category-{suggestion.category}">{category_display}</span>
                <h3>{suggestion.term}</h3>
                <div class="count">{suggestion.count} images</div>
                <div class="thumbnails">{thumbs}</div>
                <div class="suggestion-actions" style="margin-top: 10px; display: flex; gap: 8px;">
                    <button class="btn btn-primary" onclick="openAcceptModal('{suggestion.term}', '{suggestion.category}')">Accept</button>
                    <button class="btn btn-danger" onclick="discardSuggestion('{suggestion.term}')">Discard</button>
                    <button class="btn btn-secondary" onclick="selectForMerge('{suggestion.term}')">Select for Merge</button>
                </div>
            </div>
            """

        if not cards_html:
            cards_html = '<div class="empty">No pending suggestions found. Run the tag generation script to create suggestions.</div>'

        # Stats
        total_pending = len(all_suggestions)
        by_category = {}
        for s in all_suggestions:
            cat = s.category.replace("entity_", "").replace("_", " ")
            by_category.setdefault(cat, 0)
            by_category[cat] += 1

        stats_html = f"""
        <div class="stats">
            <div class="stat"><div class="stat-value">{total_pending}</div><div class="stat-label">Pending Suggestions</div></div>
            <div class="stat"><div class="stat-value">{by_category.get('theme', 0)}</div><div class="stat-label">Themes</div></div>
            <div class="stat"><div class="stat-value">{by_category.get('person', 0)}</div><div class="stat-label">People</div></div>
            <div class="stat"><div class="stat-value">{by_category.get('place', 0)}</div><div class="stat-label">Places</div></div>
        </div>
        """

        # Merge interface
        merge_html = """
        <div id="mergePanel" class="merge-panel" style="display: none;">
            <h3>Merge Selected Suggestions</h3>
            <div id="selectedTerms" class="selected-terms"></div>
            <form action="/merge" method="post" id="mergeForm">
                <div class="form-group">
                    <label>Target Tag Name (slug)</label>
                    <input type="text" name="target_term" id="target-term" required pattern="[a-z0-9-]+">
                </div>
                <div class="form-group">
                    <label>Display Name</label>
                    <input type="text" name="display_name" id="merge-display" required>
                </div>
                <div class="form-group">
                    <label>Category</label>
                    <select name="category" id="merge-category">
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
                    <input type="text" name="keywords" id="merge-keywords" placeholder="term1, term2, term3">
                </div>
                <div style="display: flex; gap: 8px;">
                    <button type="submit" class="btn btn-primary">Merge & Add Tag</button>
                    <button type="button" class="btn btn-secondary" onclick="clearMergeSelection()">Clear Selection</button>
                </div>
            </form>
        </div>
        """

        # Accept modal
        modal_html = """
        <div id="acceptModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Accept Tag Suggestion</h3>
                    <span class="modal-close" onclick="closeAcceptModal()">&times;</span>
                </div>
                <form action="/accept" method="post">
                    <input type="hidden" name="term" id="accept-term">
                    <div class="form-group">
                        <label>Tag Name (slug)</label>
                        <input type="text" name="name" id="accept-name" required pattern="[a-z0-9-]+">
                    </div>
                    <div class="form-group">
                        <label>Display Name</label>
                        <input type="text" name="display_name" id="accept-display" required>
                    </div>
                    <div class="form-group">
                        <label>Category</label>
                        <select name="category" id="accept-category">
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
                        <input type="text" name="keywords" id="accept-keywords" placeholder="wedding, ceremony, bride">
                    </div>
                    <button type="submit" class="btn btn-primary">Accept & Add Tag</button>
                </form>
            </div>
        </div>
        """

        scripts = """
        <script>
            let selectedTerms = new Set();

            function openAcceptModal(term, category) {
                document.getElementById('accept-term').value = term;
                document.getElementById('accept-name').value = term.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                document.getElementById('accept-display').value = term;
                document.getElementById('accept-keywords').value = term;
                const catMap = {
                    'theme': 'activity',
                    'entity_person': 'people',
                    'entity_place': 'setting',
                    'entity_date': 'time_period',
                    'entity_org': 'other'
                };
                document.getElementById('accept-category').value = catMap[category] || 'other';
                document.getElementById('acceptModal').classList.add('active');
            }

            function closeAcceptModal() {
                document.getElementById('acceptModal').classList.remove('active');
            }

            function discardSuggestion(term) {
                if (confirm(`Discard suggestion "${term}"? This cannot be undone.`)) {
                    const form = document.createElement('form');
                    form.method = 'POST';
                    form.action = '/discard';
                    const input = document.createElement('input');
                    input.type = 'hidden';
                    input.name = 'term';
                    input.value = term;
                    form.appendChild(input);
                    document.body.appendChild(form);
                    form.submit();
                }
            }

            function selectForMerge(term) {
                if (selectedTerms.has(term)) {
                    selectedTerms.delete(term);
                } else {
                    selectedTerms.add(term);
                }
                updateMergePanel();
            }

            function updateMergePanel() {
                const panel = document.getElementById('mergePanel');
                const selectedDiv = document.getElementById('selectedTerms');
                
                if (selectedTerms.size === 0) {
                    panel.style.display = 'none';
                    return;
                }

                panel.style.display = 'block';
                selectedDiv.innerHTML = '<strong>Selected:</strong> ' + Array.from(selectedTerms).join(', ');
                
                // Update card styles
                document.querySelectorAll('.suggestion-card').forEach(card => {
                    const term = card.dataset.term;
                    if (selectedTerms.has(term)) {
                        card.style.border = '2px solid #4CAF50';
                        card.style.backgroundColor = '#f0f8f0';
                    } else {
                        card.style.border = '';
                        card.style.backgroundColor = '';
                    }
                });

                // Pre-fill merge form
                if (selectedTerms.size > 0) {
                    const terms = Array.from(selectedTerms);
                    const firstTerm = terms[0];
                    document.getElementById('target-term').value = firstTerm.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    document.getElementById('merge-display').value = firstTerm;
                    document.getElementById('merge-keywords').value = terms.join(', ');
                }
            }

            function clearMergeSelection() {
                selectedTerms.clear();
                updateMergePanel();
            }

            // Handle merge form submission
            document.getElementById('mergeForm').addEventListener('submit', function(e) {
                const sourceTerms = Array.from(selectedTerms);
                
                if (sourceTerms.length === 0) {
                    e.preventDefault();
                    alert('Please select at least one suggestion to merge.');
                    return;
                }
                
                // Add hidden inputs for source terms
                sourceTerms.forEach(term => {
                    const input = document.createElement('input');
                    input.type = 'hidden';
                    input.name = 'source_terms';
                    input.value = term;
                    this.appendChild(input);
                });
            });

            document.getElementById('acceptModal').addEventListener('click', function(e) {
                if (e.target === this) closeAcceptModal();
            });
        </script>
        """

        content = f"<h1>Tag Curation</h1>{stats_html}{filter_html}{merge_html}<div class='section'><h2>Pending Suggestions ({len(filtered)} found)</h2><div class='grid'>{cards_html}</div></div>{modal_html}"

        return BASE_TEMPLATE.format(
            title="Curate Tags",
            nav_discover="active",
            nav_curated="",
            nav_stats="",
            content=content,
            scripts=scripts,
        )

    @app.post("/accept")
    async def accept_suggestion(
        request: Request,
        term: str = Form(...),
        name: str = Form(...),
        display_name: str = Form(...),
        category: str = Form(...),
        keywords: str = Form(""),
    ):
        """Accept a tag suggestion and add it to curated tags."""
        state = request.app.state
        _ensure_state(request.app)

        keyword_list = [k.strip() for k in keywords.split(",") if k.strip()]
        if not keyword_list:
            keyword_list = [term.lower()]

        # Add to curated tags
        state.tags_manager.add_tag(name, display_name, category, keyword_list)

        # Mark suggestion as accepted
        state.suggestions_manager.accept_suggestion(term)

        return RedirectResponse(url="/", status_code=303)

    @app.post("/discard")
    async def discard_suggestion(request: Request, term: str = Form(...)):
        """Discard a tag suggestion."""
        state = request.app.state
        _ensure_state(request.app)

        state.suggestions_manager.discard_suggestion(term)
        return RedirectResponse(url="/", status_code=303)

    @app.post("/merge")
    async def merge_suggestions(request: Request):
        """Merge multiple suggestions into one curated tag."""
        state = request.app.state
        _ensure_state(request.app)

        form_data = await request.form()
        target_term = form_data.get("target_term")
        display_name = form_data.get("display_name")
        category = form_data.get("category")
        keywords = form_data.get("keywords", "")

        # Get source terms (can be multiple with same name)
        source_terms = form_data.getlist("source_terms")
        if not source_terms:
            return RedirectResponse(url="/?error=no_terms_selected", status_code=303)

        keyword_list = [k.strip() for k in keywords.split(",") if k.strip()]
        if not keyword_list:
            keyword_list = [target_term.lower()]

        # Add to curated tags
        state.tags_manager.add_tag(target_term, display_name, category, keyword_list)

        # Mark suggestions as merged
        state.suggestions_manager.merge_suggestions(source_terms, target_term)

        return RedirectResponse(url="/", status_code=303)

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
                '<div class="empty">No curated tags yet. Accept some suggestions to add tags!</div>'
            )

        content = f"""
        <h1>Curated Tags ({len(tags)} total)</h1>
        <p>These are the approved tags that will be used for image navigation.</p>
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

    @app.post("/curated/remove")
    async def remove_curated_tag(request: Request, name: str = Form(...)):
        """Remove a curated tag."""
        state = request.app.state
        _ensure_state(request.app)
        state.tags_manager.remove_tag(name)
        return RedirectResponse(url="/curated", status_code=303)

    return app


app = create_app()


def main():
    parser = argparse.ArgumentParser(description="Tag Curation Tool")
    parser.add_argument("--port", type=int, default=8765, help="Port to run on (default: 8765)")
    parser.add_argument("--db", type=str, default=str(DB_PATH), help="Path to database")
    args = parser.parse_args()

    app = create_app(Path(args.db))

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)

    print(f"\n{'=' * 60}", flush=True)
    print("  Tag Curation Tool", flush=True)
    print(f"{'=' * 60}", flush=True)
    print(f"  Open in browser: http://localhost:{args.port}", flush=True)
    print(f"  Database: {args.db}", flush=True)
    print(f"  Suggestions: {TAG_SUGGESTIONS_PATH}", flush=True)
    print(f"{'=' * 60}\n", flush=True)

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "public_site.db"
CURATED_TAGS_PATH = BASE_DIR / "curated_tags.json"
TAG_SUGGESTIONS_PATH = BASE_DIR / "tag_suggestions.json"

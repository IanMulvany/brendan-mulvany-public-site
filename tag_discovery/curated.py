import json
from typing import Dict, List

from .models import CuratedTag
from .settings import CURATED_TAGS_PATH


class CuratedTagsManager:
    """Manage the curated tags JSON file."""

    def __init__(self, path=CURATED_TAGS_PATH):
        self.path = path
        self._ensure_file()

    def _ensure_file(self):
        """Create the curated tags file if it doesn't exist."""
        if not self.path.exists():
            self.path.write_text(
                json.dumps(
                    {
                        "tags": [],
                        "categories": [
                            "event",
                            "setting",
                            "people",
                            "activity",
                            "time_period",
                            "other",
                        ],
                    },
                    indent=2,
                )
            )

    def load(self) -> Dict:
        """Load curated tags from file."""
        return json.loads(self.path.read_text())

    def save(self, data: Dict):
        """Save curated tags to file."""
        self.path.write_text(json.dumps(data, indent=2))

    def get_tags(self) -> List[CuratedTag]:
        """Get all curated tags."""
        data = self.load()
        return [CuratedTag(**t) for t in data.get("tags", [])]

    def add_tag(self, name: str, display_name: str, category: str, keywords: List[str]):
        """Add a new curated tag."""
        from datetime import datetime

        data = self.load()

        # Check for duplicates
        existing_names = {t["name"] for t in data["tags"]}
        if name in existing_names:
            return False

        data["tags"].append(
            {
                "name": name,
                "display_name": display_name,
                "category": category,
                "keywords": keywords,
                "created_at": datetime.now().isoformat(),
            }
        )
        self.save(data)
        return True

    def remove_tag(self, name: str) -> bool:
        """Remove a curated tag by name."""
        data = self.load()
        original_count = len(data["tags"])
        data["tags"] = [t for t in data["tags"] if t["name"] != name]
        if len(data["tags"]) < original_count:
            self.save(data)
            return True
        return False

    def get_categories(self) -> List[str]:
        """Get available tag categories."""
        data = self.load()
        return data.get("categories", [])

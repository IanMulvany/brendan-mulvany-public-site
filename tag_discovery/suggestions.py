import json
from typing import Dict, List, Optional
from datetime import datetime

from .models import TagSuggestion, TagCandidate
from .settings import TAG_SUGGESTIONS_PATH


class TagSuggestionsManager:
    """Manage tag suggestions storage."""

    def __init__(self, path=TAG_SUGGESTIONS_PATH):
        self.path = path
        self._ensure_file()

    def _ensure_file(self):
        """Create the tag suggestions file if it doesn't exist."""
        if not self.path.exists():
            self.path.write_text(
                json.dumps(
                    {
                        "suggestions": [],
                        "version": "1.0",
                    },
                    indent=2,
                )
            )

    def load(self) -> Dict:
        """Load tag suggestions from file."""
        return json.loads(self.path.read_text())

    def save(self, data: Dict):
        """Save tag suggestions to file."""
        self.path.write_text(json.dumps(data, indent=2))

    def get_suggestions(self, status: Optional[str] = None) -> List[TagSuggestion]:
        """Get all tag suggestions, optionally filtered by status."""
        data = self.load()
        suggestions = [TagSuggestion(**s) for s in data.get("suggestions", [])]
        if status:
            suggestions = [s for s in suggestions if s.status == status]
        return suggestions

    def add_suggestions(self, candidates: List[TagCandidate]):
        """Add new tag suggestions from candidates."""
        data = self.load()
        existing_terms = {s["term"] for s in data["suggestions"]}

        new_suggestions = []
        for candidate in candidates:
            # Skip if already exists
            if candidate.term in existing_terms:
                continue

            suggestion_dict = {
                "term": candidate.term,
                "category": candidate.category,
                "count": candidate.count,
                "sample_scene_ids": candidate.sample_scene_ids,
                "suggested_at": datetime.now().isoformat(),
                "status": "pending",
                "merged_into": None,
            }
            data["suggestions"].append(suggestion_dict)
            new_suggestions.append(suggestion_dict)

        self.save(data)
        return len(new_suggestions)

    def accept_suggestion(self, term: str) -> bool:
        """Mark a suggestion as accepted."""
        data = self.load()
        for s in data["suggestions"]:
            if s["term"] == term and s["status"] == "pending":
                s["status"] = "accepted"
                self.save(data)
                return True
        return False

    def discard_suggestion(self, term: str) -> bool:
        """Mark a suggestion as discarded."""
        data = self.load()
        for s in data["suggestions"]:
            if s["term"] == term and s["status"] == "pending":
                s["status"] = "discarded"
                self.save(data)
                return True
        return False

    def merge_suggestions(self, source_terms: List[str], target_term: str) -> bool:
        """Merge multiple suggestions into a target term."""
        data = self.load()
        updated = False

        for s in data["suggestions"]:
            if s["term"] in source_terms and s["status"] == "pending":
                s["status"] = "merged"
                s["merged_into"] = target_term
                updated = True

        if updated:
            self.save(data)
        return updated

    def get_pending_count(self) -> int:
        """Get count of pending suggestions."""
        return len(self.get_suggestions(status="pending"))

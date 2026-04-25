import logging
import re
import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Dict, List

from .models import TagCandidate

# Defer NLP imports to avoid crashes on startup
SPACY_AVAILABLE = False
SKLEARN_AVAILABLE = False
STOP_WORDS = set()


def lazy_load_spacy():
    """Load spaCy lazily to avoid startup crashes."""
    global SPACY_AVAILABLE, STOP_WORDS
    if SPACY_AVAILABLE:
        return True
    try:
        import spacy
        from spacy.lang.en.stop_words import STOP_WORDS as sw

        STOP_WORDS = sw
        SPACY_AVAILABLE = True
        return True
    except Exception as exc:
        logging.warning(f"Could not load spaCy: {exc}")
        return False


def lazy_load_sklearn():
    """Load sklearn lazily."""
    global SKLEARN_AVAILABLE
    if SKLEARN_AVAILABLE:
        return True
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer, CountVectorizer

        SKLEARN_AVAILABLE = True
        return True
    except Exception as exc:
        logging.warning(f"Could not load sklearn: {exc}")
        return False


# Words to exclude from tag suggestions (photography terms, common words, etc.)
EXCLUDED_TERMS = {
    # Photography terms
    "image",
    "photo",
    "photograph",
    "picture",
    "shot",
    "frame",
    "film",
    "camera",
    "vintage",
    "color",
    "black",
    "white",
    "grainy",
    "faded",
    "print",
    "negative",
    "resolution",
    "quality",
    "texture",
    "aesthetic",
    "tone",
    "tint",
    "hue",
    "lighting",
    "shadow",
    "highlight",
    "exposure",
    "contrast",
    "saturation",
    # Common descriptors
    "visible",
    "showing",
    "featuring",
    "appears",
    "seen",
    "looking",
    "standing",
    "sitting",
    "wearing",
    "holding",
    "background",
    "foreground",
    "left",
    "right",
    "center",
    "top",
    "bottom",
    "front",
    "back",
    "side",
    "corner",
    # Generic terms
    "people",
    "person",
    "man",
    "woman",
    "men",
    "women",
    "child",
    "children",
    "group",
    "crowd",
    "individual",
    "figure",
    "subject",
    "element",
    "detail",
    "scene",
    "setting",
    "location",
    "place",
    "area",
    "space",
    "room",
    # Document structure terms (from markdown)
    "description",
    "search",
    "keywords",
    "terms",
    "include",
    "features",
    "distinguishing",
    "visual",
    "key",
    "summary",
    "note",
    "style",
}


logger = logging.getLogger(__name__)


class TagDiscoveryEngine:
    """Engine for discovering potential tags from image descriptions."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.nlp = None
        self._nlp_init_attempted = False

    def _ensure_nlp(self):
        """Lazily initialize spaCy model on first use."""
        if self._nlp_init_attempted:
            return self.nlp is not None
        self._nlp_init_attempted = True

        if lazy_load_spacy():
            try:
                import spacy

                self.nlp = spacy.load("en_core_web_sm")
                logger.info("Loaded spaCy model: en_core_web_sm")
                return True
            except OSError:
                logger.warning(
                    "spaCy model not found. Run: uv run python -m spacy download en_core_web_sm"
                )
        return False

    def get_all_descriptions(self) -> List[Dict]:
        """Fetch all scenes with descriptions from database."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT s.scene_id, s.description, s.roll_number, s.capture_date,
                   s.roll_comment, s.date_notes, s.short_description,
                   iv.r2_key
            FROM scenes s
            LEFT JOIN image_versions iv ON s.scene_id = iv.scene_id AND iv.is_current = 1
            WHERE s.description IS NOT NULL AND s.description != ''
            ORDER BY s.capture_date DESC
        """
        )

        rows = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return rows

    def get_scene_count(self) -> int:
        """Get total number of scenes."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM scenes")
        count = cursor.fetchone()[0]
        conn.close()
        return count

    def get_scenes_for_term(self, term: str, limit: int = 50) -> List[Dict]:
        """Get scenes that contain a specific term in their description."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Use FTS if available, fallback to LIKE
        try:
            cursor.execute(
                """
                SELECT s.scene_id, s.description, s.roll_number, s.capture_date,
                       s.short_description, iv.r2_key
                FROM scenes s
                LEFT JOIN image_versions iv ON s.scene_id = iv.scene_id AND iv.is_current = 1
                WHERE s.scene_id IN (
                    SELECT scene_id FROM scenes_fts WHERE scenes_fts MATCH ?
                )
                LIMIT ?
            """,
                (f'"{term}"', limit),
            )
        except sqlite3.OperationalError:
            # Fallback to LIKE search
            cursor.execute(
                """
                SELECT s.scene_id, s.description, s.roll_number, s.capture_date,
                       s.short_description, iv.r2_key
                FROM scenes s
                LEFT JOIN image_versions iv ON s.scene_id = iv.scene_id AND iv.is_current = 1
                WHERE LOWER(s.description) LIKE ?
                LIMIT ?
            """,
                (f"%{term.lower()}%", limit),
            )

        rows = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return rows

    def clean_text(self, text: str) -> str:
        """Clean description text for analysis."""
        if not text:
            return ""
        # Remove markdown formatting
        text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)  # Bold
        text = re.sub(r"\*([^*]+)\*", r"\1", text)  # Italic
        text = re.sub(r"#+\s*", "", text)  # Headers
        text = re.sub(r"[-•]\s*", "", text)  # Bullets
        text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)  # Links
        # Remove section headers
        text = re.sub(
            r"(Image Search Description|Key Visual Elements|Distinguishing Features|Search Terms):",
            "",
            text,
            flags=re.IGNORECASE,
        )
        return text.strip()

    def discover_themes_tfidf(
        self, descriptions: List[Dict], min_count: int = 3, max_count: int = 200
    ) -> List[TagCandidate]:
        """Use TF-IDF to discover thematic terms across the corpus."""
        if not lazy_load_sklearn():
            logger.warning("scikit-learn not available for TF-IDF analysis")
            return []

        from sklearn.feature_extraction.text import CountVectorizer

        # Prepare corpus
        corpus = []
        scene_ids = []
        for desc in descriptions:
            cleaned = self.clean_text(desc["description"])
            if cleaned:
                corpus.append(cleaned)
                scene_ids.append(desc["scene_id"])

        if not corpus:
            return []

        # Count term frequencies across documents
        count_vec = CountVectorizer(
            stop_words="english",
            ngram_range=(1, 2),
            min_df=min_count,  # Must appear in at least N documents
            max_df=0.5,  # Must not appear in more than 50% of documents
            token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z]+\b",  # Letters only, 2+ chars
        )

        try:
            count_matrix = count_vec.fit_transform(corpus)
        except ValueError:
            return []

        # Get document frequencies
        feature_names = count_vec.get_feature_names_out()
        doc_frequencies = (count_matrix > 0).sum(axis=0).A1

        # Build term -> scene_ids mapping
        term_scenes = defaultdict(set)
        for doc_idx, doc in enumerate(corpus):
            doc_lower = doc.lower()
            for term in feature_names:
                if term.lower() in doc_lower:
                    term_scenes[term].add(scene_ids[doc_idx])

        # Create candidates
        candidates = []
        for term, freq in zip(feature_names, doc_frequencies):
            term_lower = term.lower()

            # Skip excluded terms
            if term_lower in EXCLUDED_TERMS:
                continue
            if any(excl in term_lower for excl in EXCLUDED_TERMS):
                continue

            # Skip very short terms or numbers
            if len(term) < 3 or term.isdigit():
                continue

            count = int(freq)
            if min_count <= count <= max_count:
                scenes = list(term_scenes[term])[:5]
                candidates.append(
                    TagCandidate(
                        term=term,
                        category="theme",
                        count=count,
                        sample_scene_ids=scenes,
                    )
                )

        # Sort by count descending
        candidates.sort(key=lambda x: x.count, reverse=True)
        return candidates[:100]  # Top 100

    def discover_entities(self, descriptions: List[Dict], min_count: int = 2) -> List[TagCandidate]:
        """Use spaCy NER to discover named entities."""
        if not self._ensure_nlp():
            logger.warning("spaCy not available for entity extraction")
            return []

        entity_counts = defaultdict(lambda: {"count": 0, "scenes": set()})

        for desc in descriptions:
            cleaned = self.clean_text(desc["description"])
            if not cleaned:
                continue

            doc = self.nlp(cleaned)
            seen_in_doc = set()

            for ent in doc.ents:
                # Normalize entity text
                ent_text = ent.text.strip()
                if len(ent_text) < 2:
                    continue

                # Skip if already seen in this doc (avoid double counting)
                key = (ent_text.lower(), ent.label_)
                if key in seen_in_doc:
                    continue
                seen_in_doc.add(key)

                entity_counts[(ent_text, ent.label_)]["count"] += 1
                entity_counts[(ent_text, ent.label_)]["scenes"].add(desc["scene_id"])

        # Map spaCy labels to categories
        label_to_category = {
            "PERSON": "entity_person",
            "GPE": "entity_place",  # Geo-Political Entity (countries, cities)
            "LOC": "entity_place",  # Locations
            "FAC": "entity_place",  # Facilities
            "ORG": "entity_org",
            "EVENT": "theme",
        }

        candidates = []
        for (ent_text, label), data in entity_counts.items():
            if data["count"] < min_count:
                continue

            category = label_to_category.get(label)
            if not category:
                continue

            # Skip generic date references
            if category == "entity_date" and ent_text.lower() in {
                "today",
                "yesterday",
                "now",
                "later",
            }:
                continue

            candidates.append(
                TagCandidate(
                    term=ent_text,
                    category=category,
                    count=data["count"],
                    sample_scene_ids=list(data["scenes"])[:5],
                )
            )

        candidates.sort(key=lambda x: x.count, reverse=True)
        return candidates

    def discover_all(self) -> Dict[str, List[TagCandidate]]:
        """Run all discovery methods and return grouped results."""
        descriptions = self.get_all_descriptions()
        logger.info(f"Analyzing {len(descriptions)} descriptions...")

        results = {
            "themes": self.discover_themes_tfidf(descriptions),
            "entities": self.discover_entities(descriptions),
        }

        # Sub-categorize entities
        entity_categories = defaultdict(list)
        for ent in results["entities"]:
            entity_categories[ent.category].append(ent)

        results["people"] = entity_categories.get("entity_person", [])
        results["places"] = entity_categories.get("entity_place", [])
        results["organizations"] = entity_categories.get("entity_org", [])
        # Dates are intentionally excluded from discovery results.

        return results

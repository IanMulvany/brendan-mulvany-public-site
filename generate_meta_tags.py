#!/usr/bin/env python3
"""
Generate SEO-friendly meta tags and Dublin Core metadata for web pages
using NLP (spaCy) for entity extraction and keyword generation.

This script processes scenes from the database and generates:
- SEO meta tags (title, description, keywords)
- Dublin Core metadata (DC terms)
- Open Graph tags (optional)

All processing is done locally using spaCy - no LLM required.
"""

import sqlite3
import json
import re
import logging
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime
from collections import Counter
import argparse

# NLP imports
try:
    import spacy
    from spacy.lang.en.stop_words import STOP_WORDS
    SPACY_AVAILABLE = True
except ImportError:
    SPACY_AVAILABLE = False
    spacy = None

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    TfidfVectorizer = None

# Import database module
import sys
sys.path.insert(0, str(Path(__file__).parent))
from database import PublicSiteDatabase

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Copyright holder
COPYRIGHT_HOLDER = "Brendan Mulvany"
SITE_NAME = "Brendan Mulvany Photo Archive"


class MetaTagGenerator:
    """Generate SEO and Dublin Core metadata using NLP"""
    
    def __init__(self, nlp_model: str = "en_core_web_sm"):
        """
        Initialize the meta tag generator
        
        Args:
            nlp_model: spaCy model name (default: en_core_web_sm)
        """
        if not SPACY_AVAILABLE:
            raise ImportError(
                "spaCy is required. Install with: uv add spacy && uv run python -m spacy download en_core_web_sm"
            )
        
        try:
            self.nlp = spacy.load(nlp_model)
            logger.info(f"Loaded spaCy model: {nlp_model}")
        except OSError:
            raise OSError(
                f"spaCy model '{nlp_model}' not found. "
                f"Install with: uv run python -m spacy download {nlp_model}"
            )
        
        # Initialize TF-IDF vectorizer if available
        self.use_tfidf = SKLEARN_AVAILABLE
        if self.use_tfidf:
            self.tfidf = TfidfVectorizer(
                max_features=50,
                stop_words='english',
                ngram_range=(1, 2),
                min_df=1
            )
            logger.info("Using TF-IDF for keyword extraction")
        else:
            logger.warning("scikit-learn not available, using simple keyword extraction")
    
    def extract_entities(self, text: str) -> Dict[str, List[str]]:
        """
        Extract named entities from text using spaCy
        
        Returns:
            Dict with entity types as keys and lists of entities as values
        """
        if not text:
            return {}
        
        doc = self.nlp(text)
        entities = {}
        
        for ent in doc.ents:
            entity_type = ent.label_
            entity_text = ent.text.strip()
            
            if entity_text:
                if entity_type not in entities:
                    entities[entity_type] = []
                if entity_text not in entities[entity_type]:
                    entities[entity_type].append(entity_text)
        
        return entities
    
    def extract_keywords(self, text: str, max_keywords: int = 10) -> List[str]:
        """
        Extract keywords from text using TF-IDF or simple frequency analysis
        
        Args:
            text: Input text
            max_keywords: Maximum number of keywords to return
            
        Returns:
            List of keywords sorted by importance
        """
        if not text:
            return []
        
        doc = self.nlp(text)
        
        # Extract meaningful words (nouns, adjectives, proper nouns)
        keywords = []
        for token in doc:
            if (token.pos_ in ['NOUN', 'PROPN', 'ADJ'] and 
                not token.is_stop and 
                not token.is_punct and
                len(token.text) > 2):
                keywords.append(token.lemma_.lower())
        
        # Count frequencies
        keyword_counts = Counter(keywords)
        
        # Return top keywords
        return [word for word, count in keyword_counts.most_common(max_keywords)]
    
    def generate_title(self, scene: Dict, max_length: int = 60) -> str:
        """
        Generate SEO-friendly title
        
        Args:
            scene: Scene dictionary from database
            max_length: Maximum title length
            
        Returns:
            SEO-friendly title
        """
        parts = []
        
        # Start with filename or short description
        if scene.get('short_description'):
            parts.append(scene['short_description'])
        elif scene.get('base_filename'):
            # Clean filename (remove extension, make readable)
            filename = scene['base_filename'].replace('_', ' ').replace('-', ' ')
            parts.append(filename)
        
        # Add date if available
        date_str = self._format_date_for_title(scene.get('capture_date') or scene.get('roll_date'))
        if date_str:
            parts.append(f"({date_str})")
        
        # Add site name
        parts.append(f"- {SITE_NAME}")
        
        title = " ".join(parts)
        
        # Truncate if too long
        if len(title) > max_length:
            # Keep site name, truncate the beginning
            site_part = f" - {SITE_NAME}"
            available_length = max_length - len(site_part)
            main_part = parts[0][:available_length].rsplit(' ', 1)[0]  # Don't cut words
            title = f"{main_part}{site_part}"
        
        return title
    
    def generate_description(self, scene: Dict, max_length: int = 160) -> str:
        """
        Generate SEO-friendly meta description
        
        Args:
            scene: Scene dictionary from database
            max_length: Maximum description length
            
        Returns:
            SEO-friendly description
        """
        parts = []
        
        # Use description if available
        if scene.get('description'):
            desc = scene['description'].strip()
            # Clean up description (remove extra whitespace)
            desc = re.sub(r'\s+', ' ', desc)
            parts.append(desc)
        elif scene.get('short_description'):
            parts.append(scene['short_description'])
        elif scene.get('roll_comment'):
            parts.append(scene['roll_comment'])
        
        # Add context
        context_parts = []
        if scene.get('roll_number'):
            context_parts.append(f"Roll {scene['roll_number']}")
        
        date_str = self._format_date_for_description(scene.get('capture_date') or scene.get('roll_date'))
        if date_str:
            context_parts.append(date_str)
        
        if context_parts:
            context = f" ({', '.join(context_parts)})"
            parts.append(context)
        
        description = " ".join(parts)
        
        # Truncate if too long, but try to end at sentence boundary
        if len(description) > max_length:
            # Try to find sentence boundary
            truncated = description[:max_length]
            last_period = truncated.rfind('.')
            last_space = truncated.rfind(' ')
            
            if last_period > max_length * 0.7:  # If period is reasonably close
                description = truncated[:last_period + 1]
            else:
                description = truncated[:last_space] + "..."
        
        return description
    
    def generate_keywords(self, scene: Dict, max_keywords: int = 10) -> List[str]:
        """
        Generate SEO keywords from scene metadata
        
        Args:
            scene: Scene dictionary from database
            max_keywords: Maximum number of keywords
            
        Returns:
            List of keywords
        """
        # Combine all text fields
        text_fields = [
            scene.get('description', ''),
            scene.get('short_description', ''),
            scene.get('roll_comment', ''),
            scene.get('index_book_comment', ''),
            scene.get('date_notes', ''),
        ]
        
        combined_text = " ".join(filter(None, text_fields))
        
        if not combined_text:
            # Fallback to filename
            if scene.get('base_filename'):
                combined_text = scene['base_filename'].replace('_', ' ').replace('-', ' ')
        
        keywords = self.extract_keywords(combined_text, max_keywords=max_keywords)
        
        # Add structured metadata as keywords
        if scene.get('roll_number'):
            keywords.insert(0, f"roll-{scene['roll_number']}")
        
        if scene.get('roll_date'):
            year = self._extract_year(scene['roll_date'])
            if year:
                keywords.insert(0, str(year))
        
        # Remove duplicates while preserving order
        seen = set()
        unique_keywords = []
        for kw in keywords:
            if kw.lower() not in seen:
                seen.add(kw.lower())
                unique_keywords.append(kw)
        
        return unique_keywords[:max_keywords]
    
    def generate_dublin_core(self, scene: Dict, base_url: str = "") -> Dict[str, str]:
        """
        Generate Dublin Core metadata
        
        Args:
            scene: Scene dictionary from database
            base_url: Base URL for the site (for dc:identifier)
            
        Returns:
            Dictionary of DC metadata fields
        """
        dc = {}
        
        # dc:title
        dc['dc:title'] = self.generate_title(scene, max_length=200)
        
        # dc:description
        dc['dc:description'] = self.generate_description(scene, max_length=500)
        
        # dc:creator
        dc['dc:creator'] = COPYRIGHT_HOLDER
        
        # dc:rights
        dc['dc:rights'] = f"Copyright © {COPYRIGHT_HOLDER}. All rights reserved."
        
        # dc:date.created
        date_created = scene.get('capture_date') or scene.get('roll_date')
        if date_created:
            dc['dc:date.created'] = self._normalize_date(date_created)
        
        # dc:date
        if scene.get('created_at'):
            dc['dc:date'] = self._normalize_date(scene['created_at'])
        
        # dc:identifier
        if base_url:
            scene_id = scene.get('scene_id', '')
            if scene_id:
                dc['dc:identifier'] = f"{base_url}/image/{scene.get('image_id', '')}"
        
        # dc:subject (keywords)
        keywords = self.generate_keywords(scene, max_keywords=15)
        if keywords:
            dc['dc:subject'] = ", ".join(keywords)
        
        # dc:type
        dc['dc:type'] = "Image"
        
        # dc:format (if we have image info)
        if scene.get('width') and scene.get('height'):
            dc['dc:format'] = f"image/jpeg ({scene['width']}x{scene['height']})"
        
        # Extract entities for dc:coverage (locations) and dc:subject (people, organizations)
        text_fields = [
            scene.get('description', ''),
            scene.get('short_description', ''),
            scene.get('roll_comment', ''),
        ]
        combined_text = " ".join(filter(None, text_fields))
        
        if combined_text:
            entities = self.extract_entities(combined_text)
            
            # dc:coverage (locations)
            if 'GPE' in entities or 'LOC' in entities:
                locations = entities.get('GPE', []) + entities.get('LOC', [])
                if locations:
                    dc['dc:coverage'] = ", ".join(locations[:5])
            
            # Add people to subject
            if 'PERSON' in entities:
                people = entities['PERSON']
                if people:
                    existing_subject = dc.get('dc:subject', '')
                    if existing_subject:
                        dc['dc:subject'] = f"{existing_subject}, {', '.join(people[:5])}"
                    else:
                        dc['dc:subject'] = ", ".join(people[:5])
        
        return dc
    
    def generate_meta_tags_html(self, scene: Dict, base_url: str = "") -> str:
        """
        Generate HTML meta tags string
        
        Args:
            scene: Scene dictionary from database
            base_url: Base URL for the site
            
        Returns:
            HTML string with meta tags
        """
        tags = []
        
        # SEO meta tags
        title = self.generate_title(scene)
        description = self.generate_description(scene)
        keywords = self.generate_keywords(scene)
        
        tags.append(f'    <title>{self._escape_html(title)}</title>')
        tags.append(f'    <meta name="description" content="{self._escape_html(description)}">')
        if keywords:
            tags.append(f'    <meta name="keywords" content="{self._escape_html(", ".join(keywords))}">')
        
        # Copyright and author
        tags.append(f'    <meta name="copyright" content="© {COPYRIGHT_HOLDER}">')
        tags.append(f'    <meta name="author" content="{COPYRIGHT_HOLDER}">')
        
        # Dublin Core meta tags
        dc = self.generate_dublin_core(scene, base_url)
        for key, value in dc.items():
            if value:
                # Convert dc:title to name="dcterms.title" format
                meta_name = key.replace('dc:', 'dcterms.').replace('.', ':')
                tags.append(f'    <meta name="{meta_name}" content="{self._escape_html(str(value))}">')
        
        # Open Graph tags (optional but good for social sharing)
        tags.append(f'    <meta property="og:title" content="{self._escape_html(title)}">')
        tags.append(f'    <meta property="og:description" content="{self._escape_html(description)}">')
        tags.append(f'    <meta property="og:type" content="website">')
        if base_url and scene.get('image_id'):
            tags.append(f'    <meta property="og:url" content="{base_url}/image/{scene["image_id"]}">')
        if scene.get('thumbnail_url'):
            tags.append(f'    <meta property="og:image" content="{self._escape_html(scene["thumbnail_url"])}">')
        
        return "\n".join(tags)
    
    def _format_date_for_title(self, date_str: Optional[str]) -> Optional[str]:
        """Format date for title (short format)"""
        if not date_str:
            return None
        
        # Try to extract year
        year = self._extract_year(date_str)
        if year:
            return str(year)
        
        return None
    
    def _format_date_for_description(self, date_str: Optional[str]) -> Optional[str]:
        """Format date for description"""
        if not date_str:
            return None
        
        year = self._extract_year(date_str)
        if year:
            return str(year)
        
        return date_str
    
    def _extract_year(self, date_str: str) -> Optional[int]:
        """Extract year from date string"""
        if not date_str:
            return None
        
        # Try ISO format (YYYY-MM-DD)
        match = re.search(r'(\d{4})-\d{2}-\d{2}', date_str)
        if match:
            return int(match.group(1))
        
        # Try YYYY format
        match = re.search(r'\b(\d{4})\b', date_str)
        if match:
            year = int(match.group(1))
            # Sanity check: reasonable year range
            if 1900 <= year <= 2100:
                return year
        
        return None
    
    def _normalize_date(self, date_str: str) -> str:
        """Normalize date to ISO format"""
        if not date_str:
            return ""
        
        # Try to parse ISO format
        try:
            dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
            return dt.strftime('%Y-%m-%d')
        except (ValueError, AttributeError):
            pass
        
        # Try to extract year-month-day
        match = re.search(r'(\d{4})-(\d{2})-(\d{2})', date_str)
        if match:
            return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
        
        # Try to extract just year
        year = self._extract_year(date_str)
        if year:
            return f"{year}-01-01"  # Default to January 1st if only year
        
        return date_str
    
    def _escape_html(self, text: str) -> str:
        """Escape HTML special characters"""
        if not text:
            return ""
        return (text
                .replace('&', '&amp;')
                .replace('<', '&lt;')
                .replace('>', '&gt;')
                .replace('"', '&quot;')
                .replace("'", '&#39;'))


def process_scenes(
    db_path: Path,
    output_path: Optional[Path] = None,
    base_url: str = "",
    limit: Optional[int] = None
) -> Dict[str, Dict]:
    """
    Process all scenes and generate meta tags
    
    Args:
        db_path: Path to SQLite database
        output_path: Optional path to save JSON output
        base_url: Base URL for the site
        limit: Optional limit on number of scenes to process
        
    Returns:
        Dictionary mapping scene_id to meta tags dictionary
    """
    logger.info(f"Loading database from {db_path}")
    db = PublicSiteDatabase(db_path=db_path)
    
    logger.info("Initializing NLP model...")
    generator = MetaTagGenerator()
    
    logger.info("Loading scenes from database...")
    scenes = db.get_scenes_with_current_versions(limit=limit or 10000, offset=0)
    logger.info(f"Found {len(scenes)} scenes")
    
    results = {}
    
    for i, scene in enumerate(scenes):
        if (i + 1) % 100 == 0:
            logger.info(f"Processing scene {i + 1}/{len(scenes)}...")
        
        scene_id = scene.get('scene_id')
        if not scene_id:
            continue
        
        try:
            # Generate meta tags
            meta_tags = {
                'title': generator.generate_title(scene),
                'description': generator.generate_description(scene),
                'keywords': generator.generate_keywords(scene),
                'dublin_core': generator.generate_dublin_core(scene, base_url),
                'html_meta_tags': generator.generate_meta_tags_html(scene, base_url)
            }
            
            results[scene_id] = meta_tags
            
        except Exception as e:
            logger.error(f"Error processing scene {scene_id}: {e}", exc_info=True)
            continue
    
    logger.info(f"Processed {len(results)} scenes")
    
    # Save to JSON if output path provided
    if output_path:
        logger.info(f"Saving results to {output_path}")
        with open(output_path, 'w') as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        logger.info("Saved results")
    
    return results


def main():
    parser = argparse.ArgumentParser(
        description="Generate SEO meta tags and Dublin Core metadata using NLP"
    )
    parser.add_argument(
        '--db',
        type=Path,
        default=Path('public_site.db'),
        help='Path to SQLite database (default: public_site.db)'
    )
    parser.add_argument(
        '--output',
        type=Path,
        help='Output JSON file path (optional)'
    )
    parser.add_argument(
        '--base-url',
        type=str,
        default='',
        help='Base URL for the site (for dc:identifier and og:url)'
    )
    parser.add_argument(
        '--limit',
        type=int,
        help='Limit number of scenes to process (for testing)'
    )
    parser.add_argument(
        '--scene-id',
        type=str,
        help='Process only a specific scene_id (for testing)'
    )
    
    args = parser.parse_args()
    
    if not args.db.exists():
        logger.error(f"Database not found: {args.db}")
        return 1
    
    try:
        if args.scene_id:
            # Process single scene
            logger.info(f"Processing scene: {args.scene_id}")
            db = PublicSiteDatabase(db_path=args.db)
            scene = db.get_scene(args.scene_id)
            
            if not scene:
                logger.error(f"Scene not found: {args.scene_id}")
                return 1
            
            # Get current version
            version = db.get_current_version_for_scene(args.scene_id)
            if version:
                scene.update(version)
            
            generator = MetaTagGenerator()
            meta_tags = generator.generate_meta_tags_html(scene, args.base_url)
            
            print("\n" + "="*80)
            print("Generated Meta Tags:")
            print("="*80)
            print(meta_tags)
            print("="*80)
            
            dc = generator.generate_dublin_core(scene, args.base_url)
            print("\nDublin Core Metadata:")
            print("="*80)
            for key, value in dc.items():
                print(f"{key}: {value}")
            print("="*80)
            
        else:
            # Process all scenes
            results = process_scenes(
                db_path=args.db,
                output_path=args.output,
                base_url=args.base_url,
                limit=args.limit
            )
            
            if args.output:
                logger.info(f"Results saved to {args.output}")
            else:
                logger.info(f"Generated meta tags for {len(results)} scenes")
                logger.info("Use --output to save results to a file")
        
        return 0
        
    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
        return 1


if __name__ == "__main__":
    exit(main())


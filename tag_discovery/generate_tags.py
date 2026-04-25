#!/usr/bin/env python3
"""
Tag Generation Script - Generates tag suggestions from image descriptions.

This script runs the tag discovery engine and stores potential tags as suggestions
that can later be curated through the curation web app.

Usage:
    uv run python -m tag_discovery.generate_tags [--db path/to/db]
"""

import argparse
import logging
import sys
from pathlib import Path

from .engine import TagDiscoveryEngine
from .suggestions import TagSuggestionsManager
from .settings import DB_PATH

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="Generate tag suggestions from image descriptions")
    parser.add_argument("--db", type=str, default=str(DB_PATH), help="Path to database")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        logger.error(f"Database not found: {db_path}")
        sys.exit(1)

    logger.info(f"Loading tag discovery engine from {db_path}")
    engine = TagDiscoveryEngine(db_path)

    logger.info("Running tag discovery...")
    results = engine.discover_all()

    logger.info("Storing tag suggestions...")
    suggestions_manager = TagSuggestionsManager()

    # Collect all candidates
    all_candidates = []
    for category in ["themes", "people", "places"]:
        all_candidates.extend(results.get(category, []))

    # Add suggestions
    added_count = suggestions_manager.add_suggestions(all_candidates)

    logger.info(f"Added {added_count} new tag suggestions")
    logger.info(f"Total pending suggestions: {suggestions_manager.get_pending_count()}")

    # Print summary
    print("\n" + "=" * 60)
    print("Tag Generation Summary")
    print("=" * 60)
    print(f"  Themes found: {len(results.get('themes', []))}")
    print(f"  People found: {len(results.get('people', []))}")
    print(f"  Places found: {len(results.get('places', []))}")
    print(f"  New suggestions added: {added_count}")
    print(f"  Total pending suggestions: {suggestions_manager.get_pending_count()}")
    print("=" * 60)
    print("\nRun the curation app to review and accept/discard/merge suggestions:")
    print("  uv run python -m tag_discovery.curate_tags")


if __name__ == "__main__":
    main()

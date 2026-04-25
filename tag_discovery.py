#!/usr/bin/env python3
"""
Tag Discovery Tool - Entry point for tag curation web app.

Note: Tag discovery has been split into two tools:
  1. Generate tag suggestions: uv run python -m tag_discovery.generate_tags
  2. Curate tags (this script): uv run python tag_discovery.py [--port 8765]

Usage:
    uv run python tag_discovery.py [--port 8765]

Then open http://localhost:8765 in your browser.
"""

def main():
    print("Starting Tag Curation Tool...", flush=True)
    from tag_discovery.curate_tags import main as curate_main

    curate_main()


if __name__ == "__main__":
    main()

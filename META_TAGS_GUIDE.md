# Meta Tags Generation Guide

This guide explains how to use the `generate_meta_tags.py` script to generate SEO-friendly meta tags and Dublin Core metadata for your photo archive pages using NLP (no LLM required).

## Overview

The script uses spaCy (a fast, local NLP library) to:
- Extract named entities (people, places, organizations)
- Generate SEO keywords from descriptions
- Create SEO-friendly titles and descriptions
- Generate full Dublin Core metadata
- Set copyright to "Brendan Mulvany"
- Use image creation dates for DC dates

## Installation

### Using uv (Recommended)

```bash
# Install dependencies
uv add spacy scikit-learn

# Download spaCy English model
uv run python -m spacy download en_core_web_sm
```

### Using pip

```bash
pip install spacy scikit-learn
python -m spacy download en_core_web_sm
```

## Usage

### Basic Usage

Generate meta tags for all scenes in the database:

```bash
uv run python generate_meta_tags.py --db public_site.db --output meta_tags.json --base-url https://your-site.com
```

### Test with a Single Scene

Test the script on a single scene:

```bash
uv run python generate_meta_tags.py --db public_site.db --scene-id "2025-11-04-batch-1-DSCF1487" --base-url https://your-site.com
```

### Process Limited Number of Scenes

For testing, limit the number of scenes:

```bash
uv run python generate_meta_tags.py --db public_site.db --limit 10 --output test_meta_tags.json
```

## Command Line Options

- `--db`: Path to SQLite database (default: `public_site.db`)
- `--output`: Path to save JSON output file (optional)
- `--base-url`: Base URL for your site (used for dc:identifier and og:url)
- `--limit`: Limit number of scenes to process (for testing)
- `--scene-id`: Process only a specific scene_id (for testing)

## Output Format

The script generates JSON with the following structure:

```json
{
  "scene_id": {
    "title": "SEO-friendly title",
    "description": "SEO-friendly meta description",
    "keywords": ["keyword1", "keyword2", ...],
    "dublin_core": {
      "dc:title": "...",
      "dc:description": "...",
      "dc:creator": "Brendan Mulvany",
      "dc:rights": "Copyright © Brendan Mulvany. All rights reserved.",
      "dc:date.created": "1980-05-15",
      "dc:subject": "keyword1, keyword2, ...",
      "dc:coverage": "Location1, Location2",
      ...
    },
    "html_meta_tags": "<title>...</title>\n<meta name=\"description\" ...>..."
  }
}
```

## Generated Meta Tags

### SEO Meta Tags

- `<title>`: SEO-optimized title (max 60 chars)
- `<meta name="description">`: SEO description (max 160 chars)
- `<meta name="keywords">`: Comma-separated keywords
- `<meta name="copyright">`: Copyright notice
- `<meta name="author">`: Author name

### Dublin Core Meta Tags

- `dc:title`: Full title
- `dc:description`: Full description
- `dc:creator`: "Brendan Mulvany"
- `dc:rights`: Copyright statement
- `dc:date.created`: Image creation date (from capture_date or roll_date)
- `dc:date`: Page creation date
- `dc:identifier`: URL to the image page
- `dc:subject`: Keywords and extracted entities
- `dc:type`: "Image"
- `dc:format`: Image format and dimensions (if available)
- `dc:coverage`: Extracted locations (if found in text)

### Open Graph Tags

- `og:title`: Title for social sharing
- `og:description`: Description for social sharing
- `og:type`: "website"
- `og:url`: URL to the image page
- `og:image`: Thumbnail image URL

## How It Works

### Named Entity Recognition (NER)

The script uses spaCy's NER to extract:
- **PERSON**: People mentioned in descriptions
- **GPE**: Geopolitical entities (countries, cities)
- **LOC**: Locations
- **ORG**: Organizations
- **DATE**: Dates (already extracted from database)

### Keyword Extraction

Keywords are extracted using:
1. **TF-IDF** (if scikit-learn is available): Identifies important terms
2. **Frequency analysis**: Counts nouns, proper nouns, and adjectives
3. **Structured metadata**: Adds roll numbers and years as keywords

### Title Generation

Titles are generated from:
1. Short description or filename
2. Date (year)
3. Site name

Titles are truncated to ~60 characters for SEO.

### Description Generation

Descriptions are generated from:
1. Full description (if available)
2. Short description or roll comment (fallback)
3. Context (roll number, date)

Descriptions are truncated to ~160 characters for SEO.

## Integration with Build Process

You can integrate this into your static site build process:

```python
# In build_static.py or similar
from generate_meta_tags import MetaTagGenerator

generator = MetaTagGenerator()

# For each scene/page
meta_tags_html = generator.generate_meta_tags_html(scene, base_url="https://your-site.com")

# Inject into HTML template
html = inject_meta_tags_into_html(html_template, meta_tags_html)
```

## Performance

- **Speed**: Processes ~100 scenes/second (depends on text length)
- **Memory**: ~500MB for spaCy model
- **No external API calls**: Everything runs locally

## Troubleshooting

### spaCy Model Not Found

```bash
uv run python -m spacy download en_core_web_sm
```

### Missing Dependencies

```bash
uv add spacy scikit-learn
```

### Low Quality Keywords

If keywords seem generic:
- Ensure descriptions in database are detailed
- The script extracts from: description, short_description, roll_comment, index_book_comment
- More text = better keyword extraction

## Example Output

For a scene with description "Family gathering at beach in California, 1980":

**Title:**
```
Family gathering at beach in California (1980) - Brendan Mulvany Photo Archive
```

**Description:**
```
Family gathering at beach in California, 1980. (Roll 4081, 1980)
```

**Keywords:**
```
["family", "gathering", "beach", "california", "1980", "roll-4081"]
```

**Dublin Core:**
```
dc:title: Family gathering at beach in California (1980) - Brendan Mulvany Photo Archive
dc:description: Family gathering at beach in California, 1980. (Roll 4081, 1980)
dc:creator: Brendan Mulvany
dc:rights: Copyright © Brendan Mulvany. All rights reserved.
dc:date.created: 1980-01-01
dc:subject: family, gathering, beach, california, 1980, roll-4081
dc:coverage: California
dc:type: Image
```

## Notes

- The script processes all text fields from the database
- Dates are normalized to ISO format (YYYY-MM-DD)
- Copyright is always set to "Brendan Mulvany"
- Entity extraction is unsupervised (no training required)
- All processing is local - no API calls or LLMs


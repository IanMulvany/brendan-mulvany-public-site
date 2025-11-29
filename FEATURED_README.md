# Featured Images Selector

This tool allows you to select featured images that will appear in a carousel on the homepage of your static site.

## How to Use

### 1. Run the Featured Selector App

```bash
python3 featured_selector.py
```

This will start a local web server on port 5555. Open your browser to:

```
http://localhost:5555
```

### 2. Select Featured Images

- Browse through all your images in the grid
- Click on any image to toggle it as "featured" (a blue border and star will appear)
- Use the "Show Featured Only" checkbox to filter the view
- When you're done, click "💾 Save Featured" to save your selections

Your selections will be saved to `featured.json` in the root directory.

### 3. Build the Static Site

After selecting your featured images, run the build script:

```bash
python3 build_static.py --db public_site.db --config config.local.yaml
```

This will:
- Read the `featured.json` file
- Load the full data for each featured image
- Generate the homepage with a featured image carousel at the top
- Auto-advance through featured images every 5 seconds
- Allow manual navigation with arrow buttons

## Files Created

- **featured.json** - List of scene IDs for featured images
- **featured_selector.py** - Flask app for selecting featured images
- **generate_featured.py** - Script to generate initial random featured images

## Initial Setup

The system comes pre-populated with 10 random images. To regenerate random featured images:

```bash
python3 generate_featured.py public_site.db
```

## Carousel Features

The homepage carousel includes:
- Full-size images with captions
- Auto-advance every 5 seconds
- Manual navigation with arrow buttons
- Dot indicators at the bottom
- Pause on hover
- Links to individual image pages

## Technical Details

- Featured images are stored by scene_id in featured.json
- The build script loads the full scene data for each featured image
- The carousel is only shown if there are featured images
- Navigation is accessible with keyboard and screen readers

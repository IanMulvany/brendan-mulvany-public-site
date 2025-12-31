# Testing Static Site Locally

## Quick Start

### Option 1: Use the test script (easiest)

```bash
./test_static_site.sh
```

This will:
1. Build the static site from your local database
2. Start a local HTTP server on port 8000
3. Open http://localhost:8000 in your browser

Press `Ctrl+C` to stop the server.

### Option 2: Manual steps

```bash
# 1. Ensure your local database is synced
# (Your existing sync operations should have created public_site.db)

# 2. Build the static site
uv run python build_static.py
# OR
python3 build_static.py

# 3. Navigate to dist directory
cd dist

# 4. Start local server
python3 -m http.server 8000

# 5. Open in browser
open http://localhost:8000
```

## What Gets Built

The build script creates:

```
dist/
├── index.html              # Homepage with embedded gallery data
├── search.html             # Search page with embedded index
├── image/
│   └── {image_id}/
│       └── index.html      # Individual image pages with embedded data
├── roll/
│   └── {roll_number}/
│       └── index.html      # Roll pages with embedded data
├── static/                 # Copied CSS, JS, images
│   ├── css/
│   ├── js/
│   └── images/
└── api/
    └── public/              # API endpoints (search uses FTS5 database)
```

## What to Test

1. **Homepage** (`/`)
   - Gallery loads from embedded data (no API call)
   - Images display correctly
   - "Load More" button works (if more than 48 images)

2. **Image Pages** (`/image/{image_id}`)
   - Image displays with srcset variants
   - Metadata shows correctly
   - Similar images display (pre-computed)
   - Prev/Next navigation works

3. **Roll Pages** (`/roll/{roll_number}`)
   - Roll metadata displays
   - All images from roll show correctly

4. **Search Page** (`/search`)
   - Search works client-side using embedded index
   - Filters work correctly
   - Facets display

5. **Static Assets**
   - CSS loads correctly
   - JavaScript loads correctly
   - No 404 errors in browser console

## Troubleshooting

### Build fails: "Local DB not found"

**Solution**: Ensure your sync operations have created `public_site.db` in the project directory, or set `LOCAL_DB_PATH`:

```bash
export LOCAL_DB_PATH="/path/to/your/public_site.db"
python build_static.py
```

Or create `build_config.json`:

```json
{
  "local_db_path": "/path/to/your/public_site.db"
}
```

### Pages load but show "Loading..."

**Solution**: Check browser console for JavaScript errors. Ensure:
- Static files were copied to `dist/static/`
- JavaScript files reference correct paths
- No CORS errors

### Images don't display

**Solution**: 
- Check that `config.yaml` has correct storage/CDN configuration
- Verify image URLs in browser network tab
- Ensure CDN URLs are accessible

### Search doesn't work

**Solution**:
- Check that the FTS5 search index is set up in the database
- Verify browser console for API errors
- Ensure the `/api/public/search` endpoint is accessible

## Configuration

### Database Path

Default: `./public_site.db`

Override with:
- Environment variable: `export LOCAL_DB_PATH="/path/to/db"`
- Config file: Create `build_config.json` with `{"local_db_path": "/path/to/db"}`

### Config File

Default: `config.local.yaml` (if exists), otherwise `config.yaml`

The build script uses your existing `ConfigManager` to read storage configuration for image URLs.

## Next Steps

After testing locally:

1. **Build for production**:
   ```bash
   python build_static.py
   ```

2. **Deploy to Vercel**:
   ```bash
   vercel --prod
   ```

3. **Verify deployment**:
   - Check that static pages load
   - Verify API endpoints still work (auth, annotations, admin)
   - Test search functionality

## Notes

- The static site uses **embedded data** in HTML pages - no database queries needed
- **API endpoints** (auth, annotations, admin) still work via FastAPI on Vercel
- **Search** works client-side using the embedded index, falls back to API if needed
- **Similar images** are pre-computed during build - no runtime computation needed


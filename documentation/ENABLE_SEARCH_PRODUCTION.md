# Enabling Search on Vercel Production

This guide covers the steps needed to enable search functionality on your Vercel production deployment.

## Prerequisites

Search requires:
1. **Database connection** (Turso or SQLite) with FTS5 search index
2. **Environment variables** configured in Vercel
3. **API endpoint** accessible via `/api/public/search`

## Step 1: Setup FTS5 Search Index

### If using Turso (Recommended for Production)

**Option A: Use the setup script (Recommended)**

1. **Run the setup script**:
   ```bash
   # Set your Turso credentials
   export TURSO_DATABASE_URL="libsql://your-database-url.turso.io"
   export TURSO_AUTH_TOKEN="your-turso-auth-token"
   
   # Run the setup script
   python3 setup_turso_fts5.py --turso-url "$TURSO_DATABASE_URL" --turso-token "$TURSO_AUTH_TOKEN"
   ```

   Or pass credentials directly:
   ```bash
   python3 setup_turso_fts5.py \
     --turso-url "libsql://your-database-url.turso.io" \
     --turso-token "your-turso-auth-token"
   ```

2. **Verify it worked**:
   ```bash
   turso db shell public-site-db
   ```
   Then run:
   ```sql
   SELECT COUNT(*) FROM scenes_fts;
   SELECT COUNT(*) FROM scenes;
   ```
   Both counts should be similar.

**Option B: Manual setup via Turso CLI**

1. **Connect to your database**:
   ```bash
   turso db shell public-site-db
   ```

2. **Create the FTS5 table**:
   ```sql
   CREATE VIRTUAL TABLE scenes_fts USING fts5(
       scene_id UNINDEXED,
       base_filename,
       description,
       roll_comment,
       date_notes,
       index_book_comment,
       short_description,
       content='scenes',
       content_rowid='rowid'
   );
   ```

3. **Create triggers** (to keep FTS5 in sync):
   ```sql
   CREATE TRIGGER scenes_fts_insert AFTER INSERT ON scenes BEGIN
       INSERT INTO scenes_fts(rowid, scene_id, base_filename, description, 
                              roll_comment, date_notes, index_book_comment, short_description)
       VALUES (new.rowid, new.scene_id, new.base_filename, new.description,
               new.roll_comment, new.date_notes, new.index_book_comment, new.short_description);
   END;
   
   CREATE TRIGGER scenes_fts_delete AFTER DELETE ON scenes BEGIN
       DELETE FROM scenes_fts WHERE rowid = old.rowid;
   END;
   
   CREATE TRIGGER scenes_fts_update AFTER UPDATE ON scenes BEGIN
       DELETE FROM scenes_fts WHERE rowid = old.rowid;
       INSERT INTO scenes_fts(rowid, scene_id, base_filename, description, 
                              roll_comment, date_notes, index_book_comment, short_description)
       VALUES (new.rowid, new.scene_id, new.base_filename, new.description,
               new.roll_comment, new.date_notes, new.index_book_comment, new.short_description);
   END;
   ```

4. **Populate the FTS5 index**:
   ```sql
   INSERT INTO scenes_fts(rowid, scene_id, base_filename, description, roll_comment, date_notes, index_book_comment, short_description)
   SELECT rowid, scene_id, base_filename, description, roll_comment, date_notes, index_book_comment, short_description
   FROM scenes;
   ```

### If using SQLite (Local file)

The FTS5 table should be created automatically by `database.py` when initializing locally. However, for production on Vercel, you should use Turso since SQLite files aren't persistent in serverless functions.

## Step 2: Configure Environment Variables

Set these in Vercel Dashboard → Settings → Environment Variables (for Production):

### Required Variables

1. **Database Connection** (choose one):

   **Option A: Turso (Recommended)**
   ```
   TURSO_DATABASE_URL=libsql://your-database-url.turso.io
   TURSO_AUTH_TOKEN=your-turso-auth-token
   ```

   **Option B: SQLite** (not recommended for production)
   ```
   PUBLIC_DB_PATH=/tmp/public_site.db
   ```
   Note: SQLite files in `/tmp` are ephemeral and will be lost between deployments.

2. **Configuration** (choose one):

   **Option A: JSON Config** (Recommended)
   ```
   CONFIG_JSON={"security":{"jwt_secret":"your-secret"},"storage":{"type":"cdn","public_url":"https://your-cdn.com"},"similarity":{"threshold":13}}
   ```

   **Option B: Config File Path**
   ```
   CONFIG_PATH=/path/to/config.yaml
   ```
   Note: File paths won't work on Vercel unless you include the file in your deployment.

### Optional Variables

- `VERCEL` - Automatically set by Vercel (don't set manually)

## Step 3: Verify API Endpoint

The search endpoint `/api/public/search` should be accessible via:

1. **Check `api/index.py`** exists and exports the FastAPI app:
   ```python
   from main import app
   ```

2. **Check `vercel.json`** has the rewrite rule:
   ```json
   {
     "rewrites": [
       {
         "source": "/api/(.*)",
         "destination": "/api/index.py"
       }
     ]
   }
   ```

3. **Test the endpoint** after deployment:
   ```bash
   curl https://your-site.vercel.app/api/public/search?q=dublin
   ```

## Step 4: Verify Search JavaScript

The search page uses `static/js/search.js` which:
- Uses `API_BASE = ''` (relative URLs, same origin)
- Falls back to API search if static index isn't available
- Calls `/api/public/search` endpoint

Verify the search page HTML includes:
```html
<script src="/static/js/search.js"></script>
```

## Step 5: Deploy and Test

1. **Deploy to production**:
   ```bash
   vercel --prod
   ```

2. **Test search endpoint**:
   ```bash
   # Test basic search
   curl "https://your-site.vercel.app/api/public/search?q=dublin"
   
   # Test with filters
   curl "https://your-site.vercel.app/api/public/search?q=dublin&roll_date=1980-01-01"
   ```

3. **Test search page**:
   - Navigate to `https://your-site.vercel.app/search`
   - Enter a search query
   - Verify results appear

## Troubleshooting

### Search returns empty results

1. **Check database connection**:
   ```bash
   # Test database endpoint
   curl https://your-site.vercel.app/api/public/stats
   ```
   If this fails, check your `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.

2. **Check FTS5 table exists and is populated**:
   ```bash
   turso db shell public-site-db
   ```
   ```sql
   SELECT COUNT(*) FROM scenes_fts;
   SELECT COUNT(*) FROM scenes;
   ```
   Both counts should be similar (FTS5 should have entries for all scenes).

3. **Check logs**:
   - Go to Vercel Dashboard → Your Project → Functions
   - Check function logs for errors

### Search endpoint returns 404

1. **Verify `api/index.py` exists** and is committed to git
2. **Check `vercel.json`** rewrite rules
3. **Verify Python runtime** is configured correctly

### Search endpoint returns 500

1. **Check function logs** in Vercel dashboard
2. **Verify database connection** (check environment variables)
3. **Check if FTS5 table exists** in database

### CORS errors

The API should handle CORS automatically via FastAPI middleware. If you see CORS errors:
- Check that requests are going to the same origin (relative URLs)
- Verify CORS middleware is configured in `main.py`

## Quick Checklist

- [ ] Database (Turso) is set up and accessible
- [ ] FTS5 virtual table (`scenes_fts`) exists and is populated
- [ ] Environment variables are set in Vercel (Production):
  - [ ] `TURSO_DATABASE_URL`
  - [ ] `TURSO_AUTH_TOKEN`
  - [ ] `CONFIG_JSON` (or `CONFIG_PATH`)
- [ ] `api/index.py` exists and exports the FastAPI app
- [ ] `vercel.json` has correct rewrite rules
- [ ] Deployed to production (`vercel --prod`)
- [ ] Tested `/api/public/search` endpoint
- [ ] Tested search page in browser

## Additional Notes

- The search uses **FTS5** (SQLite full-text search) which requires the `scenes_fts` virtual table
- Search results are filtered to only show scenes with **live versions** (where `r2_key IS NOT NULL`)
- The search endpoint supports faceted filtering by `roll_number`, `roll_date`, `batch_name`, and `date_source`
- Search suggestions endpoint is available at `/api/public/search/suggestions`


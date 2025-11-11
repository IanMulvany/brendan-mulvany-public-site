# Public Site Quick Start Guide

Get the public site up and running with local storage testing in minutes.

## Prerequisites

- Python 3.11+ with `uv` package manager
- Local image archive in `images/` directory
- Batches configured for public access

## Step 1: Configure Storage

Edit `public-site/config.yaml`:

```yaml
storage:
  type: local
  base_path: "./storage-test"
```

This sets up local filesystem storage (mocking R2) in the `storage-test/` directory.

## Step 2: Configure Public Batches

Mark which batches should be synced to the public site:

```bash
cd code
python public_site_batch_manager_app.py
```

Or manually:
```bash
sqlite3 code/public_site_batch_config.db \
  "UPDATE public_site_batches SET is_public = 1 WHERE batch_name = '2025-11-04-batch-1';"
```

## Step 3: Sync Database and Images

Run the sync script to populate the database and upload images:

```bash
cd public-site

# Full sync
python sync.py --images-dir ../images

# Sync specific batch
python sync.py --images-dir ../images --batch 2025-11-04-batch-1

# Dry run first (see what would happen)
python sync.py --images-dir ../images --dry-run
```

This will:
- ✅ Scan public batches
- ✅ Create scene records in database
- ✅ Create version records for all processing stages
- ✅ Upload current versions to `storage-test/scenes/`
- ✅ Mark versions as "live" in database

## Step 4: Start the App

```bash
cd public-site
uv run python main.py
```

Or use the convenience script:
```bash
./public-site/run.sh
```

The app will start on `http://localhost:8001`

## Step 5: Verify

1. **Check database**:
```bash
sqlite3 public-site/public_site.db \
  "SELECT COUNT(*) FROM scenes; SELECT COUNT(*) FROM image_versions WHERE r2_key IS NOT NULL;"
```

2. **Check storage**:
```bash
ls -la storage-test/scenes/
```

3. **Check API**:
```bash
curl http://localhost:8001/api/public/stats
curl http://localhost:8001/api/public/scenes?limit=5
```

## Common Workflows

### Update an Image

1. Update the image file in your local archive
2. Re-sync:
```bash
python sync.py --images-dir ../images --batch 2025-11-04-batch-1
```

The old version's `r2_key` will be cleared, and the new version will be uploaded.

### Add a New Batch

1. Mark batch as public (via batch manager or database)
2. Sync:
```bash
python sync.py --images-dir ../images --batch NEW-BATCH-NAME
```

### Sync Only Database (No Image Upload)

```bash
python sync.py --images-dir ../images --db-only
```

### Sync Only Images (Skip Database)

```bash
python sync.py --images-dir ../images --images-only
```

## Testing Image Updates

1. **Initial sync**:
```bash
python sync.py --images-dir ../images --batch 2025-11-04-batch-1
```

2. **Modify an image** (e.g., improve crop):
```bash
# Edit the image file
cp images/2025-11-04-batch-1/final_crops/DSCF1487_cropped.jpg \
   images/2025-11-04-batch-1/final_crops/DSCF1487_cropped.jpg.backup
# ... make edits ...
```

3. **Re-sync**:
```bash
python sync.py --images-dir ../images --batch 2025-11-04-batch-1
```

4. **Verify update**:
```bash
# Check database shows new version
sqlite3 public-site/public_site.db \
  "SELECT version_id, r2_key, synced_at FROM image_versions WHERE scene_id LIKE '2025-11-04-batch-1-DSCF1487%' ORDER BY synced_at DESC;"
```

## API Sync (Alternative)

You can also sync via the API (requires admin login):

```bash
# Login
TOKEN=$(curl -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}' \
  | jq -r '.token')

# Run sync
curl -X POST http://localhost:8001/api/admin/sync \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"batch_filter": ["2025-11-04-batch-1"], "dry_run": false}'
```

## Next Steps

- Read [SYNC_GUIDE.md](SYNC_GUIDE.md) for detailed documentation
- When ready for production, update `config.yaml` to use R2 storage
- Implement R2 backend in `storage.py` (see `R2StorageBackend` class)

## Troubleshooting

**Images not syncing?**
- Check batch is public: `SELECT * FROM code/public_site_batch_config.db WHERE batch_name = '...'`
- Check storage config: `cat config.yaml | grep -A 3 storage`
- Check sync logs: `sqlite3 public_site.db "SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 1;"`

**App not showing images?**
- Verify versions are live: `SELECT COUNT(*) FROM image_versions WHERE r2_key IS NOT NULL;`
- Check storage files exist: `ls storage-test/scenes/`
- Check app logs for errors


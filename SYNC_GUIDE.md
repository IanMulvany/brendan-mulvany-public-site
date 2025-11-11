# Public Site Sync Guide

Complete guide for syncing scenes and images to the public site, including database sync and image storage sync.

## Overview

The public site uses a two-phase sync process:
1. **Database Sync**: Scans local batches and populates the `scenes` and `image_versions` tables
2. **Image Sync**: Uploads current versions of images to storage (local filesystem for testing, R2 for production)

## Configuration

### Storage Configuration

Edit `public-site/config.yaml` to configure storage:

```yaml
storage:
  # For testing: use local filesystem
  type: local
  base_path: "./storage-test"
  
  # For production: use R2 (when ready)
  # type: r2
  # account_id: "your-cloudflare-account-id"
  # access_key_id: "your-r2-access-key-id"
  # secret_access_key: "your-r2-secret-access-key"
  # bucket_name: "your-bucket-name"
  # public_url: "https://your-cdn-domain.com"
```

### Batch Configuration

Images are synced based on the batch configuration database (`code/public_site_batch_config.db`). Only batches marked as `is_public = 1` will be synced.

To configure which batches are public, use the batch manager app:
```bash
cd code
python public_site_batch_manager_app.py
```

Or manually update the database:
```sql
UPDATE public_site_batches SET is_public = 1 WHERE batch_name = '2025-11-04-batch-1';
```

## Sync Methods

### Method 1: Command Line Script (Recommended)

The sync script provides full control and detailed logging:

```bash
cd public-site

# Full sync (database + images)
python sync.py --images-dir ../images

# Sync specific batch
python sync.py --images-dir ../images --batch 2025-11-04-batch-1

# Dry run (see what would be synced without actually doing it)
python sync.py --images-dir ../images --dry-run

# Database only (no image upload)
python sync.py --images-dir ../images --db-only

# Images only (skip database sync)
python sync.py --images-dir ../images --images-only
```

**Options:**
- `--images-dir PATH`: Path to images directory (default: `../images`)
- `--config PATH`: Path to config file (default: `config.yaml`)
- `--db PATH`: Path to database file (default: `public_site.db`)
- `--batch NAME`: Sync specific batch (can be used multiple times)
- `--dry-run`: Show what would be synced without actually syncing
- `--db-only`: Only sync database, skip image upload
- `--images-only`: Only sync images, skip database sync

### Method 2: API Endpoint (Admin Only)

Use the admin API endpoint for programmatic sync:

```bash
# Get admin token first
curl -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-password"}'

# Run sync
curl -X POST http://localhost:8001/api/admin/sync \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "batch_filter": ["2025-11-04-batch-1"],
    "dry_run": false,
    "db_only": false,
    "images_only": false
  }'
```

## Sync Workflow

### Step 1: Configure Storage

Edit `config.yaml` to set storage location:
```yaml
storage:
  type: local
  base_path: "./storage-test"
```

### Step 2: Configure Public Batches

Use the batch manager to mark batches as public, or update the database directly.

### Step 3: Run Sync

```bash
cd public-site
python sync.py --images-dir ../images
```

This will:
1. Scan all public batches in `../images/`
2. Identify scenes (unique moments) and versions (processing stages)
3. Populate database with scenes and versions
4. Determine current version for each scene (priority: final_crops > inverted > initial)
5. Upload current versions to storage
6. Mark versions as "live" (set `r2_key` in database)

### Step 4: Verify Sync

Check the sync status:
```bash
# Via API
curl http://localhost:8001/api/admin/sync/status

# Or check database
sqlite3 public_site.db "SELECT COUNT(*) FROM image_versions WHERE r2_key IS NOT NULL;"
```

## Storage Structure

### Local Storage (Testing)

When using local storage, images are stored in:
```
storage-test/
└── scenes/
    ├── 2025-11-04-batch-1-DSCF1487.jpg
    ├── 2025-11-04-batch-1-DSCF1488.jpg
    └── ...
```

### R2 Storage (Production)

When using R2, images are stored at:
```
r2://bucket/
└── scenes/
    ├── {scene_id}.jpg
    └── ...
```

## Database Schema

### Scenes Table
- `scene_id`: Stable identifier (e.g., "2025-11-04-batch-1-DSCF1487")
- `batch_name`: Batch directory name
- `base_filename`: Base filename (without suffixes)
- `capture_date`: Capture date if available

### Image Versions Table
- `version_id`: Unique version identifier
- `scene_id`: References scenes table
- `version_type`: 'initial_scan', 'inverted_original_scans', 'final_crops'
- `local_path`: Local filesystem path
- `r2_key`: Storage key (NULL if not synced, set when uploaded)
- `perceptual_hash`: pHash for similarity search
- `is_current`: Boolean flag (only one per scene should be TRUE)
- `synced_at`: Timestamp when uploaded

**Key Point**: Only versions with `r2_key IS NOT NULL` are considered "live" and available for similarity search.

## Updating Images

When you update an image (e.g., improve a crop or edit):

1. **Update local file**: Replace the file in your local archive
2. **Re-run sync**: The sync script will detect the change
3. **New version uploaded**: New version replaces old in storage
4. **Database updated**: Old version's `r2_key` is cleared, new version's is set

Example:
```bash
# After updating an image locally
python sync.py --images-dir ../images --batch 2025-11-04-batch-1
```

## Pulling Back Images

To download images from storage back to local:

```python
from storage import create_storage_backend
from config_manager import ConfigManager
from pathlib import Path

config = ConfigManager(Path("config.yaml"))
storage = create_storage_backend(config.get_storage_config())

# Download a scene
storage.download_file("scenes/2025-11-04-batch-1-DSCF1487.jpg", 
                      Path("downloaded_image.jpg"))
```

## Testing Scenarios

### Test 1: Initial Sync
```bash
# Sync one batch
python sync.py --images-dir ../images --batch 2025-11-04-batch-1 --dry-run
python sync.py --images-dir ../images --batch 2025-11-04-batch-1
```

### Test 2: Update Image
```bash
# 1. Update image locally
# 2. Re-sync
python sync.py --images-dir ../images --batch 2025-11-04-batch-1
```

### Test 3: Pull Back Images
```python
# Use Python to download from storage
from storage import create_storage_backend
from config_manager import ConfigManager
from pathlib import Path

config = ConfigManager(Path("public-site/config.yaml"))
storage = create_storage_backend(config.get_storage_config())

# List all scenes in storage
storage_path = Path(config.get_storage_config()['base_path'])
for scene_file in (storage_path / "scenes").glob("*.jpg"):
    print(f"Found: {scene_file.name}")
```

## Running the App

After syncing, start the app:

```bash
cd public-site
uv run python main.py
```

Or use the convenience script:
```bash
./public-site/run.sh
```

The app will:
- Serve images from storage (if available) or fall back to local paths
- Use database for scene metadata
- Only show scenes with live versions (`r2_key IS NOT NULL`)

## Troubleshooting

### Images not syncing
- Check batch is marked as public: `SELECT * FROM public_site_batches WHERE batch_name = '...'`
- Check storage config: `cat config.yaml | grep -A 5 storage`
- Check sync logs: `sqlite3 public_site.db "SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 1;"`

### Images not showing in app
- Verify version has `r2_key`: `SELECT scene_id, r2_key FROM image_versions WHERE is_current = 1 LIMIT 5;`
- Check storage file exists: `ls storage-test/scenes/`
- Check app logs for errors

### Similarity search not working
- Ensure versions have `perceptual_hash`: `SELECT COUNT(*) FROM image_versions WHERE perceptual_hash IS NOT NULL;`
- Ensure versions are live: `SELECT COUNT(*) FROM image_versions WHERE r2_key IS NOT NULL AND perceptual_hash IS NOT NULL;`

## Migration to R2

When ready to use R2:

1. **Update config.yaml**:
```yaml
storage:
  type: r2
  account_id: "your-account-id"
  access_key_id: "your-key-id"
  secret_access_key: "your-secret-key"
  bucket_name: "your-bucket"
  public_url: "https://your-cdn.com"
```

2. **Implement R2 backend**: Update `storage.py` to implement `R2StorageBackend` methods

3. **Re-sync**: Run sync again to upload to R2
```bash
python sync.py --images-dir ../images
```

The storage abstraction layer makes it easy to swap implementations - no other code changes needed!


# Configuration Guide

## Overview

The public site uses a YAML configuration file (`config.yaml`) to control which batches and directories are publicly visible. This allows you to:

- **Selectively publish** specific batches
- **Control directory visibility** (e.g., only show `final_crops`, not `inverted_original_scans`)
- **Easily add/remove batches** without code changes
- **Minimize costs** by only serving configured content

## Configuration File

Location: `public-site/config.yaml`

### Basic Structure

```yaml
settings:
  restrict_to_listed: true  # If false, shows all batches
  cache_ttl: 3600          # Cache TTL in seconds

batches:
  - batch_name: "2025-11-03-batch-1"
    enabled: true
    directories:
      - "final_crops"
    notes: "First test batch"

directory_aliases:
  "final_crops": "Final Images"

batch_metadata:
  - batch_name: "2025-11-03-batch-1"
    display_name: "November 1965 - Family Photos"
    featured: true
```

## Settings

### `restrict_to_listed`

- **`true`**: Only batches explicitly listed in `batches` are shown
- **`false`**: All batches are shown (default behavior, filters to `final_crops` only)

### `cache_ttl`

How long to cache batch availability checks (in seconds). Default: 3600 (1 hour).

## Batch Configuration

Each batch entry has:

- **`batch_name`**: Must match the directory name in `images/`
- **`enabled`**: `true` to show, `false` to hide
- **`directories`**: List of subdirectories to include (e.g., `["final_crops"]`)
- **`notes`**: Optional description

### Examples

**Single directory:**
```yaml
- batch_name: "2025-11-03-batch-1"
  enabled: true
  directories:
    - "final_crops"
```

**Multiple directories:**
```yaml
- batch_name: "2025-11-04-batch-1"
  enabled: true
  directories:
    - "final_crops"
    - "inverted_original_scans"
```

**Disabled batch:**
```yaml
- batch_name: "2025-11-05-batch-1"
  enabled: false
  directories:
    - "final_crops"
  notes: "Not ready for public yet"
```

## Directory Aliases

Rename directories for display purposes:

```yaml
directory_aliases:
  "final_crops": "Final Images"
  "inverted_original_scans": "Inverted Negatives"
```

## Batch Metadata

Override display information:

```yaml
batch_metadata:
  - batch_name: "2025-11-03-batch-1"
    display_name: "November 1965 - Family Photos"
    description: "Family gathering photos from November 1965"
    featured: true
```

## Managing Configuration

### Via File (Recommended)

1. Edit `public-site/config.yaml`
2. Reload via admin API: `POST /api/admin/config/reload`
3. Or restart the server

### Via API (Admin Only)

**Get current config:**
```bash
GET /api/admin/config
Authorization: Bearer <admin_token>
```

**Update batch:**
```bash
PUT /api/admin/config/batches/{batch_name}
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "enabled": true,
  "directories": ["final_crops"],
  "notes": "Updated batch"
}
```

**Remove batch:**
```bash
DELETE /api/admin/config/batches/{batch_name}
Authorization: Bearer <admin_token>
```

**Reload config:**
```bash
POST /api/admin/config/reload
Authorization: Bearer <admin_token>
```

## Cost Optimization

### How It Works

1. **Config-based filtering**: Only images matching config are returned
2. **Caching**: Batch availability is cached (reduces file system checks)
3. **Early filtering**: Images filtered before database queries when possible
4. **No re-sync needed**: Changes to config take effect immediately

### Best Practices

1. **Start restrictive**: Set `restrict_to_listed: true` and explicitly list batches
2. **Use specific directories**: Only include `final_crops` unless you need others
3. **Disable, don't delete**: Set `enabled: false` instead of removing (easier to re-enable)
4. **Cache appropriately**: Adjust `cache_ttl` based on how often you change config

## Example Workflows

### Adding a New Batch

1. Process batch (create `final_crops/` directory)
2. Add to config:
   ```yaml
   - batch_name: "2025-11-07-batch-1"
     enabled: true
     directories:
       - "final_crops"
   ```
3. Reload config (API or restart)
4. Batch appears immediately

### Removing a Batch

**Option 1: Disable**
```yaml
- batch_name: "2025-11-03-batch-1"
  enabled: false  # Just disable
```

**Option 2: Remove from config**
- Delete the batch entry from `batches:`
- Or use API: `DELETE /api/admin/config/batches/{batch_name}`

### Changing Directory

```yaml
- batch_name: "2025-11-03-batch-1"
  enabled: true
  directories:
    - "inverted_original_scans"  # Changed from final_crops
```

## Troubleshooting

**Batch not showing?**
- Check `enabled: true`
- Verify `batch_name` matches directory name exactly
- Check `restrict_to_listed` setting
- Ensure directory exists in filesystem

**Images not loading?**
- Verify directory is in `directories` list
- Check image paths in database match filesystem
- Check file permissions

**Config not updating?**
- Reload config via API or restart server
- Check YAML syntax (use a validator)
- Check file permissions on `config.yaml`

## Migration from No Config

If you're upgrading from a version without config:

1. Create `config.yaml` with `restrict_to_listed: false` (shows all)
2. Gradually add batches to config
3. Set `restrict_to_listed: true` when ready


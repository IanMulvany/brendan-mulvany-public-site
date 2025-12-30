# Setup Instructions

This document explains how to set up the public site for development or production.

## Quick Start

1. **Copy the example configuration:**
   ```bash
   cp config.yaml.example config.yaml
   ```

2. **Generate a secure JWT secret:**
   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

3. **Edit `config.yaml` and update:**
   - Set `security.jwt_secret` to the generated secret
   - Configure storage settings (local path or R2 credentials)
   - Adjust similarity threshold if needed

4. **Initialize the database:**
   ```bash
   # The database will be created automatically on first run
   # Or you can copy the demo database structure:
   python3 create_demo_db.py  # This creates demo.db as reference
   ```

5. **Run the application:**
   ```bash
   ./run.sh
   ```

## Configuration Files

### `config.yaml.example`
- Example configuration file (safe to commit to git)
- Contains placeholder values and documentation
- Copy this to `config.yaml` or `config.local.yaml`

### `config.yaml` or `config.local.yaml`
- Your actual configuration (excluded from git)
- Contains sensitive values like JWT secrets
- The app prefers `config.local.yaml` if it exists, then falls back to `config.yaml`

### Configuration Options

```yaml
# Security settings (REQUIRED)
security:
  jwt_secret: "your-secure-secret-here"

# Storage settings
storage:
  type: local  # or 'r2' for production
  base_path: "./storage-test"  # for local storage
  # R2 settings (when type: r2)
  # account_id: "..."
  # access_key_id: "..."
  # secret_access_key: "..."
  # bucket_name: "..."
  # public_url: "https://..."

# Similarity search
similarity:
  threshold: 13  # Hamming distance (0-16)
```

## Database Files

### `demo.db`
- Empty database with correct schema
- Safe to commit to git
- Created by `create_demo_db.py`
- Used as schema reference

### `public_site.db`
- Your actual working database (excluded from git)
- Contains real user data, scenes, and versions
- Will be created automatically on first run

## Security Notes

⚠️ **Never commit these files to git:**
- `config.yaml` or `config.local.yaml` (contains secrets)
- `public_site.db` (contains user data)
- `__pycache__/` (Python cache)
- Any `.env` files

✅ **Safe to commit:**
- `config.yaml.example` (has placeholders)
- `demo.db` (empty reference database)
- `.gitignore` (protects sensitive files)

## Production Deployment

1. Generate a strong JWT secret (at least 32 bytes)
2. Configure R2 storage for production
3. Use environment-specific config files
4. Set up proper backup for `public_site.db`
5. Use HTTPS for all connections
6. Review CORS settings in `main.py`

## Development vs Production

### Development
- Use `config.local.yaml`
- Use local storage (`storage.type: local`)
- Database: `public_site.db` (local)

### Production
- Use `config.yaml` (deployed securely)
- Use R2 storage (`storage.type: r2`)
- Database: Managed instance with backups
- Strong JWT secret (32+ bytes)

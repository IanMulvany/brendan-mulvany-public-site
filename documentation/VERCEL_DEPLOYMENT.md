# Vercel Deployment Guide

Complete guide for deploying the public site to Vercel with a custom domain (Hover registration, Cloudflare DNS).

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Database Setup](#database-setup)
3. [Local Development Setup](#local-development-setup)
4. [Vercel Deployment](#vercel-deployment)
5. [Custom Domain Setup](#custom-domain-setup)
6. [Environment Variables](#environment-variables)
7. [Initial Admin Setup](#initial-admin-setup)
8. [Testing](#testing)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Vercel account (free tier works)
- Domain registered with Hover
- Cloudflare account (free tier works)
- Database solution (see [Database Setup](#database-setup))

---

## Database Setup

Vercel's serverless functions don't support persistent SQLite files. You have two options:

### Option 1: Turso (Recommended - SQLite Compatible)

Turso provides serverless SQLite databases that work seamlessly with your existing code.

1. **Sign up for Turso**: https://turso.tech
2. **Create a database**:
   ```bash
   # Install Turso CLI
   curl -sSfL https://get.turso.tech/install.sh | bash
   
   # Login
   turso auth login
   
   # Create database
   turso db create public-site-db
   
   # Create database token
   turso db tokens create public-site-db
   ```

3. **Get connection details**:
   ```bash
   # Get database URL
   turso db show public-site-db
   
   # Save the URL and token for environment variables
   ```

4. **Update your code** (if needed):
   - Turso uses `libsql` which is SQLite-compatible
   - You may need to install: `pip install libsql-experimental`
   - Update `database.py` to use Turso connection if needed

### Option 2: Vercel Postgres

Vercel Postgres is fully managed but requires schema migration.

1. **Create Vercel Postgres**:
   - Go to your Vercel project dashboard
   - Navigate to Storage → Create Database → Postgres
   - Choose a name and region

2. **Migrate schema**:
   - Convert SQLite schema to Postgres
   - Use Vercel's database dashboard to run SQL

### Option 3: External SQLite Database

You can host SQLite files externally and download them on cold starts (not recommended for production).

---

## Local Development Setup

### 1. Install Dependencies

```bash
# Using uv (recommended)
uv venv
uv pip install -r requirements.txt

# Or using pip
pip install -r requirements.txt
```

**Note**: The `requirements.txt` includes all necessary dependencies including `email-validator` (required for Pydantic's `EmailStr` validation).

### 2. Configure Local Database

The app automatically uses local SQLite files when not on Vercel:

- `public_site.db` - Public site database (created automatically)
- `code/bm_image_archive.db` - Archive database (optional, for some features)

### 3. Create Config File

```bash
cp config.yaml.example config.local.yaml
```

Edit `config.local.yaml`:

```yaml
security:
  jwt_secret: "your-local-secret-here"

storage:
  type: local  # or 'cdn' for testing CDN redirects
  base_path: "./storage-test"
```

### 4. Run Locally

```bash
# Using the run script
./run.sh

# Or directly
uv run python main.py
```

The app will run on `http://localhost:8001` (or port specified by FastAPI).

---

## Vercel Deployment

### 1. Install Vercel CLI

```bash
npm i -g vercel
```

### 2. Login to Vercel

```bash
vercel login
```

### 3. Initialize Project

```bash
cd /path/to/brendan-mulvany-public-site
vercel
```

Follow the prompts:
- Set up and deploy? **Yes**
- Which scope? (select your account)
- Link to existing project? **No**
- Project name? (e.g., `brendan-mulvany-public-site`)
- Directory? **./** (current directory)
- Override settings? **No**

### 4. Configure Environment Variables

Set environment variables in Vercel dashboard or via CLI:

```bash
# Required: Config as JSON (or use CONFIG_PATH)
# Note: JWT_SECRET should be included in CONFIG_JSON, not as a separate variable
vercel env add CONFIG_JSON production
# Enter your config as JSON string (see below)

# Database (if using Turso)
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production

# Optional: Custom database paths
vercel env add PUBLIC_DB_PATH production
# Default: /tmp/public_site.db
```

### 5. Config JSON Format

For `CONFIG_JSON`, convert your `config.yaml` to JSON:

```json
{
  "security": {
    "jwt_secret": "your-production-secret"
  },
  "storage": {
    "type": "cdn",
    "public_url": "https://your-cdn-domain.com"
  },
  "similarity": {
    "threshold": 13
  }
}
```

**Or** upload `config.yaml` and set `CONFIG_PATH` environment variable pointing to it.

### 6. Verify Handler Export

The `api/index.py` file exports the FastAPI app correctly:
```python
from main import app
handler = app
```

This format works with Vercel's `@vercel/python` runtime for FastAPI applications.

### 7. Deploy

```bash
# Deploy to production
vercel --prod

# Or deploy preview
vercel
```

---

## Custom Domain Setup

### 1. Add Domain in Vercel

1. Go to your project in Vercel dashboard
2. Navigate to **Settings** → **Domains**
3. Click **Add Domain**
4. Enter your domain (e.g., `photos.example.com`)
5. Vercel will show DNS configuration needed

### 2. Configure Cloudflare DNS

Since your domain is registered with Hover but DNS is managed by Cloudflare:

1. **Log into Cloudflare Dashboard**
2. **Select your domain**
3. **Go to DNS** → **Records**
4. **Add CNAME record**:
   - **Type**: CNAME
   - **Name**: `photos` (or `@` for root domain)
   - **Target**: `cname.vercel-dns.com` (or the value Vercel provides)
   - **Proxy status**: Proxied (orange cloud) or DNS only (gray cloud)
   - **TTL**: Auto

5. **If using root domain**, also add:
   - **Type**: A
   - **Name**: `@`
   - **Target**: `76.76.21.21` (Vercel's IP - check Vercel docs for current IP)
   - **Proxy status**: DNS only (gray cloud)

### 3. SSL/TLS Settings

1. In Cloudflare dashboard, go to **SSL/TLS**
2. Set encryption mode to **Full** or **Full (strict)**
3. Vercel will automatically provision SSL certificates

### 4. Wait for Propagation

- DNS changes can take 5-60 minutes to propagate
- Check status in Vercel dashboard
- Use `dig photos.example.com` to verify DNS

---

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `CONFIG_JSON` | Config as JSON string (includes JWT_SECRET) | `{"security": {"jwt_secret": "..."}, ...}` |

**Note**: The `VERCEL` environment variable is automatically set by Vercel (no need to configure it).

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CONFIG_PATH` | Path to config.yaml file | `./config.yaml` |
| `PUBLIC_DB_PATH` | Path to public site database | `/tmp/public_site.db` |
| `ARCHIVE_DB_PATH` | Path to archive database | `/tmp/bm_image_archive.db` |
| `TURSO_DATABASE_URL` | Turso database URL | None |
| `TURSO_AUTH_TOKEN` | Turso auth token | None |

### Setting Variables

**Via Vercel Dashboard**:
1. Project → Settings → Environment Variables
2. Add variable for each environment (Production, Preview, Development)

**Via CLI**:
```bash
vercel env add VARIABLE_NAME production
```

**Bulk import** (create `.env.production`):
```bash
vercel env pull .env.production
# Edit file
vercel env push .env.production
```

---

## Testing

### Local Testing

```bash
# Run locally
./run.sh

# Test endpoints
curl http://localhost:8001/api/public/stats
```

### Vercel Preview Testing

After deploying:
```bash
# Get preview URL from Vercel output
curl https://your-project.vercel.app/api/public/stats
```

### Production Testing

```bash
# Test production domain
curl https://photos.example.com/api/public/stats
```

---

## Troubleshooting

### Database Connection Issues

**Problem**: Database not found or connection errors

**Solutions**:
- Verify environment variables are set correctly
- Check database path is accessible
- For Turso: verify URL and token are correct
- Check Vercel function logs: `vercel logs`

### Static Files Not Loading

**Problem**: CSS/JS files return 404

**Solutions**:
- Verify `static/` directory is in repository
- Check `vercel.json` routes configuration
- Ensure files are not in `.vercelignore`

### Config Not Loading

**Problem**: Config errors or defaults being used

**Solutions**:
- Verify `CONFIG_JSON` is valid JSON
- Check `CONFIG_PATH` points to correct file
- Review Vercel function logs for config errors

### CORS Issues

**Problem**: CORS errors in browser

**Solutions**:
- Update `allow_origins` in `main.py` to include your domain
- Check Cloudflare proxy settings (may affect CORS)

### Domain Not Resolving

**Problem**: Domain shows "not found" or doesn't connect

**Solutions**:
- Verify DNS records in Cloudflare
- Check domain is added in Vercel dashboard
- Wait for DNS propagation (can take up to 24 hours)
- Use `dig` or `nslookup` to verify DNS

### Function Timeout

**Problem**: Requests timeout or take too long

**Solutions**:
- Optimize database queries
- Use connection pooling for database
- Consider upgrading Vercel plan for longer timeouts
- Check function logs for slow operations

---

## Project Structure

```
brendan-mulvany-public-site/
├── api/
│   └── index.py          # Vercel serverless handler
├── static/               # Static files (CSS, JS, images)
├── templates/            # HTML templates
├── main.py              # FastAPI application
├── database.py          # Database utilities
├── config_manager.py    # Config management
├── storage.py           # Storage backend abstraction
├── vercel.json          # Vercel configuration
├── requirements.txt     # Python dependencies
├── .vercelignore        # Files to exclude from deployment
└── config.yaml.example  # Example configuration
```

---

## Initial Admin Setup

After deploying for the first time, you need to create an admin user to access admin endpoints (like `/api/admin/sync/data`).

### Understanding Authentication

The app uses **JWT Bearer tokens** for authentication (not separate API keys):
1. Admin users log in via `/api/auth/login` to get a JWT token
2. That token is used as a `Bearer` token in the `Authorization` header for admin endpoints
3. The sync endpoint `/api/admin/sync/data` requires an admin user's JWT token

### Option 1: Setup Script (For Local SQLite)

Use the `setup_admin.py` script to create your first admin user:

**Interactive mode:**

```bash
python setup_admin.py
```

**Non-interactive mode:**

```bash
python setup_admin.py \
  --username "admin" \
  --email "your@email.com" \
  --password "secure-password"
```

**Specify database path:**

```bash
python setup_admin.py \
  --db-path "/path/to/public_site.db" \
  --username "admin" \
  --email "your@email.com" \
  --password "secure-password"
```

**Note:** This script works with local SQLite files. For Turso databases, use Option 2 below.

### Option 2: Direct Database Access (Turso/libSQL)

For Turso databases, use the Turso CLI to connect and insert the admin user:

**Step 1: Generate password hash**

```python
import bcrypt
password = "your-secure-password"
password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
print(password_hash)
```

**Step 2: Connect to Turso database**

```bash
# Connect to your database
turso db shell public-site-db
```

**Step 3: Insert admin user**

```sql
-- Replace the password_hash with the value from Step 1
INSERT INTO users (username, email, password_hash, role)
VALUES (
  'admin',
  'your@email.com',
  '$2b$12$...your-bcrypt-hash-here...',
  'admin'
);
```

**Alternative: One-liner with Turso CLI**

```bash
# Generate hash and insert in one go (requires Python)
python3 -c "
import bcrypt
import sys
password = sys.argv[1]
hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
print('INSERT INTO users (username, email, password_hash, role) VALUES (\"admin\", \"your@email.com\", \"' + hash + '\", \"admin\");')
" "your-password" | turso db shell public-site-db
```

**For local SQLite files:**

You can also use SQLite directly:

```bash
sqlite3 public_site.db
```

Then run the same INSERT statement (with bcrypt hash generated from Python).

### Option 3: One-Time Setup Endpoint (Less Secure)

For convenience, you could add a one-time setup endpoint that creates the first admin user if none exists. This is less secure and should be removed after initial setup.

### After Creating Admin User

1. **Log in to get JWT token:**

```bash
curl -X POST https://your-domain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your-password"
  }'
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "username": "admin",
    "email": "your@email.com",
    "role": "admin"
  }
}
```

2. **Use token for admin endpoints:**

```bash
# Example: Sync data
curl -X POST https://your-domain.com/api/admin/sync/data \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scenes": [...],
    "dry_run": false
  }'
```

### Security Notes

- **Never commit admin credentials** to version control
- **Use strong passwords** for admin accounts
- **Rotate JWT secrets** if compromised (update `CONFIG_JSON` in Vercel)
- **Limit admin access** - only create admin users for trusted accounts
- **Consider removing setup endpoints** after initial deployment

---

## Next Steps

1. **Set up database** (Turso recommended)
2. **Configure environment variables** in Vercel
3. **Deploy to Vercel**
4. **Create admin user** (see [Initial Admin Setup](#initial-admin-setup))
5. **Add custom domain** in Vercel
6. **Configure DNS** in Cloudflare
7. **Test production deployment**
8. **Set up CI/CD** (optional - Vercel auto-deploys on git push)

---

## Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Turso Documentation](https://docs.turso.tech)
- [Cloudflare DNS Guide](https://developers.cloudflare.com/dns/)
- [FastAPI Deployment](https://fastapi.tiangolo.com/deployment/)

---

## Support

For issues specific to this deployment:
1. Check Vercel function logs: `vercel logs`
2. Review environment variables
3. Test locally first to isolate issues
4. Check Cloudflare DNS configuration


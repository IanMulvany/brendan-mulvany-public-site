# Public Site - Local Development

This is the public-facing website for the Brendan Mulvany Photo Archive.

## Features

- Browse cropped inverted images
- Full metadata search
- User accounts and authentication
- Annotations and comments on photos
- Responsive, accessible design
- Semantic HTML with BEM CSS naming

## Setup

### 1. Install Dependencies

```bash
uv sync
```

### 2. Create Admin User (Optional)

You can create an admin user directly in the database or via the API after starting the server.

### 3. Run the Server

```bash
cd public-site
uv run python main.py
```

The server will start on `http://localhost:8001`

## API Endpoints

### Public Endpoints

- `GET /api/public/images` - List images (paginated)
- `GET /api/public/images/{id}` - Get image details
- `GET /api/public/images/{id}/image` - Serve full-size image
- `GET /api/public/images/{id}/thumbnail` - Serve thumbnail
- `GET /api/public/search?q=query` - Search images
- `GET /api/public/stats` - Get site statistics

### Authentication Endpoints

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login (get JWT token)
- `GET /api/auth/me` - Get current user (requires auth)

### Annotation Endpoints (Requires Auth)

- `POST /api/annotations` - Create annotation
- `GET /api/annotations/{image_id}` - Get annotations for image
- `PUT /api/annotations/{id}` - Update annotation
- `DELETE /api/annotations/{id}` - Delete annotation

### Admin Endpoints (Requires Admin Role)

- `POST /api/admin/sync` - Sync metadata from local archive
- `GET /api/admin/sync/status` - Get sync status

## Database

The public site uses a separate SQLite database (`public_site.db`) for:
- User accounts
- Annotations
- Sync logs

The archive database (`code/bm_image_archive.db`) is read-only for image metadata.

## Configuration

The public site uses `config.yaml` to control which batches and directories are publicly visible. See `CONFIG_GUIDE.md` for details.

**Quick start:**
1. Edit `public-site/config.yaml`
2. List batches you want to make public
3. Specify which directories (e.g., `final_crops`) to include
4. Reload config via API: `POST /api/admin/config/reload` (admin only)

**Default behavior:**
- If `restrict_to_listed: false`, all batches with `final_crops` are shown
- If `restrict_to_listed: true`, only explicitly listed batches are shown

## Development Notes

- Images are served from the `images/` directory
- Only images in `final_crops/` subdirectories are shown
- JWT tokens expire after 24 hours
- Passwords are hashed with bcrypt

## Production Deployment

See `PUBLIC_SITE_ARCHITECTURE.md` for deployment recommendations.


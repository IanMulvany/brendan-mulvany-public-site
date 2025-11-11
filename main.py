"""
Public Site API Server
FastAPI backend for public-facing photo archive website
"""

from fastapi import FastAPI, HTTPException, Depends, Request, Query
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel, EmailStr
from pathlib import Path
import sqlite3
import json
import logging
from typing import List, Optional, Dict
from datetime import datetime
import jwt
import bcrypt
import hashlib
from functools import wraps

# Import database classes
import sys
from pathlib import Path

# Add paths for imports
CURRENT_DIR = Path(__file__).parent
CODE_DIR = CURRENT_DIR.parent / "code"
sys.path.insert(0, str(CODE_DIR))
sys.path.insert(0, str(CURRENT_DIR))

from database import PublicSiteDatabase
from webapp.database import Database as ArchiveDatabase
from config_manager import ConfigManager
from storage import create_storage_backend

# Configuration
BASE_DIR = Path(__file__).parent.parent
IMAGES_DIR = BASE_DIR / "images"
ARCHIVE_DB = BASE_DIR / "code" / "bm_image_archive.db"
PUBLIC_DB = BASE_DIR / "public-site" / "public_site.db"
STATIC_DIR = BASE_DIR / "public-site" / "static"
TEMPLATES_DIR = BASE_DIR / "public-site" / "templates"

# Try to load config from config.local.yaml first (local development), then config.yaml
CONFIG_PATH = BASE_DIR / "public-site" / "config.local.yaml"
if not CONFIG_PATH.exists():
    CONFIG_PATH = BASE_DIR / "public-site" / "config.yaml"

# JWT algorithm
JWT_ALGORITHM = "HS256"

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Brendan Mulvany Photo Archive - Public Site",
    description="Public-facing website for photo archive",
    version="0.1.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify actual origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Initialize databases and config
public_db = PublicSiteDatabase(PUBLIC_DB)
archive_db = ArchiveDatabase(ARCHIVE_DB)
config_manager = ConfigManager(CONFIG_PATH)

# Get JWT secret from config
JWT_SECRET = config_manager.get_jwt_secret()

# Initialize storage backend
storage_config = config_manager.get_storage_config()
try:
    storage_backend = create_storage_backend(storage_config)
except Exception as e:
    logger.error(f"Failed to initialize storage backend: {e}")
    storage_backend = None

# Security
security = HTTPBearer()


# Pydantic models
class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    username: str
    password: str


class AnnotationCreate(BaseModel):
    image_id: int
    annotation_type: str  # 'comment', 'person_name', 'tag', 'correction'
    content: str
    metadata: Optional[Dict] = None


class AnnotationUpdate(BaseModel):
    content: str


# Auth helpers
def hash_password(password: str) -> str:
    """Hash a password using bcrypt"""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against a hash"""
    return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))


def create_token(user_id: int, username: str, role: str) -> str:
    """Create a JWT token"""
    payload = {
        "user_id": user_id,
        "username": username,
        "role": role,
        "exp": datetime.utcnow().timestamp() + 86400  # 24 hours
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> Optional[Dict]:
    """Verify a JWT token"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Dict:
    """Get current user from JWT token"""
    token = credentials.credentials
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    user = public_db.get_user_by_id(payload["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    
    return user


def get_current_user_optional(request: Request) -> Optional[Dict]:
    """Get current user if token is present, otherwise None"""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    
    token = auth_header.split(" ")[1]
    payload = verify_token(token)
    if not payload:
        return None
    
    return public_db.get_user_by_id(payload["user_id"])


def scene_id_to_image_id(scene_id: str) -> int:
    """Convert scene_id to image_id using deterministic hash"""
    # Use MD5 for deterministic hashing (same input = same output)
    md5_hash = hashlib.md5(scene_id.encode('utf-8')).hexdigest()
    # Convert to integer and mod to get 9-digit number
    return int(md5_hash[:8], 16) % (10**9)


def image_id_to_scene_id(image_id: int) -> Optional[str]:
    """Find scene_id that hashes to the given image_id"""
    # Get all scenes and find the one that hashes to this image_id
    all_scenes = public_db.get_scenes(batch_name=None, limit=10000, offset=0)
    
    for scene in all_scenes:
        if scene_id_to_image_id(scene['scene_id']) == image_id:
            return scene['scene_id']
    
    # If not found by scene_id hash, try to find by old method (file path hash)
    # This handles backward compatibility with old image_ids
    all_scenes_with_versions = []
    for scene in all_scenes:
        version = public_db.get_current_version_for_scene(scene['scene_id'])
        if version:
            all_scenes_with_versions.append((scene, version))
    
    for scene, version in all_scenes_with_versions:
        local_path = version.get('local_path', '')
        if local_path:
            # Try to reconstruct the old relative path format
            # Old format was: batch_name/source_dir/filename
            # Extract from local_path or construct from scene data
            try:
                path_obj = Path(local_path)
                if path_obj.is_absolute():
                    # Try to make it relative to IMAGES_DIR
                    try:
                        rel_path = path_obj.relative_to(IMAGES_DIR)
                    except ValueError:
                        # If not under IMAGES_DIR, construct from scene data
                        rel_path = Path(scene['batch_name']) / version.get('version_type', 'final_crops') / scene['base_filename']
                else:
                    rel_path = path_obj
                
                # Use MD5 hash like the old system (but old system used Python hash())
                # For backward compat, try both MD5 and check if it matches
                old_hash = int(hashlib.md5(str(rel_path).encode('utf-8')).hexdigest()[:8], 16) % (10**9)
                if old_hash == image_id:
                    return scene['scene_id']
            except Exception:
                continue
    
    return None


# Public endpoints
@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the main page"""
    return FileResponse(TEMPLATES_DIR / "index.html")


@app.get("/image/{image_id}", response_class=HTMLResponse)
async def image_page(image_id: int):
    """User-friendly image page"""
    return FileResponse(TEMPLATES_DIR / "image.html")


@app.get("/image_detail/{image_id}", response_class=HTMLResponse)
async def image_detail_page(image_id: int):
    """Technical detail page with all DB information"""
    return FileResponse(TEMPLATES_DIR / "image_detail.html")


@app.get("/roll/{roll_number}", response_class=HTMLResponse)
async def roll_page(roll_number: str):
    """Page showing all images from a roll"""
    return FileResponse(TEMPLATES_DIR / "roll.html")


@app.get("/search", response_class=HTMLResponse)
async def search_page():
    """Advanced search page with faceted filters"""
    return FileResponse(TEMPLATES_DIR / "search.html")


@app.get("/api/public/images")
async def list_images(
    limit: int = Query(1000, ge=1, le=10000),
    offset: int = Query(0, ge=0)
):
    """List public images (backward compatibility - uses scene-based data)"""
    # Get scenes from public-site database (scene-based architecture)
    all_scenes = public_db.get_scenes(batch_name=None, limit=limit * 2, offset=offset)
    
    # Convert scenes to old image format for backward compatibility
    public_images = []
    for scene in all_scenes:
        version = public_db.get_current_version_for_scene(scene['scene_id'])
        if not version:
            continue  # Skip scenes without live versions
        
        # Generate image_id from scene_id (backward compatibility)
        image_id = scene_id_to_image_id(scene['scene_id'])
        
        # Get local path for backward compatibility
        local_path = version.get('local_path', '')
        
        img_dict = {
            'image_id': image_id,
            'image_path': local_path,
            'image_name': scene['base_filename'],
            'image_url': f"/api/public/images/{image_id}/image",
            'thumbnail_url': f"/api/public/images/{image_id}/thumbnail",
            'bm_batch_year': '',
            'roll_number': '',
            'capture_date': scene.get('capture_date'),
            'bm_batch_note': scene['batch_name'],
            'scene_id': scene['scene_id']  # Include for reference
        }
        public_images.append(img_dict)
    
    # Apply limit
    public_images = public_images[:limit]
    
    return {
        "images": public_images,
        "total": len(public_images),
        "limit": limit,
        "offset": offset
    }


@app.get("/api/public/images/{image_id}")
async def get_image(image_id: int):
    """Get image details with all DB data (backward compatibility - uses scene-based lookup)"""
    # Find scene by image_id (image_id is hash of scene_id)
    scene_id = image_id_to_scene_id(image_id)
    
    if not scene_id:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # Get scene from database
    scene = public_db.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    # Get current version for scene
    version = public_db.get_current_version_for_scene(scene_id)
    if not version:
        raise HTTPException(status_code=404, detail="No live version found for scene")
    
    # Get ALL versions for this scene
    all_versions = public_db.get_all_versions_for_scene(scene_id)
    
    # Convert to old image format for backward compatibility
    image = {
        'image_id': image_id,
        'image_path': version.get('local_path', ''),
        'image_name': scene['base_filename'],
        'bm_batch_year': '',
        'roll_number': '',
        'capture_date': scene.get('capture_date'),
        'bm_batch_note': scene['batch_name'],
        'scene_id': scene_id,  # Include for reference
        # Add all DB data
        'scene': {
            'scene_id': scene['scene_id'],
            'batch_name': scene['batch_name'],
            'base_filename': scene['base_filename'],
            'capture_date': scene.get('capture_date'),
            'description': scene.get('description'),
            'description_model': scene.get('description_model'),
            'description_timestamp': scene.get('description_timestamp'),
            # Batch metadata
            'roll_number': scene.get('roll_number'),
            'roll_date': scene.get('roll_date'),
            'date_source': scene.get('date_source'),
            'date_notes': scene.get('date_notes'),
            'roll_comment': scene.get('roll_comment'),
            'index_book_number': scene.get('index_book_number'),
            'index_book_date': scene.get('index_book_date'),
            'index_book_comment': scene.get('index_book_comment'),
            'short_description': scene.get('short_description'),
            'created_at': scene.get('created_at'),
            'updated_at': scene.get('updated_at')
        },
        'current_version': {
            'version_id': version.get('version_id'),
            'version_type': version.get('version_type'),
            'local_path': version.get('local_path'),
            'r2_key': version.get('r2_key'),
            'perceptual_hash': version.get('perceptual_hash'),
            'md5_hash': version.get('md5_hash'),
            'file_size': version.get('file_size'),
            'width': version.get('width'),
            'height': version.get('height'),
            'is_current': version.get('is_current'),
            'created_at': version.get('created_at'),
            'synced_at': version.get('synced_at')
        },
        'all_versions': [
            {
                'version_id': v.get('version_id'),
                'version_type': v.get('version_type'),
                'local_path': v.get('local_path'),
                'r2_key': v.get('r2_key'),
                'perceptual_hash': v.get('perceptual_hash'),
                'md5_hash': v.get('md5_hash'),
                'file_size': v.get('file_size'),
                'width': v.get('width'),
                'height': v.get('height'),
                'is_current': v.get('is_current'),
                'created_at': v.get('created_at'),
                'synced_at': v.get('synced_at')
            }
            for v in all_versions
        ]
    }
    
    # Get annotations
    annotations = public_db.get_annotations_for_image(image_id)
    
    # Build URLs
    image['image_url'] = f"/api/public/images/{image_id}/image"
    image['thumbnail_url'] = f"/api/public/images/{image_id}/thumbnail"
    image['annotations'] = annotations
    
    return image


@app.get("/api/public/images/{image_id}/image")
async def serve_image(image_id: int):
    """Serve full-size image (backward compatibility - uses scene-based lookup)"""
    # Find scene by image_id (image_id is hash of scene_id)
    scene_id = image_id_to_scene_id(image_id)
    
    if not scene_id:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # Get current version for scene
    version = public_db.get_current_version_for_scene(scene_id)
    if not version:
        raise HTTPException(status_code=404, detail="No live version found for scene")
    
    # Try to serve from storage first
    if version.get('r2_key') and storage_backend:
        storage_key = version['r2_key']
        if storage_backend.file_exists(storage_key):
            # For local storage, serve directly
            if storage_config.get('type') == 'local':
                storage_path = Path(storage_config.get('base_path', './storage-test')) / storage_key
                if storage_path.exists():
                    return FileResponse(storage_path)
    
    # Fallback to local path
    local_path = Path(version['local_path'])
    if local_path.is_absolute():
        if not local_path.exists():
            raise HTTPException(status_code=404, detail="Image file not found")
    else:
        # Try relative to IMAGES_DIR
        local_path = IMAGES_DIR / version['local_path']
        if not local_path.exists():
            raise HTTPException(status_code=404, detail="Image file not found")
    
    return FileResponse(local_path)


@app.get("/api/public/images/{image_id}/thumbnail")
async def serve_thumbnail(image_id: int, size: int = Query(300, ge=50, le=1000)):
    """Serve thumbnail image (backward compatibility - uses scene-based lookup)"""
    from PIL import Image
    import io
    
    # Find scene by image_id (image_id is hash of scene_id)
    scene_id = image_id_to_scene_id(image_id)
    
    if not scene_id:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # Get current version for scene
    version = public_db.get_current_version_for_scene(scene_id)
    if not version:
        raise HTTPException(status_code=404, detail="No live version found for scene")
    
    # Try to serve from storage first
    full_path = None
    if version.get('r2_key') and storage_backend:
        storage_key = version['r2_key']
        if storage_backend.file_exists(storage_key):
            # For local storage, serve directly
            if storage_config.get('type') == 'local':
                storage_path = Path(storage_config.get('base_path', './storage-test')) / storage_key
                if storage_path.exists():
                    full_path = storage_path
    
    # Fallback to local path
    if not full_path:
        local_path = Path(version['local_path'])
        if local_path.is_absolute():
            if not local_path.exists():
                raise HTTPException(status_code=404, detail="Image file not found")
            full_path = local_path
        else:
            # Try relative to IMAGES_DIR
            local_path = IMAGES_DIR / version['local_path']
            if not local_path.exists():
                raise HTTPException(status_code=404, detail="Image file not found")
            full_path = local_path
    
    # Generate thumbnail
    img = Image.open(full_path)
    img.thumbnail((size, size), Image.Resampling.LANCZOS)
    
    # Convert to bytes
    img_bytes = io.BytesIO()
    img.save(img_bytes, format='JPEG', quality=85)
    img_bytes.seek(0)
    
    from fastapi.responses import Response
    return Response(content=img_bytes.read(), media_type="image/jpeg")


@app.get("/api/public/search")
async def search_images(
    q: Optional[str] = Query(None, min_length=1),
    roll_number: Optional[str] = Query(None),
    roll_date: Optional[str] = Query(None),
    batch_name: Optional[str] = Query(None),
    date_source: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0)
):
    """
    Full-text search with faceted filters
    
    Uses FTS5 for full-text search over descriptions and text fields.
    Supports faceted filtering by roll_number, roll_date, batch_name, date_source.
    """
    # If no query and no filters, return empty results
    if not q and not any([roll_number, roll_date, batch_name, date_source]):
        return {
            "results": [],
            "total": 0,
            "facets": {},
            "query": q
        }
    
    # Perform FTS5 search
    search_result = public_db.search_scenes_fts(
        query=q or "",
        roll_number=roll_number,
        roll_date=roll_date,
        batch_name=batch_name,
        date_source=date_source,
        limit=limit,
        offset=offset
    )
    
    # Convert scenes to image format with image_ids
    images = []
    for scene in search_result['results']:
        version = public_db.get_current_version_for_scene(scene['scene_id'])
        if not version:
            continue  # Skip scenes without live versions
        
        image_id = scene_id_to_image_id(scene['scene_id'])
        images.append({
            'image_id': image_id,
            'scene_id': scene['scene_id'],
            'image_name': scene['base_filename'],
            'base_filename': scene['base_filename'],
            'batch_name': scene['batch_name'],
            'capture_date': scene.get('capture_date') or scene.get('roll_date'),
            'roll_number': scene.get('roll_number'),
            'roll_date': scene.get('roll_date'),
            'roll_comment': scene.get('roll_comment'),
            'description': scene.get('description'),
            'image_url': f"/api/public/images/{image_id}/image",
            'thumbnail_url': f"/api/public/images/{image_id}/thumbnail"
        })
    
    return {
        "results": images,
        "total": search_result['total'],
        "facets": search_result['facets'],
        "query": q
    }


@app.get("/api/public/search/suggestions")
async def get_search_suggestions(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=20)
):
    """Get search suggestions for autocomplete"""
    suggestions = public_db.get_search_suggestions(q, limit=limit)
    return {"suggestions": suggestions, "query": q}


@app.get("/api/public/stats")
async def get_stats():
    """Get site statistics"""
    # Count public images based on config
    all_images = archive_db.get_images(limit=10000)
    public_images = config_manager.filter_images(all_images, images_dir=IMAGES_DIR)
    public_count = len(public_images)
    
    # Count scenes and live versions
    scenes = public_db.get_scenes(limit=10000)
    scene_count = len(scenes)
    live_versions = public_db.get_live_versions(limit=10000)
    live_count = len(live_versions)
    
    # Count annotations
    annotation_count = 0
    user_count = 0
    with public_db.get_connection() as conn:
        result = conn.execute("SELECT COUNT(*) as count FROM annotations").fetchone()
        annotation_count = result['count'] if result else 0
        result = conn.execute("SELECT COUNT(*) as count FROM users WHERE is_active = 1").fetchone()
        user_count = result['count'] if result else 0
    
    return {
        "total_images": public_count,
        "total_scenes": scene_count,
        "total_live_versions": live_count,
        "total_annotations": annotation_count,
        "total_users": user_count,
        "config_summary": config_manager.get_config_summary()
    }


# Auth endpoints
@app.post("/api/auth/register")
async def register(user_data: UserRegister):
    """Register a new user"""
    # Check if username exists
    if public_db.get_user_by_username(user_data.username):
        raise HTTPException(status_code=400, detail="Username already exists")
    
    # Create user
    password_hash = hash_password(user_data.password)
    user_id = public_db.create_user(
        username=user_data.username,
        email=user_data.email,
        password_hash=password_hash
    )
    
    # Create token
    token = create_token(user_id, user_data.username, 'user')
    
    return {
        "token": token,
        "user": {
            "id": user_id,
            "username": user_data.username,
            "email": user_data.email,
            "role": "user"
        }
    }


@app.post("/api/auth/login")
async def login(credentials: UserLogin):
    """Login and get JWT token"""
    user = public_db.get_user_by_username(credentials.username)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not verify_password(credentials.password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_token(user['id'], user['username'], user['role'])
    
    return {
        "token": token,
        "user": {
            "id": user['id'],
            "username": user['username'],
            "email": user['email'],
            "role": user['role']
        }
    }


@app.get("/api/auth/me")
async def get_current_user_info(current_user: Dict = Depends(get_current_user)):
    """Get current user information"""
    return {
        "id": current_user['id'],
        "username": current_user['username'],
        "email": current_user['email'],
        "role": current_user['role']
    }


# Annotation endpoints
@app.post("/api/annotations")
async def create_annotation(annotation: AnnotationCreate, current_user: Dict = Depends(get_current_user)):
    """Create a new annotation"""
    ann_id = public_db.create_annotation(
        image_id=annotation.image_id,
        user_id=current_user['id'],
        annotation_type=annotation.annotation_type,
        content=annotation.content,
        metadata=annotation.metadata
    )
    
    return {"id": ann_id, "message": "Annotation created"}


@app.get("/api/annotations/{image_id}")
async def get_image_annotations(image_id: int):
    """Get all annotations for an image"""
    annotations = public_db.get_annotations_for_image(image_id)
    return {"annotations": annotations}


@app.put("/api/annotations/{annotation_id}")
async def update_annotation(annotation_id: int, update: AnnotationUpdate, current_user: Dict = Depends(get_current_user)):
    """Update an annotation"""
    success = public_db.update_annotation(annotation_id, update.content, current_user['id'])
    if not success:
        raise HTTPException(status_code=404, detail="Annotation not found or unauthorized")
    return {"message": "Annotation updated"}


@app.delete("/api/annotations/{annotation_id}")
async def delete_annotation(annotation_id: int, current_user: Dict = Depends(get_current_user)):
    """Delete an annotation"""
    success = public_db.delete_annotation(annotation_id, current_user['id'])
    if not success:
        raise HTTPException(status_code=404, detail="Annotation not found or unauthorized")
    return {"message": "Annotation deleted"}


# Admin endpoints
class SyncRequest(BaseModel):
    batch_filter: Optional[List[str]] = None
    db_only: bool = False
    images_only: bool = False
    dry_run: bool = False


class SyncDataRequest(BaseModel):
    """Request model for syncing scene data"""
    scenes: List[Dict]
    dry_run: bool = False


@app.post("/api/admin/sync/data")
async def sync_data(
    sync_data: SyncDataRequest,
    current_user: Dict = Depends(get_current_user)
):
    """
    Sync scene and version data to public site (admin only)
    Called by management apps to push data to public-site DB
    """
    if current_user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if not storage_backend:
        raise HTTPException(status_code=500, detail="Storage backend not initialized")
    
    sync_id = public_db.log_sync("api_sync", status="in_progress")
    
    try:
        stats = {
            'scenes_synced': 0,
            'images_uploaded': 0,
            'images_skipped': 0,
            'images_deleted': 0,
            'errors': 0
        }
        
        # Process each scene
        for scene_data in sync_data.scenes:
            scene_id = scene_data['scene_id']
            batch_name = scene_data['batch_name']
            base_filename = scene_data['base_filename']
            description = scene_data.get('description')
            description_model = scene_data.get('description_model')
            description_timestamp = scene_data.get('description_timestamp')
            
            # Extract batch metadata
            capture_date = scene_data.get('capture_date') or scene_data.get('roll_date')
            roll_number = scene_data.get('roll_number')
            roll_date = scene_data.get('roll_date')
            date_source = scene_data.get('date_source')
            date_notes = scene_data.get('date_notes')
            roll_comment = scene_data.get('roll_comment')
            index_book_number = scene_data.get('index_book_number')
            index_book_date = scene_data.get('index_book_date')
            index_book_comment = scene_data.get('index_book_comment')
            short_description = scene_data.get('short_description')
            
            # Log description status for debugging
            logger.info(f"API received scene {scene_id}: description={'present (' + str(len(description)) + ' chars)' if description else 'None'}, model={description_model}, roll_number={roll_number}, roll_date={roll_date}")
            
            # Create/update scene with description and batch metadata
            public_db.create_or_update_scene(
                scene_id, 
                batch_name, 
                base_filename,
                capture_date=capture_date,
                description=description,
                description_model=description_model,
                description_timestamp=description_timestamp,
                roll_number=roll_number,
                roll_date=roll_date,
                date_source=date_source,
                date_notes=date_notes,
                roll_comment=roll_comment,
                index_book_number=index_book_number,
                index_book_date=index_book_date,
                index_book_comment=index_book_comment,
                short_description=short_description
            )
            
            # Process versions
            for version_data in scene_data.get('versions', []):
                version_id = version_data['version_id']
                version_type = version_data['version_type']
                local_path = version_data['local_path']
                perceptual_hash = version_data.get('perceptual_hash')
                is_current = version_data.get('is_current', False)
                
                # Create version in DB
                public_db.create_version(
                    version_id=version_id,
                    scene_id=scene_id,
                    version_type=version_type,
                    local_path=local_path,
                    perceptual_hash=perceptual_hash,
                    is_current=is_current
                )
                
                # If current version, set storage key (file should already be uploaded by sync script)
                if is_current:
                    storage_key = f"scenes/{scene_id}.jpg"
                    
                    # Check if already synced
                    existing_version = public_db.get_current_version_for_scene(scene_id)
                    if existing_version and existing_version.get('r2_key') == storage_key:
                        if storage_backend.file_exists(storage_key):
                            stats['images_skipped'] += 1
                            continue
                    
                    # Note: File should be uploaded by sync script before calling this API
                    # We just mark it as synced in the database
                    if not sync_data.dry_run:
                        # Verify file exists in storage (uploaded by sync script)
                        if storage_backend.file_exists(storage_key):
                            public_db.update_version_r2_key(version_id, storage_key)
                            stats['images_uploaded'] += 1
                        else:
                            logger.warning(f"Storage file not found: {storage_key} (should be uploaded by sync script)")
                            stats['errors'] += 1
                        
                        # Delete old version if exists
                        if existing_version and existing_version.get('r2_key') and existing_version['r2_key'] != storage_key:
                            old_key = existing_version['r2_key']
                            if storage_backend.delete_file(old_key):
                                stats['images_deleted'] += 1
                            # Clear old version's r2_key
                            public_db.update_version_r2_key(existing_version['version_id'], None)
            
            stats['scenes_synced'] += 1
        
        public_db.update_sync_log(
            sync_id, "success",
            images_synced=stats['images_uploaded'],
            metadata_updated=stats['scenes_synced']
        )
        
        return {
            "message": "Sync completed",
            "sync_id": sync_id,
            "stats": stats,
            "dry_run": sync_data.dry_run
        }
    except Exception as e:
        logger.error(f"Sync error: {e}", exc_info=True)
        public_db.update_sync_log(sync_id, "failed", error_message=str(e))
        raise HTTPException(status_code=500, detail=f"Sync failed: {e}")


@app.post("/api/admin/sync")
async def sync_metadata(
    sync_request: SyncRequest,
    current_user: Dict = Depends(get_current_user)
):
    """
    Legacy sync endpoint (deprecated)
    Use /api/admin/sync/data instead
    """
    raise HTTPException(status_code=410, detail="This endpoint is deprecated. Use /api/admin/sync/data instead")


@app.get("/api/admin/sync/status")
async def get_sync_status(current_user: Dict = Depends(get_current_user)):
    """Get sync status (admin only)"""
    if current_user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    status = public_db.get_latest_sync_status()
    return status or {"message": "No syncs yet"}


# Config management endpoints (admin only)
@app.get("/api/admin/config")
async def get_config(current_user: Dict = Depends(get_current_user)):
    """Get current configuration (admin only)"""
    if current_user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    return {
        "config": config_manager.config,
        "summary": config_manager.get_config_summary()
    }


@app.post("/api/admin/config/reload")
async def reload_config(current_user: Dict = Depends(get_current_user)):
    """Reload configuration from file (admin only)"""
    if current_user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    config_manager.reload()
    return {"message": "Configuration reloaded", "summary": config_manager.get_config_summary()}


class BatchConfigUpdate(BaseModel):
    enabled: bool
    directories: List[str]
    notes: Optional[str] = None


@app.put("/api/admin/config/batches/{batch_name}")
async def update_batch_config(
    batch_name: str,
    config_update: BatchConfigUpdate,
    current_user: Dict = Depends(get_current_user)
):
    """Update batch configuration (admin only)"""
    if current_user['role'] != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    config_manager.update_batch_config(
        batch_name=batch_name,
        enabled=config_update.enabled,
        directories=config_update.directories,
        notes=config_update.notes
    )
    
    return {
        "message": "Batch configuration updated",
        "batch_name": batch_name,
        "config": config_manager.get_batch_config(batch_name)
    }


# Note: File uploads are done directly to storage from management codebase
# No upload endpoint needed - management apps write directly to storage location


@app.delete("/api/admin/config/batches/{batch_name}")
async def remove_batch_config(
    batch_name: str,
    current_user: Dict = Depends(get_current_user)
):
    """Remove batch from configuration (admin only) - DEPRECATED"""
    raise HTTPException(status_code=410, detail="Batch config is now managed via API sync")


# Scene-based endpoints (new architecture)
@app.get("/api/public/scenes")
async def list_scenes(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    batch_name: Optional[str] = None
):
    """
    List public scenes
    Only shows scenes that have live versions (r2_key IS NOT NULL) in the database
    """
    # Get scenes from database (only those with live versions)
    all_scenes = public_db.get_scenes(batch_name=batch_name, limit=limit * 2, offset=offset)
    
    # Filter to only scenes with live versions
    scenes = []
    for scene in all_scenes:
        version = public_db.get_current_version_for_scene(scene['scene_id'])
        if version:  # Only include if has live version
            scenes.append(scene)
    
    # Get current version for each scene
    result_scenes = []
    for scene in scenes[:limit]:
        version = public_db.get_current_version_for_scene(scene['scene_id'])
        if version:
            scene_dict = {
                'scene_id': scene['scene_id'],
                'batch_name': scene['batch_name'],
                'base_filename': scene['base_filename'],
                'capture_date': scene.get('capture_date'),
                'image_url': f"/api/public/scenes/{scene['scene_id']}/image",
                'thumbnail_url': f"/api/public/scenes/{scene['scene_id']}/thumbnail",
                'version_id': version['version_id'],
                'version_type': version['version_type']
            }
            result_scenes.append(scene_dict)
    
    return {
        "scenes": result_scenes,
        "total": len(result_scenes),
        "limit": limit,
        "offset": offset
    }


@app.get("/api/public/scenes/{scene_id}")
async def get_scene(scene_id: str):
    """Get scene details"""
    scene = public_db.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    # Scene is available if it has a live version (checked below)
    
    # Get current version
    version = public_db.get_current_version_for_scene(scene_id)
    if not version:
        raise HTTPException(status_code=404, detail="No live version found for scene")
    
    # Get annotations (using scene_id as image_id for backward compatibility)
    # In future, annotations should reference scene_id directly
    scene_hash = hash(scene_id) % (10**9)
    annotations = public_db.get_annotations_for_image(scene_hash)
    
    scene_dict = {
        'scene_id': scene['scene_id'],
        'batch_name': scene['batch_name'],
        'base_filename': scene['base_filename'],
        'capture_date': scene.get('capture_date'),
        'image_url': f"/api/public/scenes/{scene_id}/image",
        'thumbnail_url': f"/api/public/scenes/{scene_id}/thumbnail",
        'version_id': version['version_id'],
        'version_type': version['version_type'],
        'perceptual_hash': version.get('perceptual_hash'),
        'annotations': annotations
    }
    
    return scene_dict


@app.get("/api/public/scenes/{scene_id}/image")
async def serve_scene_image(scene_id: str):
    """Serve full-size image for a scene (from storage or local fallback)"""
    scene = public_db.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    version = public_db.get_current_version_for_scene(scene_id)
    if not version:
        raise HTTPException(status_code=404, detail="No live version found for scene")
    
    # Try to serve from storage first
    if version.get('r2_key') and storage_backend:
        storage_key = version['r2_key']
        if storage_backend.file_exists(storage_key):
            # For local storage, serve directly
            if storage_config.get('type') == 'local':
                storage_path = Path(storage_config.get('base_path', './storage-test')) / storage_key
                if storage_path.exists():
                    return FileResponse(storage_path)
    
    # Fallback to local path
    local_path = Path(version['local_path'])
    if local_path.is_absolute():
        if not local_path.exists():
            raise HTTPException(status_code=404, detail="Image file not found")
    else:
        # Try relative to IMAGES_DIR
        local_path = IMAGES_DIR / version['local_path']
        if not local_path.exists():
            raise HTTPException(status_code=404, detail="Image file not found")
    
    return FileResponse(local_path)


@app.get("/api/public/scenes/{scene_id}/thumbnail")
async def serve_scene_thumbnail(scene_id: str, size: int = Query(300, ge=50, le=1000)):
    """Serve thumbnail for a scene"""
    from PIL import Image
    import io
    
    scene = public_db.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    version = public_db.get_current_version_for_scene(scene_id)
    if not version:
        raise HTTPException(status_code=404, detail="No live version found for scene")
    
    # Get local path
    local_path = Path(version['local_path'])
    if not local_path.exists():
        # Try relative to IMAGES_DIR
        local_path = IMAGES_DIR / version['local_path']
        if not local_path.exists():
            raise HTTPException(status_code=404, detail="Image file not found")
    
    # Generate thumbnail
    img = Image.open(local_path)
    img.thumbnail((size, size), Image.Resampling.LANCZOS)
    
    # Convert to bytes
    img_bytes = io.BytesIO()
    img.save(img_bytes, format='JPEG', quality=85)
    img_bytes.seek(0)
    
    from fastapi.responses import Response
    return Response(content=img_bytes.read(), media_type="image/jpeg")


@app.get("/api/public/similar")
async def find_similar_scenes(
    scene_id: str = Query(..., description="Scene ID to find similar scenes for"),
    threshold: Optional[int] = Query(None, ge=0, le=64, description="Hamming distance threshold (defaults to config value)"),
    limit: int = Query(20, ge=1, le=100, description="Maximum number of results")
):
    """Find similar scenes using perceptual hashing (only searches live versions)"""
    scene = public_db.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    # Get current version's perceptual hash
    version = public_db.get_current_version_for_scene(scene_id)
    if not version or not version.get('perceptual_hash'):
        raise HTTPException(status_code=404, detail="Scene has no perceptual hash")
    
    target_hash = version['perceptual_hash']
    
    # Use config threshold if not provided
    if threshold is None:
        threshold = config_manager.get_similarity_threshold()
    
    # Find similar scenes (only searches live versions)
    similar = public_db.find_similar_scenes(target_hash, threshold=threshold, limit=limit)
    
    # Build response with scene details
    results = []
    for item in similar:
        # Skip the scene itself
        if item['scene_id'] == scene_id:
            continue
        
        similar_scene = public_db.get_scene(item['scene_id'])
        if similar_scene:
            # Convert scene_id to image_id for frontend navigation
            similar_image_id = scene_id_to_image_id(item['scene_id'])
            results.append({
                'scene_id': item['scene_id'],
                'image_id': similar_image_id,  # Add image_id for frontend navigation
                'distance': item['distance'],
                'batch_name': item['batch_name'],
                'base_filename': item['base_filename'],
                'capture_date': item.get('capture_date'),
                'image_url': f"/api/public/scenes/{item['scene_id']}/image",
                'thumbnail_url': f"/api/public/scenes/{item['scene_id']}/thumbnail"
            })
    
    return {
        "query_scene_id": scene_id,
        "query_hash": target_hash,
        "threshold": threshold,
        "results": results,
        "total": len(results)
    }


@app.get("/api/public/roll/{roll_number}")
async def get_roll_images(roll_number: str):
    """Get all images from a specific roll number"""
    scenes = public_db.get_scenes_by_roll_number(roll_number)
    
    if not scenes:
        raise HTTPException(status_code=404, detail=f"No images found for roll {roll_number}")
    
    # Get roll metadata from first scene
    roll_metadata = {
        'roll_number': roll_number,
        'roll_date': scenes[0].get('roll_date'),
        'date_source': scenes[0].get('date_source'),
        'date_notes': scenes[0].get('date_notes'),
        'roll_comment': scenes[0].get('roll_comment'),
        'index_book_number': scenes[0].get('index_book_number'),
        'index_book_date': scenes[0].get('index_book_date'),
        'index_book_comment': scenes[0].get('index_book_comment'),
        'short_description': scenes[0].get('short_description')
    }
    
    # Convert scenes to image format
    images = []
    for scene in scenes:
        version = public_db.get_current_version_for_scene(scene['scene_id'])
        if not version:
            continue  # Skip scenes without live versions
        
        image_id = scene_id_to_image_id(scene['scene_id'])
        images.append({
            'image_id': image_id,
            'scene_id': scene['scene_id'],
            'base_filename': scene['base_filename'],
            'batch_name': scene['batch_name'],
            'capture_date': scene.get('capture_date') or scene.get('roll_date'),
            'image_url': f"/api/public/images/{image_id}/image",
            'thumbnail_url': f"/api/public/images/{image_id}/thumbnail"
        })
    
    return {
        'roll_metadata': roll_metadata,
        'images': images,
        'total': len(images)
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)


"""
Shared utility functions for public site and static generator
"""
import hashlib
import logging
from pathlib import Path
from typing import Optional, Dict, List

logger = logging.getLogger(__name__)

def scene_id_to_image_id(scene_id: str) -> int:
    """Convert scene_id to image_id using deterministic hash"""
    # Use MD5 for deterministic hashing (same input = same output)
    md5_hash = hashlib.md5(scene_id.encode('utf-8')).hexdigest()
    # Convert to integer and mod to get 9-digit number
    return int(md5_hash[:8], 16) % (10**9)


def image_id_to_scene_id(image_id: int, db) -> Optional[str]:
    """
    Find scene_id that hashes to the given image_id
    
    Args:
        image_id: The integer image ID to look up
        db: PublicSiteDatabase instance
    """
    # Get all scenes and find the one that hashes to this image_id
    # Note: This is inefficient for large datasets but maintains backward compatibility
    # without adding a new column. For production with many images, we might want to cache this.
    all_scenes = db.get_scenes(batch_name=None, limit=10000, offset=0)
    
    for scene in all_scenes:
        if scene_id_to_image_id(scene['scene_id']) == image_id:
            return scene['scene_id']
    
    # If not found by scene_id hash, try to find by old method (file path hash)
    # This handles backward compatibility with old image_ids
    all_scenes_with_versions = []
    for scene in all_scenes:
        version = db.get_current_version_for_scene(scene['scene_id'])
        if version:
            all_scenes_with_versions.append((scene, version))
    
    for scene, version in all_scenes_with_versions:
        local_path = version.get('local_path', '')
        if local_path:
            # Try to reconstruct the old relative path format
            try:
                path_obj = Path(local_path)
                # Logic to reconstruct path for hashing - simplified from original
                # We just need a string that might match the old hash
                # This is a best-effort fallback
                
                # Use MD5 hash like the old system
                old_hash = int(hashlib.md5(str(path_obj).encode('utf-8')).hexdigest()[:8], 16) % (10**9)
                if old_hash == image_id:
                    return scene['scene_id']
            except Exception:
                continue
    
    return None


def hamming_distance(hash1: str, hash2: str) -> int:
    """Calculate Hamming distance between two hex hashes"""
    if not hash1 or not hash2 or len(hash1) != len(hash2):
        return float('inf')
    return sum(c1 != c2 for c1, c2 in zip(hash1, hash2))


def construct_image_urls(
    storage_backend, 
    r2_key: Optional[str], 
    image_id: int, 
    scene_id: Optional[str] = None
) -> Dict[str, str]:
    """
    Construct image and thumbnail URLs based on storage backend and availability
    
    Args:
        storage_backend: The storage backend instance
        r2_key: The R2 key (or scene_id for manifests) if available
        image_id: The integer image ID (for fallback URLs)
        scene_id: The scene ID (optional, for scene-based URLs)
        
    Returns:
        Dict with 'image_url' and 'thumbnail_url', and optionally 'base_url'
    """
    urls = {}
    
    if r2_key and storage_backend:
        # Use base_url pattern (same as individual image endpoint)
        base_url = storage_backend.get_file_url(r2_key)
        urls['base_url'] = base_url
        urls['image_url'] = f"{base_url}/original.jpg"  # Fallback
        urls['thumbnail_url'] = f"{base_url}/thumb.avif"  # Correct directory-based path
    else:
        # Use local API endpoints
        if scene_id:
            urls['image_url'] = f"/api/public/scenes/{scene_id}/image"
            urls['thumbnail_url'] = f"/api/public/scenes/{scene_id}/thumbnail"
        else:
            urls['image_url'] = f"/api/public/images/{image_id}/image"
            urls['thumbnail_url'] = f"/api/public/images/{image_id}/thumbnail"
            
    return urls

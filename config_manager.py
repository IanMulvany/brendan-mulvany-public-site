"""
Configuration manager for public site
Handles batch and directory visibility configuration
"""

import yaml
from pathlib import Path
from typing import List, Dict, Optional, Set
from datetime import datetime, timedelta
import logging
import sys

# Import batch config utilities
sys.path.insert(0, str(Path(__file__).parent.parent / "code"))
try:
    from public_site_batch_utils import get_public_batches, get_batch_source_directory, is_batch_public
except ImportError:
    # Fallback if not available
    def get_public_batches():
        return []
    def get_batch_source_directory(batch_name):
        return None
    def is_batch_public(batch_name):
        return False

logger = logging.getLogger(__name__)


class ConfigManager:
    """Manages public site configuration"""
    
    def __init__(self, config_path: Path):
        self.config_path = config_path
        self.config = self._load_config()
        self._cache = {}
        self._cache_timestamp = None
        self._cache_ttl = self.config.get('settings', {}).get('cache_ttl', 3600)
    
    def _load_config(self) -> Dict:
        """Load configuration from YAML file"""
        if not self.config_path.exists():
            logger.warning(f"Config file not found at {self.config_path}, using defaults")
            return self._default_config()
        
        try:
            with open(self.config_path, 'r') as f:
                config = yaml.safe_load(f) or {}
            return config
        except Exception as e:
            logger.error(f"Error loading config: {e}, using defaults")
            return self._default_config()
    
    def _default_config(self) -> Dict:
        """Return default configuration"""
        return {
            'settings': {
                'restrict_to_listed': False,
                'cache_ttl': 3600
            },
            'batches': [],
            'directory_aliases': {},
            'batch_metadata': {}
        }
    
    def reload(self):
        """Reload configuration from file"""
        self.config = self._load_config()
        self._cache = {}
        self._cache_timestamp = None
    
    def is_batch_enabled(self, batch_name: str) -> bool:
        """Check if a batch is enabled in config"""
        if not self.config.get('settings', {}).get('restrict_to_listed', False):
            return True  # Show all if not restricted
        
        for batch in self.config.get('batches', []):
            if batch.get('batch_name') == batch_name:
                return batch.get('enabled', False)
        
        return False
    
    def get_batch_directories(self, batch_name: str) -> List[str]:
        """Get list of enabled directories for a batch"""
        if not self.config.get('settings', {}).get('restrict_to_listed', False):
            # If not restricted, allow all directories (but prefer final_crops)
            return ['final_crops', 'inverted_original_scans']
        
        for batch in self.config.get('batches', []):
            if batch.get('batch_name') == batch_name:
                return batch.get('directories', [])
        
        return []
    
    def is_directory_enabled(self, batch_name: str, directory: str) -> bool:
        """Check if a specific directory is enabled for a batch"""
        if not self.is_batch_enabled(batch_name):
            return False
        
        allowed_dirs = self.get_batch_directories(batch_name)
        return directory in allowed_dirs
    
    def is_image_public(self, image_path: str) -> bool:
        """
        Check if an image should be publicly visible based on batch config database
        Image path format: "batch_name/directory/filename.jpg"
        """
        # Check cache first
        if self._is_cache_valid():
            if image_path in self._cache:
                return self._cache[image_path]
        else:
            self._cache = {}
            self._cache_timestamp = datetime.now()
        
        # Parse path
        parts = Path(image_path).parts
        if len(parts) < 2:
            result = False
        else:
            # Assume format: batch_name/directory/filename
            batch_name = parts[0]
            directory = parts[1] if len(parts) > 1 else ''
            
            # Check batch config database
            if is_batch_public(batch_name):
                source_dir = get_batch_source_directory(batch_name)
                result = (source_dir == directory) if source_dir else False
            else:
                result = False
        
        # Cache result
        self._cache[image_path] = result
        return result
    
    def _is_cache_valid(self) -> bool:
        """Check if cache is still valid"""
        if self._cache_timestamp is None:
            return False
        age = (datetime.now() - self._cache_timestamp).total_seconds()
        return age < self._cache_ttl
    
    def get_enabled_batches(self) -> List[str]:
        """Get list of all enabled batch names"""
        if not self.config.get('settings', {}).get('restrict_to_listed', False):
            return []  # Empty means "all batches"
        
        return [
            batch['batch_name']
            for batch in self.config.get('batches', [])
            if batch.get('enabled', False)
        ]
    
    def get_batch_config(self, batch_name: str) -> Optional[Dict]:
        """Get full configuration for a specific batch"""
        for batch in self.config.get('batches', []):
            if batch.get('batch_name') == batch_name:
                return batch
        return None
    
    def get_directory_alias(self, directory: str) -> str:
        """Get display alias for a directory"""
        return self.config.get('directory_aliases', {}).get(directory, directory)
    
    def get_batch_metadata(self, batch_name: str) -> Dict:
        """Get metadata overrides for a batch"""
        for metadata in self.config.get('batch_metadata', []):
            if metadata.get('batch_name') == batch_name:
                return metadata
        return {}
    
    def update_batch_config(self, batch_name: str, enabled: bool, directories: List[str], notes: Optional[str] = None):
        """Update configuration for a batch"""
        batches = self.config.get('batches', [])
        
        # Find existing batch config
        batch_index = None
        for i, batch in enumerate(batches):
            if batch.get('batch_name') == batch_name:
                batch_index = i
                break
        
        batch_config = {
            'batch_name': batch_name,
            'enabled': enabled,
            'directories': directories
        }
        if notes:
            batch_config['notes'] = notes
        
        if batch_index is not None:
            batches[batch_index] = batch_config
        else:
            batches.append(batch_config)
        
        self.config['batches'] = batches
        self._save_config()
        self.reload()  # Clear cache
    
    def remove_batch_config(self, batch_name: str):
        """Remove batch from configuration"""
        batches = self.config.get('batches', [])
        self.config['batches'] = [
            b for b in batches if b.get('batch_name') != batch_name
        ]
        self._save_config()
        self.reload()  # Clear cache
    
    def _save_config(self):
        """Save configuration to file"""
        try:
            with open(self.config_path, 'w') as f:
                yaml.dump(self.config, f, default_flow_style=False, sort_keys=False)
        except Exception as e:
            logger.error(f"Error saving config: {e}")
            raise
    
    def filter_images(self, images: List[Dict], images_dir: Optional[Path] = None) -> List[Dict]:
        """Filter list of images based on batch configuration database"""
        # Use batch config database
        public_batches = get_public_batches()
        if not public_batches:
            # No batches configured - return empty list
            return []
        
        filtered = []
        for img in images:
            img_path = img.get('image_path', '')
            # Extract batch name from path
            path_parts = Path(img_path).parts
            if len(path_parts) >= 1:
                batch_name = path_parts[0]
                if is_batch_public(batch_name):
                    source_dir = get_batch_source_directory(batch_name)
                    if source_dir:
                        # Check if image is in the configured source directory
                        if len(path_parts) >= 2 and path_parts[1] == source_dir:
                            filtered.append(img)
                        # Or try to find image in the configured directory
                        elif images_dir:
                            img_name = Path(img_path).name
                            source_path = images_dir / batch_name / source_dir / img_name
                            if source_path.exists():
                                img_copy = img.copy()
                                img_copy['image_path'] = f"{batch_name}/{source_dir}/{img_name}"
                                filtered.append(img_copy)
        return filtered
    
    def get_config_summary(self) -> Dict:
        """Get summary of current configuration"""
        storage_config = self.get_storage_config()
        return {
            'storage_type': storage_config.get('type', 'local')
        }
    
    def get_storage_config(self) -> Dict:
        """Get storage configuration"""
        return self.config.get('storage', {
            'type': 'local',
            'base_path': './storage-test'
        })
    
    def get_similarity_threshold(self) -> int:
        """Get similarity search threshold (Hamming distance)"""
        similarity_config = self.config.get('similarity', {})
        return similarity_config.get('threshold', 8)  # Default: 8 for "roughly similar but not exact"

    def get_jwt_secret(self) -> str:
        """Get JWT secret from config"""
        security_config = self.config.get('security', {})
        jwt_secret = security_config.get('jwt_secret', '')

        if not jwt_secret or jwt_secret == 'CHANGE-ME-generate-a-secure-random-secret-key-here':
            logger.error("JWT_SECRET not configured! Using insecure default. Please set security.jwt_secret in config.yaml")
            return "insecure-default-secret-DO-NOT-USE-IN-PRODUCTION"

        return jwt_secret


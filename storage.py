"""
Storage abstraction layer for public site
Supports local filesystem (for testing) and Cloudflare R2 (for production)
"""

from pathlib import Path
from typing import Optional, BinaryIO
import shutil
import logging
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


class StorageBackend(ABC):
    """Abstract base class for storage backends"""
    
    @abstractmethod
    def upload_file(self, local_path: Path, storage_key: str) -> bool:
        """Upload a file to storage"""
        pass
    
    @abstractmethod
    def download_file(self, storage_key: str, local_path: Path) -> bool:
        """Download a file from storage"""
        pass
    
    @abstractmethod
    def delete_file(self, storage_key: str) -> bool:
        """Delete a file from storage"""
        pass
    
    @abstractmethod
    def file_exists(self, storage_key: str) -> bool:
        """Check if a file exists in storage"""
        pass
    
    @abstractmethod
    def get_file_url(self, storage_key: str) -> str:
        """Get public URL for a file (for CDN)"""
        pass


class LocalStorageBackend(StorageBackend):
    """Local filesystem storage backend (for testing/mocking R2)"""
    
    def __init__(self, base_path: Path):
        """
        Initialize local storage backend
        
        Args:
            base_path: Base directory for storage (e.g., ./storage-test/)
        """
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"LocalStorageBackend initialized at {self.base_path}")
    
    def upload_file(self, local_path: Path, storage_key: str) -> bool:
        """Copy file to local storage"""
        try:
            source = Path(local_path)
            if not source.exists():
                logger.error(f"Source file does not exist: {source}")
                return False
            
            # Create storage path
            dest = self.base_path / storage_key
            dest.parent.mkdir(parents=True, exist_ok=True)
            
            # Copy file
            shutil.copy2(source, dest)
            logger.info(f"Uploaded {source} to {dest}")
            return True
        except Exception as e:
            logger.error(f"Error uploading file {local_path} to {storage_key}: {e}")
            return False
    
    def download_file(self, storage_key: str, local_path: Path) -> bool:
        """Copy file from local storage"""
        try:
            source = self.base_path / storage_key
            if not source.exists():
                logger.error(f"Storage file does not exist: {source}")
                return False
            
            dest = Path(local_path)
            dest.parent.mkdir(parents=True, exist_ok=True)
            
            # Copy file
            shutil.copy2(source, dest)
            logger.info(f"Downloaded {source} to {dest}")
            return True
        except Exception as e:
            logger.error(f"Error downloading file {storage_key} to {local_path}: {e}")
            return False
    
    def delete_file(self, storage_key: str) -> bool:
        """Delete file from local storage"""
        try:
            file_path = self.base_path / storage_key
            if file_path.exists():
                file_path.unlink()
                logger.info(f"Deleted {file_path}")
                return True
            else:
                logger.warning(f"File does not exist: {file_path}")
                return False
        except Exception as e:
            logger.error(f"Error deleting file {storage_key}: {e}")
            return False
    
    def file_exists(self, storage_key: str) -> bool:
        """Check if file exists in local storage"""
        file_path = self.base_path / storage_key
        return file_path.exists()
    
    def get_file_url(self, storage_key: str) -> str:
        """Get local file URL (for testing)"""
        # In production, this would be a CDN URL
        # For local testing, return a relative path
        return f"/api/storage/{storage_key}"


class CDNBackend(StorageBackend):
    """CDN-only backend for display layer - no credentials needed"""
    
    def __init__(self, public_url: str):
        """
        Initialize CDN backend (display-only, no upload/download/delete operations)
        
        Args:
            public_url: Public CDN URL base (e.g., "https://cdn.example.com" or "https://pub-account-id.r2.dev/bucket-name")
        """
        # Ensure URL doesn't end with /
        self.public_url = public_url.rstrip('/')
        logger.info(f"CDNBackend initialized with public URL: {self.public_url}")
    
    def upload_file(self, local_path: Path, storage_key: str) -> bool:
        """Not supported - uploads handled by management app"""
        logger.warning("upload_file() called on CDNBackend - uploads should be handled by management app")
        return False
    
    def download_file(self, storage_key: str, local_path: Path) -> bool:
        """Not supported - downloads handled by management app"""
        logger.warning("download_file() called on CDNBackend - downloads should be handled by management app")
        return False
    
    def delete_file(self, storage_key: str) -> bool:
        """Not supported - deletions handled by management app"""
        logger.warning("delete_file() called on CDNBackend - deletions should be handled by management app")
        return False
    
    def file_exists(self, storage_key: str) -> bool:
        """Not supported - assume files exist if r2_key is set in database"""
        logger.warning("file_exists() called on CDNBackend - trusting database state")
        return True
    
    def get_file_url(self, storage_key: str) -> str:
        """
        Get public CDN URL for file (R2 manifest format)
        
        Expected format: scene_id only (e.g., "2025-11-04-batch-1-DSCF1533")
        Resulting URL: https://cdn.example.com/2025-11-04-batch-1-DSCF1533 (extensionless)
        
        The manifest file should be at {scene_id}/manifest.json in R2.
        Cloudflare will automatically select the best variant based on browser capabilities.
        """
        # Ensure storage_key doesn't start with /
        storage_key = storage_key.lstrip('/')
        return f"{self.public_url}/{storage_key}"


class R2StorageBackend(StorageBackend):
    """Cloudflare R2 storage backend (for management apps - not used by display layer)"""
    
    def __init__(self, account_id: str, access_key_id: str, secret_access_key: str, bucket_name: str, public_url: Optional[str] = None):
        """
        Initialize R2 storage backend (for management apps only)
        
        Args:
            account_id: Cloudflare account ID
            access_key_id: R2 access key ID
            secret_access_key: R2 secret access key
            bucket_name: R2 bucket name
            public_url: Public CDN URL (optional)
        """
        self.account_id = account_id
        self.access_key_id = access_key_id
        self.secret_access_key = secret_access_key
        self.bucket_name = bucket_name
        self.public_url = public_url or f"https://pub-{account_id}.r2.dev/{bucket_name}"
        
        # TODO: Initialize boto3 S3 client for R2
        # import boto3
        # self.client = boto3.client(
        #     's3',
        #     endpoint_url=f'https://{account_id}.r2.cloudflarestorage.com',
        #     aws_access_key_id=access_key_id,
        #     aws_secret_access_key=secret_access_key
        # )
        
        logger.info(f"R2StorageBackend initialized for bucket {bucket_name}")
        raise NotImplementedError("R2 storage backend not yet implemented")
    
    def upload_file(self, local_path: Path, storage_key: str) -> bool:
        """Upload file to R2"""
        # TODO: Implement R2 upload
        # self.client.upload_file(str(local_path), self.bucket_name, storage_key)
        raise NotImplementedError("R2 upload not yet implemented")
    
    def download_file(self, storage_key: str, local_path: Path) -> bool:
        """Download file from R2"""
        # TODO: Implement R2 download
        # self.client.download_file(self.bucket_name, storage_key, str(local_path))
        raise NotImplementedError("R2 download not yet implemented")
    
    def delete_file(self, storage_key: str) -> bool:
        """Delete file from R2"""
        # TODO: Implement R2 delete
        # self.client.delete_object(Bucket=self.bucket_name, Key=storage_key)
        raise NotImplementedError("R2 delete not yet implemented")
    
    def file_exists(self, storage_key: str) -> bool:
        """Check if file exists in R2"""
        # TODO: Implement R2 exists check
        # try:
        #     self.client.head_object(Bucket=self.bucket_name, Key=storage_key)
        #     return True
        # except:
        #     return False
        raise NotImplementedError("R2 exists check not yet implemented")
    
    def get_file_url(self, storage_key: str) -> str:
        """Get public CDN URL for file"""
        storage_key = storage_key.lstrip('/')
        return f"{self.public_url}/{storage_key}"


def create_storage_backend(config: dict) -> Optional[StorageBackend]:
    """
    Create storage backend from config
    
    For display layer: use 'cdn' type (no credentials needed)
    For management apps: use 'local' or 'r2' types
    
    Args:
        config: Storage configuration dict
        
    Returns:
        StorageBackend instance or None if not configured
    """
    storage_type = config.get('type', 'local')
    
    if storage_type == 'local':
        base_path = Path(config.get('base_path', './storage-test'))
        return LocalStorageBackend(base_path)
    elif storage_type == 'cdn':
        # CDN-only mode: just need public_url, no credentials
        public_url = config.get('public_url')
        if not public_url:
            logger.warning("CDN backend requires public_url in config")
            return None
        return CDNBackend(public_url)
    elif storage_type == 'r2':
        # R2 mode requires credentials (for management apps)
        return R2StorageBackend(
            account_id=config['account_id'],
            access_key_id=config['access_key_id'],
            secret_access_key=config['secret_access_key'],
            bucket_name=config['bucket_name'],
            public_url=config.get('public_url')
        )
    else:
        raise ValueError(f"Unknown storage type: {storage_type}")


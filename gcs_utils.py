"""
Google Cloud Storage utilities for handling GCS paths and file transfers.

This module provides helper functions for:
- Detecting GCS paths (gs://)
- Downloading files from GCS to local temp storage
- Uploading files to GCS
- Listing files in GCS buckets
"""

import os
import tempfile
from pathlib import Path
from typing import List, Tuple, Optional
from urllib.parse import urlparse


def is_gcs_path(path: str) -> bool:
    """
    Check if a path is a Google Cloud Storage path.
    
    Args:
        path: Path to check
        
    Returns:
        True if path starts with gs://
    """
    return isinstance(path, str) and path.startswith('gs://')


def parse_gcs_path(gcs_path: str) -> Tuple[str, str]:
    """
    Parse a GCS path into bucket and blob components.
    
    Args:
        gcs_path: GCS path (e.g., gs://bucket-name/path/to/file.txt)
        
    Returns:
        Tuple of (bucket_name, blob_path)
        
    Raises:
        ValueError: If path is not a valid GCS path
    """
    if not is_gcs_path(gcs_path):
        raise ValueError(f"Not a valid GCS path: {gcs_path}")
    
    # Remove gs:// prefix and split
    path = gcs_path[5:]  # Remove 'gs://'
    parts = path.split('/', 1)
    
    bucket_name = parts[0]
    blob_path = parts[1] if len(parts) > 1 else ''
    
    return bucket_name, blob_path


def get_gcs_client():
    """
    Get or create a GCS client.
    
    Returns:
        Google Cloud Storage client
        
    Raises:
        ImportError: If google-cloud-storage is not installed
    """
    try:
        from google.cloud import storage
        return storage.Client()
    except ImportError:
        raise ImportError(
            "google-cloud-storage is not installed. "
            "Install it with: pip install google-cloud-storage"
        )


def gcs_exists(gcs_path: str) -> bool:
    """
    Check if a GCS file or directory exists.
    
    Args:
        gcs_path: GCS path to check
        
    Returns:
        True if exists, False otherwise
    """
    try:
        bucket_name, blob_path = parse_gcs_path(gcs_path)
        client = get_gcs_client()
        bucket = client.bucket(bucket_name)
        
        if not blob_path or blob_path.endswith('/'):
            # Check if bucket exists
            return bucket.exists()
        else:
            # Check if blob exists
            blob = bucket.blob(blob_path)
            return blob.exists()
    except Exception as e:
        print(f"Error checking GCS path {gcs_path}: {e}")
        return False


def download_from_gcs(gcs_path: str, local_path: str) -> str:
    """
    Download a file from GCS to local storage.
    
    Args:
        gcs_path: GCS path (e.g., gs://bucket/path/to/file.mp4)
        local_path: Local destination path
        
    Returns:
        Local path where file was saved
        
    Raises:
        Exception: If download fails
    """
    bucket_name, blob_path = parse_gcs_path(gcs_path)
    
    client = get_gcs_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    
    # Create parent directory if needed
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    
    print(f"Downloading {gcs_path} to {local_path}...")
    blob.download_to_filename(local_path)
    
    return local_path


def upload_to_gcs(local_path: str, gcs_path: str) -> str:
    """
    Upload a file from local storage to GCS.
    
    Args:
        local_path: Local file path
        gcs_path: GCS destination path
        
    Returns:
        GCS path where file was uploaded
        
    Raises:
        Exception: If upload fails
    """
    if not os.path.exists(local_path):
        raise FileNotFoundError(f"Local file not found: {local_path}")
    
    bucket_name, blob_path = parse_gcs_path(gcs_path)
    
    client = get_gcs_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    
    print(f"Uploading {local_path} to {gcs_path}...")
    blob.upload_from_filename(local_path)
    
    return gcs_path


def list_gcs_blobs(gcs_path: str, extensions: List[str] = None) -> List[str]:
    """
    List files in a GCS bucket/directory.
    
    Args:
        gcs_path: GCS directory path (e.g., gs://bucket/path/)
        extensions: Optional list of file extensions to filter (e.g., ['.mp4', '.avi'])
        
    Returns:
        List of GCS paths
    """
    bucket_name, prefix = parse_gcs_path(gcs_path)
    
    client = get_gcs_client()
    bucket = client.bucket(bucket_name)
    
    # List blobs with prefix
    blobs = bucket.list_blobs(prefix=prefix)
    
    results = []
    for blob in blobs:
        # Skip directories
        if blob.name.endswith('/'):
            continue
        
        # Filter by extension if specified
        if extensions:
            if not any(blob.name.lower().endswith(ext.lower()) for ext in extensions):
                continue
        
        results.append(f"gs://{bucket_name}/{blob.name}")
    
    return results


def create_temp_dir() -> str:
    """
    Create a temporary directory for GCS downloads.
    
    Returns:
        Path to temporary directory
    """
    temp_dir = tempfile.mkdtemp(prefix='gcs_temp_')
    return temp_dir


def get_local_path_for_gcs(gcs_path: str, temp_dir: str) -> str:
    """
    Generate a local path for a GCS file in the temp directory.
    
    Args:
        gcs_path: GCS path
        temp_dir: Temporary directory
        
    Returns:
        Local path maintaining the GCS structure
    """
    bucket_name, blob_path = parse_gcs_path(gcs_path)
    
    # Create subdirectory structure in temp
    local_path = os.path.join(temp_dir, bucket_name, blob_path)
    
    return local_path


def sync_to_gcs(local_dir: str, gcs_dir: str, extensions: List[str] = None) -> List[str]:
    """
    Upload all files from a local directory to GCS.
    
    Args:
        local_dir: Local directory path
        gcs_dir: GCS destination directory (e.g., gs://bucket/path/)
        extensions: Optional list of extensions to upload
        
    Returns:
        List of uploaded GCS paths
    """
    if not is_gcs_path(gcs_dir):
        raise ValueError(f"Not a valid GCS path: {gcs_dir}")
    
    # Ensure GCS path ends with /
    if not gcs_dir.endswith('/'):
        gcs_dir += '/'
    
    uploaded = []
    
    for root, dirs, files in os.walk(local_dir):
        for filename in files:
            # Filter by extension if specified
            if extensions and not any(filename.lower().endswith(ext.lower()) for ext in extensions):
                continue
            
            local_path = os.path.join(root, filename)
            
            # Calculate relative path
            rel_path = os.path.relpath(local_path, local_dir)
            
            # Convert to forward slashes for GCS
            rel_path = rel_path.replace('\\', '/')
            
            gcs_path = gcs_dir + rel_path
            
            try:
                upload_to_gcs(local_path, gcs_path)
                uploaded.append(gcs_path)
            except Exception as e:
                print(f"Error uploading {local_path}: {e}")
    
    return uploaded

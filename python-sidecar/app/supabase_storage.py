"""
Supabase client for Python sidecar
Handles DIP file uploads to Supabase Storage
"""

import os
import json
from typing import Dict, Any, Optional
from supabase import create_client, Client
import logging

logger = logging.getLogger(__name__)

class SupabaseStorageClient:
    """Client for uploading DIP files to Supabase Storage"""
    
    def __init__(self):
        self.supabase: Optional[Client] = None
        self.bucket_name = "documents"
        self._initialize_client()
    
    def _initialize_client(self):
        """Initialize Supabase client"""
        try:
            supabase_url = os.getenv('SUPABASE_URL')
            supabase_key = os.getenv('SUPABASE_ANON_KEY')
            
            if not supabase_url or not supabase_key:
                logger.warning("Supabase credentials not found, DIP file upload disabled")
                return
            
            self.supabase = create_client(supabase_url, supabase_key)
            logger.info("Supabase client initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Supabase client: {e}")
            self.supabase = None
    
    def is_available(self) -> bool:
        """Check if Supabase client is available"""
        return self.supabase is not None
    
    def upload_dip_file(self, doc_id: str, file_path: str, file_content: str) -> bool:
        """
        Upload DIP file to Supabase Storage
        
        Args:
            doc_id: Document ID
            file_path: Local file path
            file_content: File content as string
            
        Returns:
            bool: True if upload successful, False otherwise
        """
        if not self.is_available():
            logger.warning("Supabase client not available, skipping file upload")
            return False
        
        try:
            # Create storage path: manuals/{doc_id}/DIP/{filename}
            filename = os.path.basename(file_path)
            storage_path = f"manuals/{doc_id}/DIP/{filename}"
            
            # Upload file to Supabase Storage
            result = self.supabase.storage.from_(self.bucket_name).upload(
                storage_path,
                file_content.encode('utf-8'),
                file_options={
                    "content-type": "text/plain",
                    "cache-control": "3600"
                }
            )
            
            if result.get('error'):
                logger.error(f"Failed to upload {filename}: {result['error']}")
                return False
            
            logger.info(f"Successfully uploaded DIP file: {storage_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error uploading DIP file {file_path}: {e}")
            return False
    
    def upload_dip_files(self, doc_id: str, dip_files: Dict[str, str]) -> Dict[str, bool]:
        """
        Upload multiple DIP files to Supabase Storage
        
        Args:
            doc_id: Document ID
            dip_files: Dictionary mapping file types to file paths
            
        Returns:
            Dict[str, bool]: Upload results for each file type
        """
        results = {}
        
        for file_type, file_path in dip_files.items():
            try:
                # Read file content
                with open(file_path, 'r', encoding='utf-8') as f:
                    file_content = f.read()
                
                # Upload file
                success = self.upload_dip_file(doc_id, file_path, file_content)
                results[file_type] = success
                
            except Exception as e:
                logger.error(f"Error reading file {file_path}: {e}")
                results[file_type] = False
        
        return results
    
    def get_dip_file_url(self, doc_id: str, filename: str) -> Optional[str]:
        """
        Get signed URL for DIP file
        
        Args:
            doc_id: Document ID
            filename: DIP file filename
            
        Returns:
            Optional[str]: Signed URL or None if failed
        """
        if not self.is_available():
            return None
        
        try:
            storage_path = f"manuals/{doc_id}/DIP/{filename}"
            
            # Create signed URL (valid for 1 hour)
            result = self.supabase.storage.from_(self.bucket_name).create_signed_url(
                storage_path,
                3600  # 1 hour
            )
            
            if result.get('error'):
                logger.error(f"Failed to create signed URL for {filename}: {result['error']}")
                return None
            
            return result.get('signedURL')
            
        except Exception as e:
            logger.error(f"Error creating signed URL for {filename}: {e}")
            return None

# Global instance
supabase_storage = SupabaseStorageClient()

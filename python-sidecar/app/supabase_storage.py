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
            supabase_key = os.getenv('PY_SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
            
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
            # Create storage path: manuals/{doc_id}/DIP/{filename} (relative to documents bucket)
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
    
    def upload_dip_data(self, doc_id: str, dip_data: Dict[str, Any]) -> Dict[str, str]:
        """
        Upload DIP data as JSON files to Supabase Storage
        
        Args:
            doc_id: Document ID
            dip_data: DIP data structure from processor
            
        Returns:
            Dict[str, str]: Upload results with storage paths
        """
        storage_results = {}
        
        if not self.is_available():
            logger.warning("Supabase client not available, DIP files not uploaded")
            return {
                'spec_suggestions': '',
                'playbook_hints': '',
                'intent_router': '',
                'golden_tests': ''
            }
        
        # 1. Create spec_suggestions.json
        spec_suggestions = []
        for hint in dip_data['dip']['spec_hints']:
            spec_suggestions.append({
                'spec_name': hint.hint_type,
                'spec_value': hint.value,
                'spec_unit': hint.unit,
                'page': hint.page,
                'confidence': hint.confidence
            })
        
        spec_suggestions_content = json.dumps(spec_suggestions, indent=2, ensure_ascii=False)
        spec_filename = f"{doc_id}_spec_suggestions_an.json"
        if self.upload_dip_file(doc_id, spec_filename, spec_suggestions_content):
            storage_results['spec_suggestions'] = f"manuals/{doc_id}/DIP/{spec_filename}"
            logger.info(f"Successfully uploaded spec_suggestions.json")
        else:
            storage_results['spec_suggestions'] = ''
            logger.warning(f"Failed to upload spec_suggestions.json")
        
        # 2. Create playbook_hints.json  
        playbook_hints = []
        for hint in dip_data['dip'].get('playbook_hints', []):
            playbook_hints.append({
                'title': hint.get('title', ''),
                'description': hint.get('description', ''),
                'steps': hint.get('steps', []),
                'expected_outcome': hint.get('expected_outcome', ''),
                'preconditions': hint.get('preconditions', []),
                'error_codes': hint.get('error_codes', []),
                'category': hint.get('category', 'operation'),
                'page': hint.get('page'),
                'confidence': hint.get('confidence')
            })
        
        playbook_content = json.dumps({'playbook_hints': playbook_hints}, indent=2, ensure_ascii=False)
        playbook_filename = f"{doc_id}_playbook_hints_an.json"
        if self.upload_dip_file(doc_id, playbook_filename, playbook_content):
            storage_results['playbook_hints'] = f"manuals/{doc_id}/DIP/{playbook_filename}"
            logger.info(f"Successfully uploaded playbook_hints.json")
        else:
            storage_results['playbook_hints'] = ''
            logger.warning(f"Failed to upload playbook_hints.json")
        
        # 3. Create intent_router.json  
        intent_router = []
        for hint in dip_data['dip'].get('intent_hints', []):
            intent_router.append({
                'question': hint.get('intent_type', ''),
                'answer': hint.get('prompt', ''),
                'context': hint.get('context', ''),
                'page': hint.get('page'),
                'confidence': hint.get('confidence')
            })
        
        intent_router_content = json.dumps(intent_router, indent=2, ensure_ascii=False)
        intent_filename = f"{doc_id}_intent_router_an.json"
        if self.upload_dip_file(doc_id, intent_filename, intent_router_content):
            storage_results['intent_router'] = f"manuals/{doc_id}/DIP/{intent_filename}"
            logger.info(f"Successfully uploaded intent_router.json")
        else:
            storage_results['intent_router'] = ''
            logger.warning(f"Failed to upload intent_router.json")
        
        # 4. Create golden_tests.json
        golden_tests = []
        for test in dip_data['dip'].get('golden_tests', []):
            golden_tests.append({
                'query': test.get('test_name', ''),
                'expected': test.get('expected_result', ''),
                'description': test.get('description', ''),
                'steps': test.get('steps', []),
                'page': test.get('page'),
                'confidence': test.get('confidence')
            })
        
        golden_tests_content = json.dumps(golden_tests, indent=2, ensure_ascii=False)
        golden_filename = f"{doc_id}_golden_rules_an.json"
        if self.upload_dip_file(doc_id, golden_filename, golden_tests_content):
            storage_results['golden_tests'] = f"manuals/{doc_id}/DIP/{golden_filename}"
            logger.info(f"Successfully uploaded golden_tests.json")
        else:
            storage_results['golden_tests'] = ''
            logger.warning(f"Failed to upload golden_tests.json")
            
        return storage_results
    
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

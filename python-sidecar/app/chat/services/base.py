"""
Base service class with proper error handling and dependency injection
"""
import logging
import os
from typing import Optional, Dict, Any
from supabase import Client, create_client

logger = logging.getLogger(__name__)

class BaseService:
    """Base service with dependency injection and error handling"""

    def __init__(self):
        self.supabase: Optional[Client] = None
        self._initialize_dependencies()

    def _initialize_dependencies(self):
        """Initialize external dependencies with proper error handling"""
        try:
            self.supabase = self._create_supabase_client()
        except Exception as e:
            logger.error(f"Failed to initialize dependencies: {e}")
            raise

    def _create_supabase_client(self) -> Optional[Client]:
        """Create Supabase client with environment validation"""
        url = os.getenv('SUPABASE_URL')
        key = (os.getenv('PY_SUPABASE_SERVICE_KEY') or
               os.getenv('SUPABASE_SERVICE_KEY') or
               os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

        if not url or not key:
            logger.warning("Supabase credentials not found")
            return None

        try:
            client = create_client(url, key)
            # Test connection with a simple query to a known table
            client.table('document_chunks').select('doc_id').limit(1).execute()
            logger.info("Supabase client initialized successfully")
            return client
        except Exception as e:
            logger.error(f"Failed to create Supabase client: {e}")
            return None

    def health_check(self) -> Dict[str, Any]:
        """Service health check"""
        return {
            'service': self.__class__.__name__,
            'supabase_connected': self.supabase is not None,
            'status': 'healthy' if self.supabase else 'degraded'
        }
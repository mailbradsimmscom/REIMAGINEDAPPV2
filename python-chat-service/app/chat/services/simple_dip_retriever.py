"""
Simplified DIP retriever for initial testing
"""
import os
import logging
from typing import Dict, Any, List
from supabase import create_client, Client

logger = logging.getLogger(__name__)

class SimpleDIPRetriever:
    """
    Simplified DIP table retriever for testing
    """

    def __init__(self):
        """Initialize Supabase connection"""
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY")

        if not url or not key:
            raise ValueError("Missing Supabase configuration")

        self.supabase = create_client(url, key)

        # Production table names
        self.tables = {
            "spec_suggestions": "spec_suggestions",
            "playbook_hints": "playbook_hints",
            "intent_router": "intent_router",
            "golden_tests": "golden_tests"
        }

    async def search_spec_suggestions(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Search spec_suggestions table"""
        try:
            result = self.supabase.table("spec_suggestions").select("*").limit(limit).execute()
            return result.data or []
        except Exception as e:
            logger.error(f"Error searching spec suggestions: {e}")
            return []

    async def search_playbook_hints(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Search playbook_hints table"""
        try:
            result = self.supabase.table("playbook_hints").select("*").limit(limit).execute()
            return result.data or []
        except Exception as e:
            logger.error(f"Error searching playbook hints: {e}")
            return []

    async def search_intent_router(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Search intent_router table"""
        try:
            result = self.supabase.table("intent_router").select("*").limit(limit).execute()
            return result.data or []
        except Exception as e:
            logger.error(f"Error searching intent router: {e}")
            return []

    async def search_golden_tests(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Search golden_tests table"""
        try:
            result = self.supabase.table("golden_tests").select("*").limit(limit).execute()
            return result.data or []
        except Exception as e:
            logger.error(f"Error searching golden tests: {e}")
            return []

    async def search_all_tables(self, query: str, limit: int = 3) -> List[Dict[str, Any]]:
        """Search all DIP tables and return combined results"""
        results = []

        # Search each table
        spec_results = await self.search_spec_suggestions(query, limit)
        if spec_results:
            results.append({
                "table": "spec_suggestions",
                "count": len(spec_results),
                "results": spec_results
            })

        playbook_results = await self.search_playbook_hints(query, limit)
        if playbook_results:
            results.append({
                "table": "playbook_hints",
                "count": len(playbook_results),
                "results": playbook_results
            })

        intent_results = await self.search_intent_router(query, limit)
        if intent_results:
            results.append({
                "table": "intent_router",
                "count": len(intent_results),
                "results": intent_results
            })

        test_results = await self.search_golden_tests(query, limit)
        if test_results:
            results.append({
                "table": "golden_tests",
                "count": len(test_results),
                "results": test_results
            })

        return results
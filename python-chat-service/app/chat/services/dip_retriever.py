"""
DIP table retrieval service for querying production tables
"""
import os
from typing import Dict, List, Any, Optional
from supabase import create_client, Client
from ..models import SpecSuggestion, PlaybookHint, IntentRoute, GoldenTest
import logging

logger = logging.getLogger(__name__)


class DIPRetriever:
    """
    Service for querying production DIP tables with smart filtering
    """

    def __init__(self):
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_SERVICE_KEY")

        if not supabase_url or not supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required")

        self.supabase: Client = create_client(supabase_url, supabase_key)

        # Table names (production tables, not staging)
        self.tables = {
            "spec_suggestions": "spec_suggestions",
            "playbook_hints": "playbook_hints",
            "intent_router": "intent_router",
            "golden_tests": "golden_tests"
        }

    async def search_spec_suggestions(
        self,
        query: str,
        equipment_context: Dict[str, Any] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Search spec_suggestions table for parameter information

        Args:
            query: User's query
            equipment_context: Equipment context from memory
            limit: Maximum results to return

        Returns:
            List of spec suggestion results
        """
        try:
            # Build query with text search
            table_name = self.tables["spec_suggestions"]
            supabase_query = self.supabase.from(table_name).select("*")

            # Extract parameter keywords from query
            parameter_keywords = self._extract_parameter_keywords(query)

            if parameter_keywords:
                # Search in parameter and description fields
                search_conditions = []
                for keyword in parameter_keywords[:3]:  # Limit to top 3 keywords
                    search_conditions.append(f"parameter.ilike.%{keyword}%")
                    search_conditions.append(f"description.ilike.%{keyword}%")
                    search_conditions.append(f"normalized_parameter.ilike.%{keyword}%")

                # Combine conditions with OR
                if search_conditions:
                    supabase_query = supabase_query.or_(",".join(search_conditions))

            # Apply equipment context filters if available
            if equipment_context:
                if equipment_context.get("manufacturer"):
                    supabase_query = supabase_query.ilike("manufacturer_norm", f"%{equipment_context['manufacturer']}%")
                if equipment_context.get("model"):
                    supabase_query = supabase_query.ilike("model_norm", f"%{equipment_context['model']}%")

            # Apply limit and ordering
            supabase_query = supabase_query.limit(limit).order("created_at", desc=True)

            # Execute query
            result = supabase_query.execute()

            if result.data:
                logger.info(f"Found {len(result.data)} spec suggestions for query: {query[:50]}...")
                return result.data
            else:
                logger.info(f"No spec suggestions found for query: {query[:50]}...")
                return []

        except Exception as e:
            logger.error(f"Error searching spec suggestions: {e}")
            return []

    async def search_playbook_hints(
        self,
        query: str,
        equipment_context: Dict[str, Any] = None,
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Search playbook_hints table for procedures and instructions

        Args:
            query: User's query
            equipment_context: Equipment context from memory
            limit: Maximum results to return

        Returns:
            List of playbook hint results
        """
        try:
            # Build query
            supabase_query = self.supabase.from(self.tables["playbook_hints"]).select("*")

            # Extract procedure keywords
            procedure_keywords = self._extract_procedure_keywords(query)

            if procedure_keywords:
                search_conditions = []
                for keyword in procedure_keywords[:3]:
                    search_conditions.append(f"title.ilike.%{keyword}%")
                    search_conditions.append(f"description.ilike.%{keyword}%")

                if search_conditions:
                    supabase_query = supabase_query.or_(",".join(search_conditions))

            # Apply equipment context filters
            if equipment_context:
                if equipment_context.get("manufacturer"):
                    supabase_query = supabase_query.ilike("manufacturer_norm", f"%{equipment_context['manufacturer']}%")
                if equipment_context.get("model"):
                    supabase_query = supabase_query.ilike("model_norm", f"%{equipment_context['model']}%")

            # Apply limit and ordering by confidence if available
            supabase_query = supabase_query.limit(limit).order("confidence", desc=True, nulls_last=True)

            result = supabase_query.execute()

            if result.data:
                logger.info(f"Found {len(result.data)} playbook hints for query: {query[:50]}...")
                return result.data
            else:
                logger.info(f"No playbook hints found for query: {query[:50]}...")
                return []

        except Exception as e:
            logger.error(f"Error searching playbook hints: {e}")
            return []

    async def search_intent_router(
        self,
        query: str,
        equipment_context: Dict[str, Any] = None,
        limit: int = 3
    ) -> List[Dict[str, Any]]:
        """
        Search intent_router table for direct question/answer matches

        Args:
            query: User's query
            equipment_context: Equipment context from memory
            limit: Maximum results to return

        Returns:
            List of intent router results
        """
        try:
            # Build query
            supabase_query = self.supabase.from(self.tables["intent_router"]).select("*")

            # Search in question and question_variations
            search_conditions = [
                f"question.ilike.%{query[:100]}%",  # Limit query length
                f"answer.ilike.%{query[:100]}%"
            ]

            # Also search question variations (JSONB array)
            query_words = query.lower().split()[:5]  # Limit to 5 words
            for word in query_words:
                if len(word) > 3:  # Only meaningful words
                    search_conditions.append(f"question_variations::text.ilike.%{word}%")

            supabase_query = supabase_query.or_(",".join(search_conditions))

            # Apply equipment context filters
            if equipment_context:
                if equipment_context.get("manufacturer"):
                    supabase_query = supabase_query.ilike("manufacturer_norm", f"%{equipment_context['manufacturer']}%")

            # Apply limit and ordering
            supabase_query = supabase_query.limit(limit).order("created_at", desc=True)

            result = supabase_query.execute()

            if result.data:
                logger.info(f"Found {len(result.data)} intent routes for query: {query[:50]}...")
                return result.data
            else:
                logger.info(f"No intent routes found for query: {query[:50]}...")
                return []

        except Exception as e:
            logger.error(f"Error searching intent router: {e}")
            return []

    async def search_golden_tests(
        self,
        query: str,
        equipment_context: Dict[str, Any] = None,
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Search golden_tests table for troubleshooting information

        Args:
            query: User's query
            equipment_context: Equipment context from memory
            limit: Maximum results to return

        Returns:
            List of golden test results
        """
        try:
            # Build query
            supabase_query = self.supabase.from(self.tables["golden_tests"]).select("*")

            # Extract troubleshooting keywords
            troubleshooting_keywords = self._extract_troubleshooting_keywords(query)

            if troubleshooting_keywords:
                search_conditions = []
                for keyword in troubleshooting_keywords[:3]:
                    search_conditions.append(f"query.ilike.%{keyword}%")
                    search_conditions.append(f"expected.ilike.%{keyword}%")
                    search_conditions.append(f"test_method.ilike.%{keyword}%")
                    search_conditions.append(f"failure_indication.ilike.%{keyword}%")

                if search_conditions:
                    supabase_query = supabase_query.or_(",".join(search_conditions))

            # Apply equipment context filters
            if equipment_context:
                if equipment_context.get("manufacturer"):
                    supabase_query = supabase_query.ilike("manufacturer_norm", f"%{equipment_context['manufacturer']}%")
                if equipment_context.get("model"):
                    supabase_query = supabase_query.ilike("model_norm", f"%{equipment_context['model']}%")

            # Apply limit and ordering
            supabase_query = supabase_query.limit(limit).order("created_at", desc=True)

            result = supabase_query.execute()

            if result.data:
                logger.info(f"Found {len(result.data)} golden tests for query: {query[:50]}...")
                return result.data
            else:
                logger.info(f"No golden tests found for query: {query[:50]}...")
                return []

        except Exception as e:
            logger.error(f"Error searching golden tests: {e}")
            return []

    def _extract_parameter_keywords(self, query: str) -> List[str]:
        """Extract parameter-related keywords from query"""
        parameter_terms = [
            'pressure', 'temperature', 'flow', 'capacity', 'power', 'voltage',
            'current', 'frequency', 'speed', 'efficiency', 'rating', 'dimension',
            'size', 'weight', 'btu', 'cfm', 'gpm', 'psi', 'amperage', 'wattage'
        ]

        keywords = []
        query_lower = query.lower()

        for term in parameter_terms:
            if term in query_lower:
                keywords.append(term)

        # Also extract quoted terms and capitalized words (likely model numbers)
        words = query.split()
        for word in words:
            if len(word) > 3 and (word.isupper() or any(char.isdigit() for char in word)):
                keywords.append(word.lower())

        return keywords[:5]  # Limit to top 5

    def _extract_procedure_keywords(self, query: str) -> List[str]:
        """Extract procedure-related keywords from query"""
        procedure_terms = [
            'install', 'installation', 'setup', 'configure', 'calibrate', 'adjust',
            'operate', 'operation', 'start', 'startup', 'stop', 'shutdown',
            'maintain', 'maintenance', 'service', 'replace', 'repair', 'clean'
        ]

        keywords = []
        query_lower = query.lower()

        for term in procedure_terms:
            if term in query_lower:
                keywords.append(term)

        return keywords[:5]

    def _extract_troubleshooting_keywords(self, query: str) -> List[str]:
        """Extract troubleshooting-related keywords from query"""
        troubleshooting_terms = [
            'problem', 'issue', 'error', 'fault', 'trouble', 'fail', 'failure',
            'broken', 'malfunction', 'alarm', 'warning', 'code', 'message',
            'diagnose', 'diagnostic', 'troubleshoot', 'fix', 'solve'
        ]

        keywords = []
        query_lower = query.lower()

        for term in troubleshooting_terms:
            if term in query_lower:
                keywords.append(term)

        return keywords[:5]
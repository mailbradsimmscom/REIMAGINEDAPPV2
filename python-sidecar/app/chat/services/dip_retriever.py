"""
DIP Retriever with proper typing and error handling
"""
from typing import List, Dict, Any, Optional, Union
from .base import BaseService
import logging

logger = logging.getLogger(__name__)

class DIPRetriever(BaseService):
    """Type-safe DIP table retriever"""

    # Define table names as constants to avoid runtime errors
    TABLES = {
        'spec': 'spec_suggestions',
        'procedure': 'playbook_hints',
        'troubleshooting': 'golden_tests',
        'routing': 'intent_router'
    }

    async def query_dip_tables(
        self,
        query: str,
        table_types: List[str],
        systems_context: Optional[List[Dict[str, Any]]] = None
    ) -> List[Dict[str, Any]]:
        """Query DIP tables with proper error handling"""
        if not self.supabase:
            logger.warning("Supabase not available, returning empty results")
            return []

        results = []

        for table_type in table_types:
            try:
                table_name = self.TABLES.get(table_type)
                if not table_name:
                    logger.warning(f"Unknown table type: {table_type}")
                    continue

                table_results = await self._query_single_table(
                    table_name, query, systems_context
                )

                if table_results:
                    results.append({
                        'table_type': table_type,
                        'table_name': table_name,
                        'results': table_results,
                        'count': len(table_results)
                    })

            except Exception as e:
                logger.error(f"Failed to query {table_type}: {e}")
                continue

        return results

    async def _query_single_table(
        self,
        table_name: str,
        query: str,
        systems_context: Optional[List[Dict[str, Any]]] = None
    ) -> List[Dict[str, Any]]:
        """Query single table with type safety"""
        try:
            # Build base query - avoid method chaining with dict access
            query_builder = self.supabase.table(table_name)
            query_builder = query_builder.select('*')

            # Add systems context filter
            if systems_context:
                asset_uids = [
                    ctx.get('asset_uid')
                    for ctx in systems_context
                    if ctx.get('asset_uid')
                ]
                if asset_uids:
                    query_builder = query_builder.in_('asset_uid', asset_uids)

            # Add table-specific filters
            query_builder = self._add_table_specific_filters(
                query_builder, table_name, query
            )

            # Execute with limits and ordering
            query_builder = query_builder.order('created_at', desc=True)
            query_builder = query_builder.limit(10)
            result = query_builder.execute()

            return result.data if result and result.data else []

        except Exception as e:
            logger.error(f"Database query failed for {table_name}: {e}")
            return []

    def _add_table_specific_filters(self, query_builder, table_name: str, query: str):
        """Add table-specific search filters without method chaining issues"""
        query_terms = self._extract_search_terms(query)

        if table_name == self.TABLES['spec']:
            # Spec suggestions search
            conditions = []
            for term in query_terms[:3]:
                conditions.extend([
                    f"parameter.ilike.%{term}%",
                    f"category.ilike.%{term}%",
                    f"normalized_parameter.ilike.%{term}%",
                    f"parameter_aliases_text.ilike.%{term}%",
                    f"search_terms_text.ilike.%{term}%",
                    f"concept_group.ilike.%{term}%"
                ])
            if conditions:
                filter_string = ','.join(conditions)
                query_builder = query_builder.or_(filter_string)

        elif table_name == self.TABLES['procedure']:
            # Playbook hints search
            conditions = []
            for term in query_terms[:3]:
                conditions.extend([
                    f"title.ilike.%{term}%",
                    f"description.ilike.%{term}%"
                ])
            if conditions:
                filter_string = ','.join(conditions)
                query_builder = query_builder.or_(filter_string)

        elif table_name == self.TABLES['troubleshooting']:
            # Golden tests search
            conditions = []
            for term in query_terms[:3]:
                conditions.extend([
                    f"query.ilike.%{term}%",
                    f"expected.ilike.%{term}%",
                    f"related_procedures_text.ilike.%{term}%"
                ])
            if conditions:
                filter_string = ','.join(conditions)
                query_builder = query_builder.or_(filter_string)

        elif table_name == self.TABLES['routing']:
            # Intent router search
            conditions = []
            for term in query_terms[:3]:
                conditions.extend([
                    f"question.ilike.%{term}%",
                    f"answer.ilike.%{term}%",
                    f"question_variations_text.ilike.%{term}%"
                ])
            if conditions:
                filter_string = ','.join(conditions)
                query_builder = query_builder.or_(filter_string)

        return query_builder

    def _extract_search_terms(self, query: str) -> List[str]:
        """Extract meaningful search terms"""
        stop_words = {'the', 'is', 'are', 'what', 'how', 'do', 'does', 'can', 'should'}
        terms = [
            word.lower().strip()
            for word in query.split()
            if len(word) > 2 and word.lower() not in stop_words
        ]
        return terms[:5]  # Limit terms
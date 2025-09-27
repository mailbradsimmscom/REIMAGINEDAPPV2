"""
Production DIP Retriever for live data queries
"""
from typing import List, Dict, Any, Optional
from .base import BaseService
import logging

logger = logging.getLogger(__name__)

class ProductionDIPRetriever(BaseService):
    """Production DIP table retriever for live data"""

    # Production table names (without staging_ prefix)
    PRODUCTION_TABLES = {
        'spec': 'spec_suggestions',
        'procedure': 'playbook_hints',
        'troubleshooting': 'golden_tests',
        'routing': 'intent_router'
    }

    # Alternative production table patterns to try
    ALTERNATIVE_TABLES = {
        'spec': ['dip_specs', 'production_specs', 'specifications'],
        'procedure': ['dip_procedures', 'production_procedures', 'procedures'],
        'troubleshooting': ['dip_troubleshooting', 'production_tests', 'troubleshooting_guides'],
        'routing': ['dip_routing', 'production_routing', 'routing_rules']
    }

    def __init__(self):
        super().__init__()
        self._validated_tables = {}
        self._table_validation_complete = False

    async def validate_production_tables(self) -> Dict[str, str]:
        """Validate which production tables actually exist"""
        if self._table_validation_complete:
            return self._validated_tables

        if not self.supabase:
            logger.warning("Supabase not available for table validation")
            return {}

        validated = {}

        for table_type, primary_table in self.PRODUCTION_TABLES.items():
            # Try primary table name first
            tables_to_try = [primary_table] + self.ALTERNATIVE_TABLES.get(table_type, [])

            for table_name in tables_to_try:
                try:
                    # Test table existence with a minimal query
                    result = self.supabase.table(table_name).select('*').limit(1).execute()
                    validated[table_type] = table_name
                    logger.info(f"✅ Validated production table '{table_type}' -> '{table_name}'")
                    break
                except Exception as e:
                    if 'does not exist' in str(e) or 'relation' in str(e):
                        logger.debug(f"Table '{table_name}' does not exist")
                        continue
                    else:
                        logger.warning(f"Error checking table '{table_name}': {e}")
                        continue

            if table_type not in validated:
                logger.warning(f"❌ No production table found for type '{table_type}'")

        self._validated_tables = validated
        self._table_validation_complete = True

        logger.info(f"Production table validation complete: {validated}")
        return validated

    async def query_production_dip_tables(
        self,
        query: str,
        table_types: List[str],
        systems_context: Optional[List[Dict[str, Any]]] = None
    ) -> List[Dict[str, Any]]:
        """Query production DIP tables with validation"""
        if not self.supabase:
            logger.warning("Supabase not available, returning empty results")
            return []

        # Validate tables first
        validated_tables = await self.validate_production_tables()
        if not validated_tables:
            logger.error("No validated production tables available")
            return []

        results = []

        for table_type in table_types:
            if table_type not in validated_tables:
                logger.warning(f"Table type '{table_type}' not available in production")
                continue

            table_name = validated_tables[table_type]

            try:
                table_results = await self._query_single_production_table(
                    table_name, query, systems_context
                )

                if table_results:
                    results.append({
                        'table_type': table_type,
                        'table_name': table_name,
                        'results': table_results,
                        'count': len(table_results)
                    })
                    logger.info(f"Retrieved {len(table_results)} results from production table {table_name}")

            except Exception as e:
                logger.error(f"Failed to query production table {table_name}: {e}")
                continue

        return results

    async def _query_single_production_table(
        self,
        table_name: str,
        query: str,
        systems_context: Optional[List[Dict[str, Any]]] = None
    ) -> List[Dict[str, Any]]:
        """Query single production table with enhanced filtering"""
        try:
            # Build base query with production-optimized approach
            query_builder = self.supabase.table(table_name)
            query_builder = query_builder.select('*')

            # Add systems context filter (more restrictive for production)
            has_asset_uids = False
            if systems_context:
                asset_uids = [
                    ctx.get('asset_uid')
                    for ctx in systems_context
                    if ctx.get('asset_uid')
                ]
                if asset_uids:
                    # Use 'in' filter for production efficiency
                    query_builder = query_builder.in_('asset_uid', asset_uids)
                    has_asset_uids = True

            # Add production-specific filters (skip text search if we have asset_uids)
            if not has_asset_uids:
                query_builder = self._add_production_table_filters(
                    query_builder, table_name, query
                )

            # Add production limits for performance
            query_builder = query_builder.limit(200)  # Production limit

            # Execute query
            result = query_builder.execute()
            return result.data if result.data else []

        except Exception as e:
            logger.error(f"Production table query failed for {table_name}: {e}")
            return []

    def _add_production_table_filters(self, query_builder, table_name: str, query: str):
        """Add production-optimized table-specific filters"""
        query_lower = query.lower()

        try:
            # Production-optimized filters with performance considerations
            if 'spec' in table_name or 'suggestion' in table_name:
                # Specs: search in text columns including flattened JSONB
                query_builder = query_builder.or_(
                    f"parameter.ilike.%{query}%,"
                    f"normalized_parameter.ilike.%{query}%,"
                    f"value.ilike.%{query}%,"
                    f"range.ilike.%{query}%,"
                    f"category.ilike.%{query}%,"
                    f"concept_group.ilike.%{query}%,"
                    f"parameter_aliases_text.ilike.%{query}%,"
                    f"search_terms_text.ilike.%{query}%,"
                    f"references_text.ilike.%{query}%"
                )

            elif 'playbook' in table_name or 'procedure' in table_name or 'hint' in table_name:
                # Procedures: search in text columns including flattened JSONB
                query_builder = query_builder.or_(
                    f"expected_outcome.ilike.%{query}%,"
                    f"steps_text.ilike.%{query}%,"
                    f"preconditions_text.ilike.%{query}%,"
                    f"error_codes_text.ilike.%{query}%"
                )

            elif 'golden' in table_name or 'test' in table_name or 'troubleshoot' in table_name:
                # Troubleshooting: search in text columns including flattened JSONB
                query_builder = query_builder.or_(
                    f"query.ilike.%{query}%,"
                    f"expected.ilike.%{query}%,"
                    f"test_method.ilike.%{query}%,"
                    f"failure_indication.ilike.%{query}%,"
                    f"related_procedures_text.ilike.%{query}%"
                )

            elif 'intent' in table_name or 'routing' in table_name or 'router' in table_name:
                # Intent routing: search in text columns including flattened JSONB
                query_builder = query_builder.or_(
                    f"question.ilike.%{query}%,"
                    f"answer.ilike.%{query}%,"
                    f"question_type.ilike.%{query}%,"
                    f"question_variations_text.ilike.%{query}%,"
                    f"references_text.ilike.%{query}%"
                )

            # Add production status filter (only approved content)
            # Production tables use 'approved' status
            try:
                query_builder = query_builder.eq('status', 'approved')
            except:
                # If no status field, continue without it
                pass

        except Exception as e:
            logger.warning(f"Could not apply production filters to {table_name}: {e}")
            # Return basic text search fallback
            query_builder = query_builder.text_search('content', query)

        return query_builder

    def health_check(self) -> Dict[str, Any]:
        """Health check for production DIP retriever"""
        base_health = super().health_check()

        # Add production-specific health info
        production_health = {
            **base_health,
            'service': 'ProductionDIPRetriever',
            'validated_tables': self._validated_tables,
            'table_validation_complete': self._table_validation_complete,
            'production_mode': True
        }

        if self._validated_tables:
            production_health['available_table_types'] = list(self._validated_tables.keys())
            production_health['table_count'] = len(self._validated_tables)

        return production_health

    async def get_table_stats(self) -> Dict[str, Any]:
        """Get statistics about production tables"""
        if not self.supabase:
            return {"error": "Supabase not available"}

        validated_tables = await self.validate_production_tables()
        stats = {}

        for table_type, table_name in validated_tables.items():
            try:
                # Get row count
                result = self.supabase.table(table_name).select('*', count='exact').limit(1).execute()
                stats[table_type] = {
                    'table_name': table_name,
                    'row_count': result.count,
                    'status': 'available'
                }
            except Exception as e:
                stats[table_type] = {
                    'table_name': table_name,
                    'error': str(e),
                    'status': 'error'
                }

        return stats
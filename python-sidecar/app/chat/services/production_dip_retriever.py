"""
Production DIP Retriever for v5 Chat Retrieval

Uses v5 filtering:
- doc_id scoping (candidate_doc_ids)
- applies_to_models overlap with focus/boat models
- Two queries per table (model-scoped + universal), then union/dedupe
- Tier A → B → C fallback (threshold: <2 rows)

See: .cursor/plans/v5_chat_retrieval_v5_tags_and_doc_scoping.plan.md
"""

import logging
from typing import Any, Dict, List, Optional

from .base import BaseService

logger = logging.getLogger(__name__)


def _pg_array_literal(values: list[str]) -> str:
    """
    Build PostgREST array literal like "{A,B}" for overlap/contains operators.
    """
    safe = [v.replace('"', '').replace('{', '').replace('}', '').replace(',', '') for v in values if v]
    return "{" + ",".join(safe) + "}"


def _dedupe_rows(rows: list[dict]) -> list[dict]:
    """
    Deduplicate rows by stable primary key.
    Prefer 'id' or 'uid', fallback to composite key.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for r in rows:
        key = str(r.get("id") or r.get("uid") or (
            r.get("doc_id"),
            r.get("symptom") or r.get("parameter") or r.get("question") or r.get("expected_outcome"),
            r.get("cause") or r.get("value") or r.get("answer")
        ))
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


# Stop words to filter out from search terms
STOP_WORDS = {
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'how', 'what', 'when', 'where', 'why', 'which', 'who', 'whom',
    'this', 'that', 'these', 'those', 'it', 'its', 'my', 'your', 'our',
    'me', 'about', 'tell', 'show', 'get', 'give'
}

# Max terms to use in DIP text search
MAX_TERMS = 6

# Columns to search per table type
COLUMNS_BY_TABLE_TYPE = {
    'spec': ['parameter', 'normalized_parameter', 'value', 'range', 'category',
             'concept_group', 'parameter_aliases_text', 'search_terms_text', 'references_text'],
    'procedure': ['expected_outcome', 'steps_text', 'preconditions_text', 'error_codes_text'],
    'troubleshooting': ['symptom', 'cause', 'resolution', 'check_action'],
    'golden_rules': ['query', 'expected', 'test_method', 'failure_indication', 'related_procedures_text'],
    'routing': ['question', 'answer', 'question_type', 'question_variations_text', 'references_text']
}


def normalize_terms(keywords: List[str], user_query: str = "") -> List[str]:
    """
    Normalize search keywords into a deduplicated term list.

    - Lowercase
    - Strip punctuation
    - Dedupe
    - Drop stop words
    - Enforce min length >= 3
    - Cap to MAX_TERMS
    """
    import re

    # Combine keywords and user query words
    all_words = []
    for kw in keywords:
        all_words.extend(kw.lower().split())
    if user_query and not keywords:
        all_words.extend(user_query.lower().split())

    # Normalize each word
    terms = []
    seen = set()
    for word in all_words:
        # Strip punctuation
        clean = re.sub(r'[^\w]', '', word)
        # Skip if too short, stop word, or already seen
        if len(clean) < 3 or clean in STOP_WORDS or clean in seen:
            continue
        seen.add(clean)
        terms.append(clean)
        if len(terms) >= MAX_TERMS:
            break

    return terms


class ProductionDIPRetriever(BaseService):
    """
    Production DIP table retriever with v5 filtering.

    Table mapping for 5 DIP buckets:
    - specs → spec_suggestions
    - procedures → playbook_hints
    - troubleshooting → troubleshooting
    - golden_rules → golden_tests
    - routing → intent_router
    """

    # Production table mapping (5 buckets)
    PRODUCTION_TABLES = {
        'spec': 'spec_suggestions',
        'procedure': 'playbook_hints',
        'troubleshooting': 'troubleshooting',  # NOT golden_tests
        'golden_rules': 'golden_tests',
        'routing': 'intent_router'
    }

    # Per-table query limit (performance guardrail)
    PER_TABLE_LIMIT = 200

    # Tier fallback threshold
    TIER_THRESHOLD = 2

    def __init__(self):
        super().__init__()
        self._validated_tables: Dict[str, str] = {}
        self._table_validation_complete = False

    async def validate_production_tables(self) -> Dict[str, str]:
        """Validate which production tables actually exist."""
        if self._table_validation_complete:
            return self._validated_tables

        if not self.supabase:
            logger.warning("Supabase not available for table validation")
            return {}

        validated = {}

        for table_type, table_name in self.PRODUCTION_TABLES.items():
            try:
                # Test table existence with a minimal query
                result = self.supabase.table(table_name).select('*').limit(1).execute()
                validated[table_type] = table_name
                logger.info(f"✅ Validated production table '{table_type}' -> '{table_name}'")
            except Exception as e:
                if 'does not exist' in str(e) or 'relation' in str(e):
                    logger.warning(f"❌ Table '{table_name}' does not exist for type '{table_type}'")
                else:
                    logger.warning(f"Error checking table '{table_name}': {e}")

        self._validated_tables = validated
        self._table_validation_complete = True

        logger.info(f"Production table validation complete: {list(validated.keys())}")
        return validated

    async def query_production_dip_tables(
        self,
        query: str,
        table_types: List[str],
        systems_context: Optional[List[Dict[str, Any]]] = None,
        retrieval_scope: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Query production DIP tables with v5 filtering.

        Args:
            query: Search query text
            table_types: List of table types to query (spec, procedure, troubleshooting, etc.)
            systems_context: Equipment context (legacy, used for fallback)
            retrieval_scope: v5 retrieval scope with candidate_doc_ids, focus_models, boat_models

        Returns:
            List of result dicts with table_type, table_name, results, count
        """
        if not self.supabase:
            logger.warning("Supabase not available, returning empty results")
            return []

        # Validate tables first
        validated_tables = await self.validate_production_tables()
        if not validated_tables:
            logger.error("No validated production tables available")
            return []

        # Extract v5 scope
        focus_models = retrieval_scope.get("focus_models", []) if retrieval_scope else []
        boat_models = retrieval_scope.get("boat_models", []) if retrieval_scope else []
        candidate_doc_ids = retrieval_scope.get("candidate_doc_ids", []) if retrieval_scope else []
        # Extract referenced_systems for referenced-scoped queries (avoids polluting primary-only queries)
        referenced_systems = retrieval_scope.get("referenced_systems", []) if retrieval_scope else []

        # Normalize query into search terms (OR-across-terms instead of phrase)
        terms = normalize_terms(query.split() if query else [], query)
        logger.info(f"🔍 DIP v5 Query: focus_models={focus_models}, boat_models={len(boat_models)}, candidate_docs={len(candidate_doc_ids)}, referenced_systems={len(referenced_systems)}, terms={terms}")

        # Determine starting tier
        has_candidates = bool(candidate_doc_ids)
        if not has_candidates:
            starting_tier = "C"
            logger.info("⚠️  No candidate docs - starting at Tier C")
        else:
            starting_tier = "A"

        results = []
        total_rows = 0
        tier_used = starting_tier

        for table_type in table_types:
            if table_type not in validated_tables:
                logger.warning(f"Table type '{table_type}' not available in production")
                continue

            table_name = validated_tables[table_type]

            try:
                # Query with tier fallback
                table_results, table_tier = await self._query_table_with_tiers(
                    table_name=table_name,
                    table_type=table_type,
                    terms=terms,
                    starting_tier=starting_tier,
                    candidate_doc_ids=candidate_doc_ids,
                    focus_models=focus_models,
                    boat_models=boat_models,
                    referenced_systems=referenced_systems
                )

                if table_results:
                    results.append({
                        'table_type': table_type,
                        'table_name': table_name,
                        'results': table_results,
                        'count': len(table_results),
                        'tier_used': table_tier
                    })
                    total_rows += len(table_results)
                    logger.info(f"✅ {table_type}: {len(table_results)} rows (tier {table_tier})")

            except Exception as e:
                logger.error(f"Failed to query production table {table_name}: {e}")
                continue

        logger.info(f"🎯 DIP v5 Complete: {len(results)} tables, {total_rows} total rows")
        return results

    async def _query_table_with_tiers(
        self,
        table_name: str,
        table_type: str,
        terms: List[str],
        starting_tier: str,
        candidate_doc_ids: List[str],
        focus_models: List[str],
        boat_models: List[str],
        referenced_systems: Optional[List[str]] = None
    ) -> tuple[List[Dict[str, Any]], str]:
        """
        Query a single table with Tier A → B → C fallback.

        Returns (results, tier_used)
        """
        tier = starting_tier
        results = []

        # Tier A: focus_models + candidate_doc_ids + referenced_systems
        if tier == "A":
            results = await self._query_table_v5(
                table_name=table_name,
                table_type=table_type,
                terms=terms,
                candidate_doc_ids=candidate_doc_ids,
                allowed_models=focus_models,
                referenced_systems=referenced_systems
            )

            if len(results) >= self.TIER_THRESHOLD:
                return results, "A"

            # Fallback to Tier B
            tier = "B"
            logger.debug(f"  {table_type}: Tier A returned {len(results)} rows, trying Tier B")

        # Tier B: boat_models + candidate_doc_ids + referenced_systems
        if tier == "B":
            results = await self._query_table_v5(
                table_name=table_name,
                table_type=table_type,
                terms=terms,
                candidate_doc_ids=candidate_doc_ids,
                allowed_models=boat_models,
                referenced_systems=referenced_systems
            )

            if len(results) >= self.TIER_THRESHOLD:
                return results, "B"

            # Fallback to Tier C
            tier = "C"
            logger.debug(f"  {table_type}: Tier B returned {len(results)} rows, trying Tier C")

        # Tier C: boat_models, no doc restriction + referenced_systems
        if tier == "C":
            results = await self._query_table_v5(
                table_name=table_name,
                table_type=table_type,
                terms=terms,
                candidate_doc_ids=[],  # No doc restriction
                allowed_models=boat_models,
                referenced_systems=referenced_systems
            )
            return results, "C"

        return results, tier

    async def _query_table_v5(
        self,
        table_name: str,
        table_type: str,
        terms: List[str],
        candidate_doc_ids: List[str],
        allowed_models: List[str],
        referenced_systems: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        Query a table with v5 filtering using three queries:
        1. model-scoped (applies_to_models overlap)
        2. universal (applies_to_models contains "all")
        3. referenced-scoped (referenced_systems overlap) - only if referenced_systems provided
        """
        # Query 1: model-scoped rows
        model_scoped = await self._dip_query_model_scoped(
            table_name=table_name,
            table_type=table_type,
            terms=terms,
            candidate_doc_ids=candidate_doc_ids,
            allowed_models=allowed_models
        )

        # Query 2: universal rows (applies_to_models contains "all")
        universal = await self._dip_query_universal(
            table_name=table_name,
            table_type=table_type,
            terms=terms,
            candidate_doc_ids=candidate_doc_ids
        )

        # Query 3: referenced-scoped rows (if referenced_systems provided)
        referenced = []
        if referenced_systems:
            referenced = await self._dip_query_referenced_scoped(
                table_name=table_name,
                table_type=table_type,
                terms=terms,
                candidate_doc_ids=candidate_doc_ids,
                referenced_systems=referenced_systems
            )

        # Union and dedupe
        combined = model_scoped + universal + referenced
        deduped = _dedupe_rows(combined)

        return deduped

    async def _dip_query_model_scoped(
        self,
        table_name: str,
        table_type: str,
        terms: List[str],
        candidate_doc_ids: List[str],
        allowed_models: List[str]
    ) -> List[Dict[str, Any]]:
        """Query for rows where applies_to_models overlaps with allowed_models."""
        if not allowed_models:
            return []

        try:
            qb = self.supabase.table(table_name).select("*")

            # doc_id scoping (if available)
            if candidate_doc_ids:
                try:
                    qb = qb.in_("doc_id", candidate_doc_ids)
                except Exception:
                    # Table may not have doc_id; proceed without
                    pass

            # applies_to_models overlap filter
            try:
                qb = qb.filter("applies_to_models", "ov", _pg_array_literal(allowed_models))
            except Exception as e:
                logger.warning(f"Table {table_name} may not have applies_to_models: {e}")
                return []

            # Text relevance filter (OR across terms × columns)
            qb = self._add_text_filters(qb, table_name, table_type, terms)

            # Status filter (allow both dip_extracted and approved)
            qb = self._add_status_filter(qb, table_name)

            # Limit
            qb = qb.limit(self.PER_TABLE_LIMIT)

            result = qb.execute()
            return result.data or []

        except Exception as e:
            logger.error(f"Model-scoped query failed for {table_name}: {e}")
            return []

    async def _dip_query_universal(
        self,
        table_name: str,
        table_type: str,
        terms: List[str],
        candidate_doc_ids: List[str]
    ) -> List[Dict[str, Any]]:
        """Query for rows where applies_to_models contains "all"."""
        try:
            qb = self.supabase.table(table_name).select("*")

            # doc_id scoping (if available)
            if candidate_doc_ids:
                try:
                    qb = qb.in_("doc_id", candidate_doc_ids)
                except Exception:
                    pass

            # applies_to_models contains "all" filter
            try:
                qb = qb.filter("applies_to_models", "cs", _pg_array_literal(["all"]))
            except Exception as e:
                logger.warning(f"Table {table_name} may not have applies_to_models: {e}")
                return []

            # Text relevance filter (OR across terms × columns)
            qb = self._add_text_filters(qb, table_name, table_type, terms)

            # Status filter
            qb = self._add_status_filter(qb, table_name)

            # Limit
            qb = qb.limit(self.PER_TABLE_LIMIT)

            result = qb.execute()
            return result.data or []

        except Exception as e:
            logger.error(f"Universal query failed for {table_name}: {e}")
            return []

    async def _dip_query_referenced_scoped(
        self,
        table_name: str,
        table_type: str,
        terms: List[str],
        candidate_doc_ids: List[str],
        referenced_systems: List[str]
    ) -> List[Dict[str, Any]]:
        """Query for rows where referenced_systems overlaps with provided systems.

        This retrieves DIP rows that are about referenced systems (e.g., VC20 windlass)
        without polluting primary-only queries.
        """
        if not referenced_systems:
            return []

        try:
            qb = self.supabase.table(table_name).select("*")

            # doc_id scoping (if available)
            if candidate_doc_ids:
                try:
                    qb = qb.in_("doc_id", candidate_doc_ids)
                except Exception:
                    pass

            # referenced_systems overlap filter
            try:
                qb = qb.filter("referenced_systems", "ov", _pg_array_literal(referenced_systems))
            except Exception as e:
                logger.warning(f"Table {table_name} may not have referenced_systems: {e}")
                return []

            # Text relevance filter (OR across terms × columns)
            qb = self._add_text_filters(qb, table_name, table_type, terms)

            # Status filter
            qb = self._add_status_filter(qb, table_name)

            # Limit
            qb = qb.limit(self.PER_TABLE_LIMIT)

            result = qb.execute()
            return result.data or []

        except Exception as e:
            logger.error(f"Referenced-scoped query failed for {table_name}: {e}")
            return []

    def _add_text_filters(self, qb, table_name: str, table_type: str, terms: List[str]):
        """
        Add text relevance filters based on table type.

        Uses OR across terms × columns: any term matching any column passes.
        """
        if not terms:
            # No terms = no text filter (return all rows within v5 scope)
            return qb

        columns = COLUMNS_BY_TABLE_TYPE.get(table_type, [])
        if not columns:
            return qb

        try:
            # Build OR conditions: term1 in col1, term1 in col2, ..., term2 in col1, ...
            conditions = []
            for term in terms:
                for col in columns:
                    conditions.append(f"{col}.ilike.%{term}%")

            if conditions:
                qb = qb.or_(",".join(conditions))

        except Exception as e:
            logger.warning(f"Could not apply text filters to {table_name}: {e}")

        return qb

    def _add_status_filter(self, qb, table_name: str):
        """
        Add status filter allowing both 'dip_extracted' and 'approved'.

        Per plan: existing data uses 'dip_extracted', we want forward compatibility.
        """
        try:
            # Use in_ for multiple status values
            qb = qb.in_("status", ["dip_extracted", "approved"])
        except Exception:
            # If no status field, continue without it
            pass

        return qb

    def health_check(self) -> Dict[str, Any]:
        """Health check for production DIP retriever."""
        base_health = super().health_check()

        return {
            **base_health,
            'service': 'ProductionDIPRetriever',
            'validated_tables': self._validated_tables,
            'table_validation_complete': self._table_validation_complete,
            'production_mode': True,
            'v5_filtering': True
        }

    async def get_table_stats(self) -> Dict[str, Any]:
        """Get statistics about production tables."""
        if not self.supabase:
            return {"error": "Supabase not available"}

        validated_tables = await self.validate_production_tables()
        stats = {}

        for table_type, table_name in validated_tables.items():
            try:
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

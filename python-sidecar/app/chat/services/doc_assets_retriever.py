"""
Doc Assets Retriever for v5 Chat Retrieval

Retrieves figures and tables from doc_assets using v5 filtering:
- doc_id scoping (candidate_doc_ids)
- Model scoping (two-category rule from primary vs referencing docs)
- Text search on search_blob, title, description, figure_reference
- LLM selection to pick most relevant assets

See: .cursor/plans/chat_diagrams_and_metrics_integration_b282269b.plan.md
"""

import json
import logging
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI

from .base import BaseService

logger = logging.getLogger(__name__)


# ============================================================================
# CONSTANTS
# ============================================================================

MAX_TERMS = 6
SHORTLIST_K = 12  # Deterministic shortlist size
SELECT_N = 3      # LLM selects top N to show

STOP_WORDS = {
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'how', 'what', 'when', 'where', 'why', 'which', 'who', 'whom',
    'this', 'that', 'these', 'those', 'it', 'its', 'my', 'your', 'our',
    'me', 'about', 'tell', 'show', 'get', 'give'
}

# Columns to search for text matching
TEXT_SEARCH_COLUMNS = ['search_blob', 'title', 'description', 'figure_reference']


# ============================================================================
# TERM NORMALIZATION
# ============================================================================

def normalize_terms(keywords: List[str], user_query: str = "") -> List[str]:
    """Normalize search keywords into a deduplicated term list."""
    all_words = []
    for kw in keywords:
        all_words.extend(kw.lower().split())
    if user_query and not keywords:
        all_words.extend(user_query.lower().split())

    terms = []
    seen = set()
    for word in all_words:
        clean = re.sub(r'[^\w]', '', word)
        if len(clean) < 3 or clean in STOP_WORDS or clean in seen:
            continue
        seen.add(clean)
        terms.append(clean)
        if len(terms) >= MAX_TERMS:
            break
    return terms


# ============================================================================
# DOC ASSETS RETRIEVER
# ============================================================================

class DocAssetsRetriever(BaseService):
    """
    Retrieves doc_assets (figures/tables) using v5 filtering + LLM selection.
    """

    def __init__(self):
        super().__init__()
        self.openai = AsyncOpenAI(api_key=os.environ.get('OPENAI_API_KEY'))
        self.supabase_url = os.environ.get('SUPABASE_URL', '')

    def _build_public_url(self, storage_path: str) -> str:
        """Build public URL for asset image."""
        if not storage_path:
            return ''
        return f"{self.supabase_url}/storage/v1/object/public/documents/{storage_path}"

    async def query_doc_assets(
        self,
        query: str,
        retrieval_scope: Dict[str, Any],
        search_keywords: Optional[List[str]] = None,
        intent: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Query doc_assets with v5 filtering and LLM selection.

        Args:
            query: User query text
            retrieval_scope: v5 scope with focus_models, candidate_doc_ids, etc.
            search_keywords: Optional keywords from classification
            intent: Optional intent from classification (for ranking boost)

        Returns:
            Result dict with selected assets and metrics
        """
        start_time = datetime.now()

        # Extract scope
        focus_models = retrieval_scope.get('focus_models', [])
        primary_doc_ids = retrieval_scope.get('candidate_primary_doc_ids', [])
        referencing_doc_ids = retrieval_scope.get('candidate_referencing_doc_ids', [])

        # Normalize search terms
        terms = normalize_terms(search_keywords or [], query)

        logger.info(f"🖼️ DOC_ASSETS query: terms={terms}, focus_models={focus_models}, "
                   f"primary_docs={len(primary_doc_ids)}, ref_docs={len(referencing_doc_ids)}")

        # Stage 1: Query with v5 filtering
        all_doc_ids = primary_doc_ids + referencing_doc_ids
        candidates = await self._query_with_v5_filters(
            terms=terms,
            doc_ids=all_doc_ids,
            focus_models=focus_models,
            primary_doc_ids=primary_doc_ids,
            referencing_doc_ids=referencing_doc_ids
        )

        query_duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
        logger.info(f"🖼️ DOC_ASSETS Stage 1: {len(candidates)} candidates in {query_duration_ms}ms")

        if not candidates:
            return self._build_result([], [], query_duration_ms, 0, terms)

        # Stage 2: Deterministic shortlist (top K by text relevance score)
        shortlist = self._rank_and_shortlist(candidates, terms, intent, k=SHORTLIST_K)
        logger.info(f"🖼️ DOC_ASSETS Stage 2: shortlist={len(shortlist)} assets")

        # Stage 3: LLM selection (pick N from shortlist)
        llm_start = datetime.now()
        selected = await self._llm_select(query, shortlist, n=SELECT_N)
        llm_duration_ms = int((datetime.now() - llm_start).total_seconds() * 1000)
        logger.info(f"🖼️ DOC_ASSETS Stage 3: selected={len(selected)} in {llm_duration_ms}ms")

        total_duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)
        logger.info(f"🖼️ DOC_ASSETS complete: {len(selected)} assets in {total_duration_ms}ms")

        return self._build_result(selected, candidates, query_duration_ms, llm_duration_ms, terms)

    async def _query_with_v5_filters(
        self,
        terms: List[str],
        doc_ids: List[str],
        focus_models: List[str],
        primary_doc_ids: List[str],
        referencing_doc_ids: List[str]
    ) -> List[Dict[str, Any]]:
        """
        Query doc_assets with v5 filtering rules.

        Filtering logic:
        - Doc scoping: doc_id IN doc_ids (if provided)
        - Model scoping (two-category rule):
          - From primary docs: is_universal=true OR applies_to_models overlaps focus_models
          - From referencing docs: referenced_systems overlaps focus_models
        - Text matching: OR across terms x columns
        """
        if not self.supabase:
            logger.error("Supabase client not initialized")
            return []

        try:
            # Start query
            qb = self.supabase.table('doc_assets').select('*')

            # Doc scoping
            if doc_ids:
                qb = qb.in_('doc_id', doc_ids)

            # Build text filter (OR across terms x columns)
            if terms:
                or_conditions = []
                for term in terms:
                    for col in TEXT_SEARCH_COLUMNS:
                        or_conditions.append(f"{col}.ilike.%{term}%")
                if or_conditions:
                    qb = qb.or_(','.join(or_conditions))

            # Execute query
            response = qb.limit(100).execute()
            candidates = response.data or []

            # Apply model scoping in Python (PostgREST OR logic is limited)
            filtered = []
            for asset in candidates:
                doc_id = asset.get('doc_id')
                is_universal = asset.get('is_universal', False)
                applies_to = asset.get('applies_to_models', [])
                referenced = asset.get('referenced_systems', [])

                # Primary doc rule
                if doc_id in primary_doc_ids:
                    if is_universal:
                        filtered.append(asset)
                    elif any(m in applies_to for m in focus_models):
                        filtered.append(asset)
                # Referencing doc rule
                elif doc_id in referencing_doc_ids:
                    if any(m in referenced for m in focus_models):
                        filtered.append(asset)
                # No doc scoping (Tier C fallback)
                elif not doc_ids:
                    filtered.append(asset)

            return filtered

        except Exception as e:
            logger.error(f"Error querying doc_assets: {e}")
            return []

    def _rank_and_shortlist(
        self,
        candidates: List[Dict[str, Any]],
        terms: List[str],
        intent: Optional[str],
        k: int
    ) -> List[Dict[str, Any]]:
        """
        Rank candidates by text relevance and return top K.

        Scoring:
        - Exact figure_reference match: +100
        - Term hit in search_blob: +10 per term
        - Term hit in title: +5 per term
        - Term hit in description: +3 per term
        - Intent boost: +20 if asset_kind matches intent
        """
        scored = []
        for asset in candidates:
            score = 0

            search_blob = (asset.get('search_blob') or '').lower()
            title = (asset.get('title') or '').lower()
            description = (asset.get('description') or '').lower()
            figure_ref = (asset.get('figure_reference') or '').lower()
            asset_kind = asset.get('asset_kind', '')

            for term in terms:
                term_lower = term.lower()
                # Exact figure reference match
                if term_lower in figure_ref:
                    score += 100
                # search_blob hits
                if term_lower in search_blob:
                    score += 10
                # title hits
                if term_lower in title:
                    score += 5
                # description hits
                if term_lower in description:
                    score += 3

            # Intent boost
            if intent:
                if intent in ['procedure', 'troubleshooting'] and asset_kind == 'figure':
                    score += 20
                elif intent in ['spec', 'specification'] and asset_kind == 'table':
                    score += 20

            scored.append((score, asset))

        # Sort by score descending
        scored.sort(key=lambda x: x[0], reverse=True)

        # Return top K with scores attached
        result = []
        for score, asset in scored[:k]:
            asset['_relevance_score'] = score
            result.append(asset)

        return result

    async def _llm_select(
        self,
        query: str,
        shortlist: List[Dict[str, Any]],
        n: int
    ) -> List[Dict[str, Any]]:
        """
        Use LLM to select top N assets from shortlist.
        """
        if len(shortlist) <= n:
            return shortlist

        # Build candidate descriptions for LLM
        candidate_texts = []
        for i, asset in enumerate(shortlist):
            desc = f"[{i}] "
            desc += f"{asset.get('asset_kind', 'asset').upper()}"
            if asset.get('figure_reference'):
                desc += f" {asset['figure_reference']}"
            if asset.get('title'):
                desc += f": {asset['title']}"
            if asset.get('search_blob'):
                # Truncate search_blob for prompt
                blob = asset['search_blob'][:200]
                desc += f" - {blob}"
            candidate_texts.append(desc)

        prompt = f"""Given this user question about marine equipment:
"{query}"

Select the {n} most relevant diagrams/tables from this list. Return ONLY the indices as a JSON array like [0, 2, 5].

Candidates:
{chr(10).join(candidate_texts)}

Return only the JSON array of {n} indices, nothing else."""

        try:
            response = await self.openai.chat.completions.create(
                model='gpt-4o-mini',
                messages=[{'role': 'user', 'content': prompt}],
                max_tokens=50,
                temperature=0
            )

            result_text = response.choices[0].message.content.strip()
            # Parse JSON array
            indices = json.loads(result_text)

            selected = []
            for idx in indices[:n]:
                if 0 <= idx < len(shortlist):
                    selected.append(shortlist[idx])

            return selected

        except Exception as e:
            logger.warning(f"LLM selection failed: {e}, falling back to top {n}")
            return shortlist[:n]

    def _build_result(
        self,
        selected: List[Dict[str, Any]],
        all_candidates: List[Dict[str, Any]],
        query_duration_ms: int,
        llm_duration_ms: int,
        terms: List[str]
    ) -> Dict[str, Any]:
        """
        Build result dict for chat workflow.
        """
        # Format selected assets for output
        formatted_assets = []
        for asset in selected:
            formatted_assets.append({
                'id': asset.get('id'),
                'doc_id': asset.get('doc_id'),
                'page_number': asset.get('page_number'),
                'asset_kind': asset.get('asset_kind'),
                'asset_type': asset.get('asset_type'),
                'title': asset.get('title'),
                'description': asset.get('description'),
                'figure_reference': asset.get('figure_reference'),
                'search_blob': asset.get('search_blob'),
                'storage_path': asset.get('storage_path'),
                'public_url': self._build_public_url(asset.get('storage_path', '')),
                'applies_to_models': asset.get('applies_to_models'),
                'referenced_systems': asset.get('referenced_systems'),
                'is_universal': asset.get('is_universal'),
                '_relevance_score': asset.get('_relevance_score', 0)
            })

        # Count by kind
        figures = sum(1 for a in all_candidates if a.get('asset_kind') == 'figure')
        tables = sum(1 for a in all_candidates if a.get('asset_kind') == 'table')

        return {
            'type': 'DOC_ASSETS',
            'count': len(formatted_assets),
            'data': formatted_assets,
            'metrics': {
                'total_matched': len(all_candidates),
                'shortlist_size': min(len(all_candidates), SHORTLIST_K),
                'selected_count': len(formatted_assets),
                'figures_matched': figures,
                'tables_matched': tables,
                'query_duration_ms': query_duration_ms,
                'llm_duration_ms': llm_duration_ms,
                'total_duration_ms': query_duration_ms + llm_duration_ms,
                'terms_used': terms
            }
        }

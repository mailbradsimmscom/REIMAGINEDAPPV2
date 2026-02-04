#!/usr/bin/env python3
"""
Test script: doc_assets retrieval with v5 filtering + LLM selection

Usage:
    cd python-sidecar
    python scripts/test_doc_assets_retrieval.py

Tests the doc_assets retrieval logic that will be integrated into chat workflow.
Uses same inputs/outputs as production.
"""

import asyncio
import os
import re
import sys
import json
from datetime import datetime
from typing import List, Dict, Any, Optional

# Add parent to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env'))

from supabase import create_client, Client
from openai import AsyncOpenAI

# ============================================================================
# CONSTANTS (match production)
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
# TERM NORMALIZATION (same as production DIP)
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

class DocAssetsRetriever:
    """
    Retrieves doc_assets (figures/tables) using v5 filtering + LLM selection.
    Production-ready implementation for chat integration.
    """

    def __init__(self):
        self.supabase: Client = create_client(
            os.environ['SUPABASE_URL'],
            os.environ['PY_SUPABASE_SERVICE_KEY']
        )
        self.openai = AsyncOpenAI(api_key=os.environ['OPENAI_API_KEY'])
        self.supabase_url = os.environ['SUPABASE_URL']

    def _build_public_url(self, storage_path: str) -> str:
        """Build public URL for asset image."""
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
            Production-ready result dict with selected assets and metrics
        """
        start_time = datetime.now()

        # Extract scope
        focus_models = retrieval_scope.get('focus_models', [])
        boat_models = retrieval_scope.get('boat_models', [])
        primary_doc_ids = retrieval_scope.get('candidate_primary_doc_ids', [])
        referencing_doc_ids = retrieval_scope.get('candidate_referencing_doc_ids', [])

        # Normalize search terms
        terms = normalize_terms(search_keywords or [], query)

        print(f"\n{'='*60}")
        print(f"DOC ASSETS RETRIEVAL")
        print(f"{'='*60}")
        print(f"Query: {query}")
        print(f"Terms: {terms}")
        print(f"Focus models: {focus_models}")
        print(f"Primary docs: {len(primary_doc_ids)}")
        print(f"Referencing docs: {len(referencing_doc_ids)}")

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
        print(f"\nStage 1 (v5 query): {len(candidates)} candidates in {query_duration_ms}ms")

        if not candidates:
            return self._build_result([], [], query_duration_ms, 0, terms)

        # Stage 2: Deterministic shortlist (top K by text relevance score)
        shortlist = self._rank_and_shortlist(candidates, terms, intent, k=SHORTLIST_K)
        print(f"Stage 2 (shortlist): {len(shortlist)} assets")

        # Stage 3: LLM selection (pick N from shortlist)
        llm_start = datetime.now()
        selected = await self._llm_select(query, shortlist, n=SELECT_N)
        llm_duration_ms = int((datetime.now() - llm_start).total_seconds() * 1000)
        print(f"Stage 3 (LLM select): {len(selected)} assets in {llm_duration_ms}ms")

        total_duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)

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
            print(f"ERROR querying doc_assets: {e}")
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
            print(f"LLM selection failed: {e}, falling back to top {n}")
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
        Build production-ready result dict.
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


# ============================================================================
# TEST HARNESS
# ============================================================================

async def main():
    """Run test with production-like inputs."""

    # Production inputs (from actual chat session)
    query = "how do I depressurize my watermaker?"

    retrieval_scope = {
        "focus_models": ["ZEN15048VDC"],
        "boat_models": ["ZEN15048VDC"],
        "candidate_primary_doc_ids": ["759ac8ff51c98c10358e2c0604c1ca73cf975023949d6e122f9af6e8cb32f061"],
        "candidate_referencing_doc_ids": []
    }

    # Optional: classification keywords (would come from classification step)
    search_keywords = ["depressurize", "pressure", "valve", "watermaker"]

    # Optional: intent (would come from classification step)
    intent = "procedure"

    # Create retriever and run
    retriever = DocAssetsRetriever()

    result = await retriever.query_doc_assets(
        query=query,
        retrieval_scope=retrieval_scope,
        search_keywords=search_keywords,
        intent=intent
    )

    # Pretty print results
    print(f"\n{'='*60}")
    print("RESULTS")
    print(f"{'='*60}")
    print(f"\nMetrics:")
    for k, v in result['metrics'].items():
        print(f"  {k}: {v}")

    print(f"\nSelected Assets ({result['count']}):")
    for i, asset in enumerate(result['data']):
        print(f"\n  [{i+1}] {asset['asset_kind'].upper()}", end="")
        if asset.get('figure_reference'):
            print(f" {asset['figure_reference']}", end="")
        print()
        if asset.get('title'):
            print(f"      Title: {asset['title']}")
        print(f"      Page: {asset['page_number']}")
        print(f"      Score: {asset.get('_relevance_score', 'N/A')}")
        print(f"      URL: {asset['public_url']}")
        if asset.get('search_blob'):
            blob_preview = asset['search_blob'][:150] + '...' if len(asset['search_blob']) > 150 else asset['search_blob']
            print(f"      Search blob: {blob_preview}")

    # Output raw JSON for production integration testing
    print(f"\n{'='*60}")
    print("RAW OUTPUT (production format)")
    print(f"{'='*60}")
    print(json.dumps(result, indent=2, default=str))


if __name__ == '__main__':
    asyncio.run(main())

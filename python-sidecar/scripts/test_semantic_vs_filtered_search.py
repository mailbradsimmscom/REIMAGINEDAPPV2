#!/usr/bin/env python3
"""
Test Script: Semantic Search vs Hard-Filtered Search

Tests whether removing the asset_uid hard filter allows semantic search
to find relevant cross-system content.

Hypothesis: Hard filtering by asset_uid blocks relevant content from
related systems. Semantic search alone might find cross-system content.

Example: "Engine won't start" might have relevant info in:
- Engine manual (obvious)
- Saildrive manual (clutch must be in neutral)
- Controller manual (error codes)
- Isolator switch (power disconnected)

Usage:
    python scripts/test_semantic_vs_filtered_search.py --query "engine won't start"
    python scripts/test_semantic_vs_filtered_search.py --query "engine overheating"
"""

import os
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime

# Load environment
env_file = Path('/Users/brad/code/REIMAGINEDAPPV2/.env')
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, _, value = line.partition('=')
            os.environ[key.strip()] = value.strip().strip('"').strip("'")

from pinecone import Pinecone
from openai import OpenAI

# Configuration
PINECONE_API_KEY = os.getenv('PINECONE_API_KEY')
PINECONE_INDEX = os.getenv('PINECONE_INDEX', 'reimaginedsv')
PINECONE_NAMESPACE = 'REIMAGINEDDOCS'
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
EMBEDDING_MODEL = 'text-embedding-3-large'

# Known systems for testing (from REIMAGINED)
KNOWN_SYSTEMS = {
    "engine": {
        "keywords": ["engine", "yanmar", "4jh", "motor", "diesel"],
        "asset_uid_pattern": "engine"
    },
    "saildrive": {
        "keywords": ["saildrive", "sail drive", "sd60", "sd25", "transmission"],
        "asset_uid_pattern": "sail"
    },
    "controller": {
        "keywords": ["vc20", "controller", "control panel", "throttle"],
        "asset_uid_pattern": "control"
    },
    "battery": {
        "keywords": ["battery", "batteries", "voltage", "amp"],
        "asset_uid_pattern": "battery"
    },
    "electrical": {
        "keywords": ["isolator", "switch", "breaker", "fuse"],
        "asset_uid_pattern": "isolat"
    }
}


def get_embedding(text: str) -> list:
    """Generate embedding for query text."""
    client = OpenAI(api_key=OPENAI_API_KEY)
    response = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text
    )
    return response.data[0].embedding


def search_pinecone(embedding: list, filter_dict: dict = None, top_k: int = 20) -> list:
    """Search Pinecone with optional filter."""
    pc = Pinecone(api_key=PINECONE_API_KEY)
    index = pc.Index(PINECONE_INDEX)

    query_params = {
        "vector": embedding,
        "top_k": top_k,
        "include_metadata": True,
        "namespace": PINECONE_NAMESPACE
    }

    if filter_dict:
        query_params["filter"] = filter_dict

    results = index.query(**query_params)
    return results.matches


def identify_primary_system(query: str) -> dict:
    """Simple keyword matching to identify primary system in query."""
    query_lower = query.lower()

    for system_name, system_info in KNOWN_SYSTEMS.items():
        for keyword in system_info["keywords"]:
            if keyword in query_lower:
                return {
                    "name": system_name,
                    "pattern": system_info["asset_uid_pattern"]
                }

    return None


def categorize_result(result) -> str:
    """Categorize a result by system based on metadata."""
    metadata = result.metadata
    asset_uid = metadata.get("linked_asset_uid", "").lower()
    manufacturer = metadata.get("manufacturer", "").lower()
    model = metadata.get("model", "").lower()

    combined = f"{asset_uid} {manufacturer} {model}"

    for system_name, system_info in KNOWN_SYSTEMS.items():
        if system_info["asset_uid_pattern"] in combined:
            return system_name
        for keyword in system_info["keywords"]:
            if keyword in combined:
                return system_name

    return "other"


def print_result(result, rank: int, show_text: bool = True):
    """Print a single result with formatting."""
    metadata = result.metadata
    score = result.score

    print(f"\n  [{rank}] Score: {score:.4f}")
    print(f"      System: {metadata.get('linked_asset_uid', 'unknown')[:50]}")
    print(f"      Manufacturer: {metadata.get('manufacturer', 'unknown')}")
    print(f"      Model: {metadata.get('model', 'unknown')}")

    if show_text:
        text = metadata.get('text', metadata.get('content', ''))[:300]
        print(f"      Text: {text}...")


def run_comparison(query: str, primary_asset_uid: str = None):
    """Run comparison of filtered vs unfiltered search."""

    print(f"\n{'='*80}")
    print(f"QUERY: \"{query}\"")
    print(f"{'='*80}")

    # Generate embedding
    print("\n[1] Generating embedding...")
    embedding = get_embedding(query)
    print(f"    Embedding generated ({len(embedding)} dimensions)")

    # Identify primary system
    primary = identify_primary_system(query)
    if primary:
        print(f"    Primary system detected: {primary['name']}")

    # =========================================
    # TEST 1: No filter (pure semantic search)
    # =========================================
    print(f"\n{'='*80}")
    print("TEST 1: PURE SEMANTIC SEARCH (No filter)")
    print(f"{'='*80}")

    results_unfiltered = search_pinecone(embedding, filter_dict=None, top_k=15)

    # Categorize results by system
    systems_found = {}
    for i, result in enumerate(results_unfiltered, 1):
        category = categorize_result(result)
        if category not in systems_found:
            systems_found[category] = []
        systems_found[category].append((i, result))

    print(f"\nSystems found in results:")
    for system, items in sorted(systems_found.items(), key=lambda x: -len(x[1])):
        print(f"  - {system}: {len(items)} chunks")

    print(f"\nTop 10 results:")
    for i, result in enumerate(results_unfiltered[:10], 1):
        print_result(result, i, show_text=True)

    # =========================================
    # TEST 2: Hard filter (current approach)
    # =========================================
    if primary:
        print(f"\n{'='*80}")
        print(f"TEST 2: HARD FILTER (linked_asset_uid contains '{primary['pattern']}')")
        print(f"{'='*80}")

        # Try to find actual linked_asset_uid from unfiltered results
        primary_uids = set()
        for result in results_unfiltered:
            uid = result.metadata.get("linked_asset_uid", "").lower()
            if primary["pattern"] in uid:
                primary_uids.add(result.metadata.get("linked_asset_uid"))

        if primary_uids:
            # Use the first matching linked_asset_uid
            filter_uid = list(primary_uids)[0]
            print(f"Filtering by linked_asset_uid: {filter_uid}")

            results_filtered = search_pinecone(
                embedding,
                filter_dict={"linked_asset_uid": filter_uid},
                top_k=15
            )

            print(f"\nResults found: {len(results_filtered)}")
            print(f"\nTop 10 results:")
            for i, result in enumerate(results_filtered[:10], 1):
                print_result(result, i, show_text=True)
        else:
            print(f"Could not find asset_uid matching '{primary['pattern']}'")
            results_filtered = []

    # =========================================
    # ANALYSIS: What did we miss with hard filter?
    # =========================================
    print(f"\n{'='*80}")
    print("ANALYSIS: Cross-System Content")
    print(f"{'='*80}")

    if primary:
        print(f"\nContent from OTHER systems that ranked high in semantic search:")
        print("(This content would be MISSED with hard asset_uid filter)")

        cross_system_count = 0
        for i, result in enumerate(results_unfiltered[:15], 1):
            category = categorize_result(result)
            if category != primary["name"] and category != "other":
                cross_system_count += 1
                print(f"\n  [{i}] From: {category.upper()} (Score: {result.score:.4f})")
                text = result.metadata.get('text', result.metadata.get('content', ''))[:200]
                print(f"      Text: {text}...")

        if cross_system_count == 0:
            print("\n  No significant cross-system content found in top 15 results.")
            print("  This suggests semantic search didn't find related system content,")
            print("  OR the content isn't semantically similar to the query.")

    # =========================================
    # SUMMARY
    # =========================================
    print(f"\n{'='*80}")
    print("SUMMARY")
    print(f"{'='*80}")

    print(f"\nUnfiltered search found content from {len(systems_found)} different system categories:")
    for system, items in sorted(systems_found.items(), key=lambda x: -len(x[1])):
        scores = [r.score for _, r in items]
        avg_score = sum(scores) / len(scores)
        print(f"  - {system}: {len(items)} chunks (avg score: {avg_score:.4f})")

    if primary and len(systems_found) > 1:
        print(f"\n** Cross-system content WAS found by semantic search **")
        print(f"   Hard filtering by asset_uid would have missed this content.")
    elif primary:
        print(f"\n** Semantic search only found content from primary system **")
        print(f"   No cross-system content to miss with hard filter.")

    return {
        "query": query,
        "unfiltered_count": len(results_unfiltered),
        "systems_found": {k: len(v) for k, v in systems_found.items()},
        "cross_system_content": len(systems_found) > 1
    }


def main():
    parser = argparse.ArgumentParser(description='Test semantic vs filtered search')
    parser.add_argument('--query', type=str, required=True, help='Search query')
    parser.add_argument('--queries-file', type=str, help='JSON file with multiple queries')
    args = parser.parse_args()

    if not PINECONE_API_KEY:
        print("ERROR: PINECONE_API_KEY not set")
        sys.exit(1)

    if not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY not set")
        sys.exit(1)

    print(f"\n{'#'*80}")
    print("SEMANTIC VS FILTERED SEARCH TEST")
    print(f"{'#'*80}")
    print(f"Index: {PINECONE_INDEX}")
    print(f"Namespace: {PINECONE_NAMESPACE}")
    print(f"Embedding model: {EMBEDDING_MODEL}")

    if args.query:
        run_comparison(args.query)

    # Run some common troubleshooting queries
    print(f"\n\n{'#'*80}")
    print("ADDITIONAL TEST QUERIES")
    print(f"{'#'*80}")

    test_queries = [
        "engine won't start no sound",
        "engine overheating",
        "check saildrive oil level",
        "battery not charging from solar",
    ]

    print("\nWould you like to run these additional queries? (These are common troubleshooting scenarios)")
    for i, q in enumerate(test_queries, 1):
        print(f"  {i}. {q}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Chunk-Vector Verification Script

Verifies data integrity between Supabase chunks and Pinecone vectors.
NO CORRECTIVE ACTION - Pure audit and reporting only.

Usage:
    python scripts/bulk/verify-chunks-vectors.py

Output:
    - Total chunk/vector counts comparison
    - Doc-by-doc breakdown if totals differ
    - Duplicate chunk detection
    - Data integrity report
"""

import os
import sys
from collections import defaultdict
from typing import Dict, List, Any, Tuple
from dotenv import load_dotenv
import requests
from pinecone import Pinecone

# Load environment variables
load_dotenv()

# Configuration
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
PINECONE_API_KEY = os.getenv('PINECONE_API_KEY')
PINECONE_INDEX = os.getenv('PINECONE_INDEX', 'reimaginedsv')
PINECONE_NAMESPACE = os.getenv('PINECONE_NAMESPACE', 'REIMAGINEDDOCS')

# Validate environment
if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    print("❌ Missing Supabase credentials (SUPABASE_URL, SUPABASE_SERVICE_KEY)")
    sys.exit(1)

if not PINECONE_API_KEY:
    print("❌ Missing PINECONE_API_KEY")
    sys.exit(1)

# ============================================================================
# SUPABASE FUNCTIONS
# ============================================================================

def fetch_all_chunks_from_supabase() -> List[Dict[str, Any]]:
    """
    Fetch ALL chunks from Supabase with proper pagination.
    Returns list of chunks with: chunk_id, doc_id, chunk_index, content_type, etc.
    """
    url = SUPABASE_URL.rstrip("/")
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json"
    }

    all_chunks = []
    offset = 0
    page_size = 1000  # Supabase default limit

    print("📥 Fetching chunks from Supabase...")

    while True:
        params = {
            "content_type": "eq.text",
            "select": "chunk_id,doc_id,chunk_index,content_type,created_at",
            "order": "doc_id,chunk_index",
            "limit": page_size,
            "offset": offset
        }

        try:
            response = requests.get(
                f"{url}/rest/v1/document_chunks",
                headers=headers,
                params=params,
                timeout=30
            )

            if response.status_code != 200:
                raise Exception(f"Supabase API error: {response.status_code} - {response.text}")

            chunks_page = response.json()

            if not chunks_page:
                break  # No more data

            all_chunks.extend(chunks_page)
            offset += page_size

            print(f"   Fetched {len(all_chunks)} chunks so far...", end='\r')

            # If we got fewer than page_size, we're done
            if len(chunks_page) < page_size:
                break

        except requests.exceptions.Timeout:
            raise Exception("Supabase request timed out after 30 seconds")
        except requests.exceptions.RequestException as e:
            raise Exception(f"Supabase request failed: {str(e)}")

    print(f"   ✓ Fetched {len(all_chunks)} total chunks from Supabase")
    return all_chunks


def analyze_supabase_chunks(chunks: List[Dict[str, Any]]) -> Tuple[Dict[str, int], Dict[str, List[int]]]:
    """
    Analyze chunks and detect duplicates.

    Returns:
        - chunks_per_doc: {doc_id: count}
        - duplicates_per_doc: {doc_id: [duplicate_chunk_indices]}
    """
    chunks_per_doc = defaultdict(int)
    chunk_indices_per_doc = defaultdict(list)
    duplicates_per_doc = {}

    for chunk in chunks:
        doc_id = chunk['doc_id']
        chunk_index = chunk['chunk_index']

        chunks_per_doc[doc_id] += 1
        chunk_indices_per_doc[doc_id].append(chunk_index)

    # Find duplicates
    for doc_id, indices in chunk_indices_per_doc.items():
        # Count occurrences of each index
        index_counts = defaultdict(int)
        for idx in indices:
            index_counts[idx] += 1

        # Find indices that appear more than once
        duplicate_indices = [idx for idx, count in index_counts.items() if count > 1]

        if duplicate_indices:
            duplicates_per_doc[doc_id] = sorted(duplicate_indices)

    return dict(chunks_per_doc), duplicates_per_doc


# ============================================================================
# PINECONE FUNCTIONS
# ============================================================================

def fetch_vector_counts_from_pinecone(doc_ids: List[str]) -> Dict[str, int]:
    """
    Get vector counts per doc_id from Pinecone.
    Uses metadata filtering to count vectors for each doc_id.

    Returns:
        - vectors_per_doc: {doc_id: count}
    """
    try:
        # Initialize Pinecone
        pc = Pinecone(api_key=PINECONE_API_KEY)
        index = pc.Index(PINECONE_INDEX)

        print(f"\n🔍 Querying Pinecone vectors (namespace: {PINECONE_NAMESPACE})...")

        vectors_per_doc = {}

        for i, doc_id in enumerate(doc_ids, 1):
            # Query vectors for this doc_id using metadata filter
            # We'll use a dummy vector and filter by doc_id metadata
            # Note: Pinecone query requires a vector, so we use a zero vector just to get metadata

            try:
                # Query with filter - get up to 10k results (Pinecone limit)
                results = index.query(
                    vector=[0.0] * 3072,  # text-embedding-3-large dimension
                    filter={"doc_id": {"$eq": doc_id}},
                    top_k=10000,  # Max Pinecone allows
                    namespace=PINECONE_NAMESPACE,
                    include_metadata=False,  # We only need count
                    include_values=False
                )

                vector_count = len(results.matches)
                vectors_per_doc[doc_id] = vector_count

                print(f"   [{i}/{len(doc_ids)}] {doc_id[:16]}... : {vector_count} vectors", end='\r')

            except Exception as e:
                print(f"\n   ⚠️  Error querying doc {doc_id[:16]}: {str(e)}")
                vectors_per_doc[doc_id] = -1  # Mark as error

        print(f"\n   ✓ Queried vectors for {len(doc_ids)} documents")

        return vectors_per_doc

    except Exception as e:
        print(f"❌ Failed to query Pinecone: {str(e)}")
        raise


def get_pinecone_total_stats() -> Dict[str, Any]:
    """Get total Pinecone index statistics"""
    try:
        pc = Pinecone(api_key=PINECONE_API_KEY)
        index = pc.Index(PINECONE_INDEX)

        stats = index.describe_index_stats()

        return {
            'total_vectors': stats.total_vector_count,
            'namespace_vectors': stats.namespaces.get(PINECONE_NAMESPACE, {}).vector_count if stats.namespaces else 0,
            'dimension': stats.dimension,
            'index_fullness': stats.index_fullness
        }
    except Exception as e:
        print(f"❌ Failed to get Pinecone stats: {str(e)}")
        raise


# ============================================================================
# COMPARISON AND REPORTING
# ============================================================================

def print_summary(
    supabase_total: int,
    pinecone_total: int,
    chunks_per_doc: Dict[str, int],
    vectors_per_doc: Dict[str, int],
    duplicates_per_doc: Dict[str, List[int]]
):
    """Print comprehensive verification report"""

    print("\n" + "="*80)
    print("📊 CHUNK-VECTOR VERIFICATION REPORT")
    print("="*80)

    # Level 1: Total counts
    print("\n🔢 TOTAL COUNTS")
    print(f"Supabase chunks:    {supabase_total:,}")
    print(f"Pinecone vectors:   {pinecone_total:,}")
    difference = supabase_total - pinecone_total

    if difference == 0:
        print("✅ Totals match perfectly!")
    else:
        print(f"⚠️  Difference: {difference:+,} ({'Supabase has more' if difference > 0 else 'Pinecone has more'})")

    # Duplicate detection
    if duplicates_per_doc:
        total_duplicate_indices = sum(len(dups) for dups in duplicates_per_doc.values())
        print(f"\n⚠️  DUPLICATE CHUNKS DETECTED")
        print(f"Documents with duplicates: {len(duplicates_per_doc)}")
        print(f"Total duplicate indices: {total_duplicate_indices}")
        print("\nDocuments with duplicate chunk_index values:")
        for doc_id, dup_indices in sorted(duplicates_per_doc.items(), key=lambda x: len(x[1]), reverse=True):
            print(f"  - {doc_id[:16]}... : {len(dup_indices)} duplicate indices (e.g., {dup_indices[:5]})")
    else:
        print("\n✅ No duplicate chunk_index values found")

    # Level 2: Doc-by-doc comparison (only if totals differ or duplicates exist)
    if difference != 0 or duplicates_per_doc:
        print("\n" + "="*80)
        print("📋 DOC-BY-DOC BREAKDOWN (Mismatches Only)")
        print("="*80)

        # Find mismatches
        all_doc_ids = set(chunks_per_doc.keys()) | set(vectors_per_doc.keys())
        mismatches = []

        for doc_id in all_doc_ids:
            chunk_count = chunks_per_doc.get(doc_id, 0)
            vector_count = vectors_per_doc.get(doc_id, 0)

            if chunk_count != vector_count or doc_id in duplicates_per_doc:
                diff = chunk_count - vector_count
                has_duplicates = doc_id in duplicates_per_doc
                dup_count = len(duplicates_per_doc.get(doc_id, []))

                mismatches.append({
                    'doc_id': doc_id,
                    'chunks': chunk_count,
                    'vectors': vector_count,
                    'diff': diff,
                    'has_duplicates': has_duplicates,
                    'dup_count': dup_count
                })

        if mismatches:
            print(f"\nFound {len(mismatches)} documents with issues:\n")
            print(f"{'Doc ID':<20} {'Chunks':<10} {'Vectors':<10} {'Diff':<10} {'Status'}")
            print("-" * 80)

            for m in sorted(mismatches, key=lambda x: abs(x['diff']), reverse=True):
                doc_id_short = m['doc_id'][:16] + "..."
                status = []
                if m['has_duplicates']:
                    status.append(f"⚠️  {m['dup_count']} dups")
                if m['diff'] != 0:
                    status.append(f"{'↑' if m['diff'] > 0 else '↓'} {abs(m['diff'])}")

                status_str = ", ".join(status)

                print(f"{doc_id_short:<20} {m['chunks']:<10} {m['vectors']:<10} {m['diff']:+<10} {status_str}")
        else:
            print("\n✅ All documents have matching chunk/vector counts!")

    # Summary
    print("\n" + "="*80)
    print("📌 SUMMARY")
    print("="*80)

    if difference == 0 and not duplicates_per_doc:
        print("✅ Data integrity: EXCELLENT")
        print("   - All counts match")
        print("   - No duplicates detected")
    elif difference == 0 and duplicates_per_doc:
        print("⚠️  Data integrity: NEEDS ATTENTION")
        print("   - Counts match overall")
        print(f"   - {len(duplicates_per_doc)} documents have duplicate chunks")
        print("\n💡 Recommended action:")
        print("   1. Review duplicate chunks (may be from failed uploads)")
        print("   2. Clean duplicates based on created_at timestamp")
        print("   3. Add database constraint: unique(doc_id, chunk_index)")
    else:
        print("⚠️  Data integrity: ISSUES DETECTED")
        print(f"   - {abs(difference)} chunk/vector mismatch")
        if duplicates_per_doc:
            print(f"   - {len(duplicates_per_doc)} documents have duplicate chunks")
        print("\n💡 Recommended action:")
        print("   1. Fix duplicate chunks first")
        print("   2. Re-vectorize documents with missing vectors")
        print("   3. Add database constraint: unique(doc_id, chunk_index)")

    print()


# ============================================================================
# MAIN SCRIPT
# ============================================================================

def main():
    """Main verification workflow"""

    print("🔍 Chunk-Vector Verification Script")
    print(f"   Supabase: {SUPABASE_URL}")
    print(f"   Pinecone: {PINECONE_INDEX} (namespace: {PINECONE_NAMESPACE})")
    print()

    try:
        # Step 1: Get Pinecone total stats
        print("1️⃣  Getting Pinecone index statistics...")
        pinecone_stats = get_pinecone_total_stats()
        pinecone_total = pinecone_stats['namespace_vectors']
        print(f"   ✓ Pinecone total vectors (namespace): {pinecone_total:,}")

        # Step 2: Fetch all chunks from Supabase
        print("\n2️⃣  Fetching all chunks from Supabase...")
        all_chunks = fetch_all_chunks_from_supabase()
        supabase_total = len(all_chunks)

        # Step 3: Analyze chunks (count per doc, detect duplicates)
        print("\n3️⃣  Analyzing chunks...")
        chunks_per_doc, duplicates_per_doc = analyze_supabase_chunks(all_chunks)
        print(f"   ✓ Analyzed {len(chunks_per_doc)} unique documents")

        if duplicates_per_doc:
            print(f"   ⚠️  Found {len(duplicates_per_doc)} documents with duplicate chunk_index values")

        # Step 4: Query Pinecone for vector counts per doc
        doc_ids = list(chunks_per_doc.keys())
        print(f"\n4️⃣  Querying Pinecone for vector counts...")
        vectors_per_doc = fetch_vector_counts_from_pinecone(doc_ids)

        # Step 5: Generate report
        print("\n5️⃣  Generating report...")
        print_summary(
            supabase_total,
            pinecone_total,
            chunks_per_doc,
            vectors_per_doc,
            duplicates_per_doc
        )

    except KeyboardInterrupt:
        print("\n\n⚠️  Script interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    main()

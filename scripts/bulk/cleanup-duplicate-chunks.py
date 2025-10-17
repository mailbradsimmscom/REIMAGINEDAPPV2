#!/usr/bin/env python3
"""
Cleanup Duplicate Chunks and Vectors

Removes duplicate chunk_index entries from Supabase and their corresponding vectors from Pinecone.
Uses chunk_id as the link between Supabase chunks and Pinecone vectors.

Usage:
    python scripts/bulk/cleanup-duplicate-chunks.py --doc-id <doc_id>
    python scripts/bulk/cleanup-duplicate-chunks.py --asset-uid <asset_uid>
    python scripts/bulk/cleanup-duplicate-chunks.py --doc-id <doc_id> --dry-run
    python scripts/bulk/cleanup-duplicate-chunks.py --doc-id <doc_id> --execute

Options:
    --doc-id        Document ID (SHA256 hash)
    --asset-uid     Asset UID (will lookup doc_id)
    --dry-run       Preview what would be deleted (default)
    --execute       Actually perform the deletion
    --keep-newest   Keep newest duplicates instead of oldest (default: keep oldest)
"""

import os
import sys
import argparse
from collections import defaultdict
from typing import Dict, List, Any, Tuple
from datetime import datetime
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

def lookup_doc_id_by_asset_uid(asset_uid: str) -> str:
    """Lookup doc_id from asset_uid in documents table"""
    url = SUPABASE_URL.rstrip("/")
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json"
    }

    params = {
        "asset_id": f"eq.{asset_uid}",
        "select": "doc_id,filename"
    }

    try:
        response = requests.get(
            f"{url}/rest/v1/documents",
            headers=headers,
            params=params,
            timeout=30
        )

        if response.status_code != 200:
            raise Exception(f"Supabase API error: {response.status_code} - {response.text}")

        docs = response.json()
        if not docs:
            raise Exception(f"No document found with asset_uid: {asset_uid}")

        doc = docs[0]
        print(f"📄 Found document: {doc.get('filename', 'unknown')}")
        return doc['doc_id']

    except Exception as e:
        raise Exception(f"Failed to lookup doc_id: {str(e)}")


def fetch_chunks_for_document(doc_id: str) -> List[Dict[str, Any]]:
    """Fetch all chunks for a document from Supabase"""
    url = SUPABASE_URL.rstrip("/")
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json"
    }

    all_chunks = []
    offset = 0
    page_size = 1000

    while True:
        params = {
            "doc_id": f"eq.{doc_id}",
            "content_type": "eq.text",
            "select": "chunk_id,doc_id,chunk_index,created_at,text",
            "order": "chunk_index,created_at",
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
                break

            all_chunks.extend(chunks_page)
            offset += page_size

            if len(chunks_page) < page_size:
                break

        except Exception as e:
            raise Exception(f"Failed to fetch chunks: {str(e)}")

    return all_chunks


def delete_chunks_from_supabase(chunk_ids: List[str]) -> int:
    """Delete chunks by chunk_id from Supabase"""
    if not chunk_ids:
        return 0

    url = SUPABASE_URL.rstrip("/")
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    # Supabase doesn't support IN with DELETE directly, so we need to use OR
    # Build filter: chunk_id=eq.xxx,chunk_id=eq.yyy
    chunk_filter = ",".join([f"chunk_id.eq.{cid}" for cid in chunk_ids])

    try:
        response = requests.delete(
            f"{url}/rest/v1/document_chunks?or=({chunk_filter})",
            headers=headers,
            timeout=60
        )

        if response.status_code not in [200, 204]:
            raise Exception(f"Supabase delete failed: {response.status_code} - {response.text}")

        # Return count of deleted rows
        if response.status_code == 200:
            deleted = response.json()
            return len(deleted) if isinstance(deleted, list) else 1
        else:
            return len(chunk_ids)

    except Exception as e:
        raise Exception(f"Failed to delete chunks: {str(e)}")


# ============================================================================
# PINECONE FUNCTIONS
# ============================================================================

def fetch_vectors_for_document(doc_id: str) -> List[str]:
    """Fetch all vector IDs for a document from Pinecone"""
    try:
        pc = Pinecone(api_key=PINECONE_API_KEY)
        index = pc.Index(PINECONE_INDEX)

        # Query vectors with doc_id filter
        # Use dummy vector (we only care about metadata/IDs)
        results = index.query(
            vector=[0.0] * 3072,  # text-embedding-3-large dimension
            filter={"doc_id": {"$eq": doc_id}},
            top_k=10000,  # Max Pinecone allows per query
            namespace=PINECONE_NAMESPACE,
            include_metadata=False,
            include_values=False
        )

        vector_ids = [match.id for match in results.matches]
        return vector_ids

    except Exception as e:
        raise Exception(f"Failed to fetch vectors from Pinecone: {str(e)}")


def delete_vectors_from_pinecone(vector_ids: List[str]) -> int:
    """Delete vectors by ID from Pinecone"""
    if not vector_ids:
        return 0

    try:
        pc = Pinecone(api_key=PINECONE_API_KEY)
        index = pc.Index(PINECONE_INDEX)

        # Pinecone delete supports batch operations
        index.delete(
            ids=vector_ids,
            namespace=PINECONE_NAMESPACE
        )

        return len(vector_ids)

    except Exception as e:
        raise Exception(f"Failed to delete vectors from Pinecone: {str(e)}")


# ============================================================================
# DUPLICATE DETECTION AND CLEANUP LOGIC
# ============================================================================

def analyze_duplicates(chunks: List[Dict[str, Any]], vector_ids: List[str]) -> Dict[str, Any]:
    """
    Analyze chunks to find duplicates and determine what to delete.

    Returns:
        {
            'total_chunks': int,
            'unique_indices': int,
            'duplicate_groups': {chunk_index: [chunk_objects]},
            'chunks_with_vectors': int,
            'chunks_without_vectors': int
        }
    """
    # Create set of vector IDs for fast lookup
    vector_id_set = set(vector_ids)

    # Group chunks by chunk_index
    chunks_by_index = defaultdict(list)
    chunks_with_vectors = 0
    chunks_without_vectors = 0

    for chunk in chunks:
        chunk_index = chunk['chunk_index']
        chunk_id = chunk['chunk_id']
        has_vector = chunk_id in vector_id_set

        chunk['has_vector'] = has_vector
        chunks_by_index[chunk_index].append(chunk)

        if has_vector:
            chunks_with_vectors += 1
        else:
            chunks_without_vectors += 1

    # Find duplicate groups (chunk_index with multiple chunks)
    duplicate_groups = {
        idx: chunks_list
        for idx, chunks_list in chunks_by_index.items()
        if len(chunks_list) > 1
    }

    return {
        'total_chunks': len(chunks),
        'unique_indices': len(chunks_by_index),
        'duplicate_groups': duplicate_groups,
        'chunks_with_vectors': chunks_with_vectors,
        'chunks_without_vectors': chunks_without_vectors,
        'chunks_by_index': chunks_by_index
    }


def decide_what_to_delete(analysis: Dict[str, Any], keep_newest: bool = False) -> Tuple[List[str], List[str]]:
    """
    Decide which chunks and vectors to delete.

    Strategy:
    - For duplicates with vectors: keep one (by created_at), delete rest
    - For duplicates without vectors: keep one (by created_at), delete rest
    - For mixed (some with/without vectors): keep the one with vector, delete others

    Returns:
        (chunk_ids_to_delete, vector_ids_to_delete)
    """
    duplicate_groups = analysis['duplicate_groups']
    chunks_to_delete = []
    vectors_to_delete = []

    for chunk_index, chunks_list in duplicate_groups.items():
        # Sort by created_at (oldest first by default)
        sorted_chunks = sorted(chunks_list, key=lambda c: c['created_at'], reverse=keep_newest)

        # Separate into chunks with/without vectors
        with_vectors = [c for c in sorted_chunks if c['has_vector']]
        without_vectors = [c for c in sorted_chunks if not c['has_vector']]

        if with_vectors and without_vectors:
            # Mixed case: Keep first chunk with vector, delete all others
            keep_chunk = with_vectors[0]
            delete_chunks = [c for c in sorted_chunks if c['chunk_id'] != keep_chunk['chunk_id']]
        elif with_vectors:
            # All have vectors: Keep first, delete rest
            keep_chunk = with_vectors[0]
            delete_chunks = with_vectors[1:]
        else:
            # None have vectors: Keep first, delete rest
            keep_chunk = without_vectors[0]
            delete_chunks = without_vectors[1:]

        # Add to deletion lists
        for chunk in delete_chunks:
            chunks_to_delete.append(chunk['chunk_id'])
            if chunk['has_vector']:
                vectors_to_delete.append(chunk['chunk_id'])

    return chunks_to_delete, vectors_to_delete


def print_analysis_report(analysis: Dict[str, Any], doc_id: str):
    """Print detailed analysis report"""
    print("\n" + "="*80)
    print(f"📊 DUPLICATE ANALYSIS REPORT")
    print("="*80)
    print(f"\nDocument ID: {doc_id[:16]}...")
    print(f"\n📦 Chunk Statistics:")
    print(f"  Total chunks in Supabase:     {analysis['total_chunks']}")
    print(f"  Unique chunk_index values:    {analysis['unique_indices']}")
    print(f"  Chunks with vectors:          {analysis['chunks_with_vectors']}")
    print(f"  Chunks without vectors:       {analysis['chunks_without_vectors']}")

    duplicate_groups = analysis['duplicate_groups']
    if duplicate_groups:
        total_duplicates = sum(len(chunks) - 1 for chunks in duplicate_groups.values())
        print(f"\n⚠️  DUPLICATES DETECTED")
        print(f"  Duplicate chunk_index values: {len(duplicate_groups)}")
        print(f"  Total duplicate chunks:       {total_duplicates}")

        print(f"\n📋 Duplicate Groups (showing first 10):")
        for i, (idx, chunks_list) in enumerate(sorted(duplicate_groups.items())[:10]):
            with_vec = sum(1 for c in chunks_list if c['has_vector'])
            without_vec = len(chunks_list) - with_vec
            print(f"  chunk_index {idx}: {len(chunks_list)} copies ({with_vec} with vectors, {without_vec} without)")
    else:
        print(f"\n✅ No duplicates detected")


def print_deletion_report(chunks_to_delete: List[str], vectors_to_delete: List[str]):
    """Print what will be deleted"""
    print("\n" + "="*80)
    print("🗑️  DELETION PLAN")
    print("="*80)
    print(f"\nChunks to delete from Supabase:  {len(chunks_to_delete)}")
    print(f"Vectors to delete from Pinecone: {len(vectors_to_delete)}")

    if chunks_to_delete:
        print(f"\nFirst 5 chunk_ids to delete:")
        for cid in chunks_to_delete[:5]:
            print(f"  - {cid}")
        if len(chunks_to_delete) > 5:
            print(f"  ... and {len(chunks_to_delete) - 5} more")


# ============================================================================
# MAIN SCRIPT
# ============================================================================

def main():
    """Main execution"""
    parser = argparse.ArgumentParser(
        description='Cleanup duplicate chunks and vectors',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--doc-id', type=str, help='Document ID (SHA256 hash)')
    parser.add_argument('--asset-uid', type=str, help='Asset UID (will lookup doc_id)')
    parser.add_argument('--dry-run', action='store_true', help='Preview only (default)')
    parser.add_argument('--execute', action='store_true', help='Actually perform deletion')
    parser.add_argument('--keep-newest', action='store_true', help='Keep newest duplicates instead of oldest')

    args = parser.parse_args()

    # Validate arguments
    if not args.doc_id and not args.asset_uid:
        print("❌ Error: Must provide either --doc-id or --asset-uid")
        parser.print_help()
        sys.exit(1)

    # Default to dry-run if not explicitly executing
    is_dry_run = not args.execute

    print("🧹 Duplicate Chunks Cleanup Script")
    print(f"   Mode: {'DRY RUN (preview only)' if is_dry_run else 'EXECUTE (will delete!)'}")
    print(f"   Strategy: Keep {'newest' if args.keep_newest else 'oldest'} duplicates")
    print()

    try:
        # Step 1: Get doc_id
        if args.asset_uid:
            print(f"1️⃣  Looking up doc_id for asset_uid: {args.asset_uid}")
            doc_id = lookup_doc_id_by_asset_uid(args.asset_uid)
            print(f"   ✓ Doc ID: {doc_id[:16]}...")
        else:
            doc_id = args.doc_id
            print(f"1️⃣  Using doc_id: {doc_id[:16]}...")

        # Step 2: Fetch chunks from Supabase
        print(f"\n2️⃣  Fetching chunks from Supabase...")
        chunks = fetch_chunks_for_document(doc_id)
        print(f"   ✓ Found {len(chunks)} chunks")

        if not chunks:
            print("\n⚠️  No chunks found for this document")
            return

        # Step 3: Fetch vectors from Pinecone
        print(f"\n3️⃣  Fetching vectors from Pinecone...")
        vector_ids = fetch_vectors_for_document(doc_id)
        print(f"   ✓ Found {len(vector_ids)} vectors")

        # Step 4: Analyze duplicates
        print(f"\n4️⃣  Analyzing duplicates...")
        analysis = analyze_duplicates(chunks, vector_ids)
        print_analysis_report(analysis, doc_id)

        if not analysis['duplicate_groups']:
            print("\n✅ No duplicates to clean up!")
            return

        # Step 5: Decide what to delete
        print(f"\n5️⃣  Planning deletion...")
        chunks_to_delete, vectors_to_delete = decide_what_to_delete(analysis, args.keep_newest)
        print_deletion_report(chunks_to_delete, vectors_to_delete)

        # Step 6: Execute or preview
        if is_dry_run:
            print("\n" + "="*80)
            print("🔍 DRY RUN MODE - No changes made")
            print("="*80)
            print("\nTo execute this cleanup, run:")
            if args.doc_id:
                print(f"  python scripts/bulk/cleanup-duplicate-chunks.py --doc-id {doc_id} --execute")
            else:
                print(f"  python scripts/bulk/cleanup-duplicate-chunks.py --asset-uid {args.asset_uid} --execute")
            print()
        else:
            print("\n" + "="*80)
            print("⚠️  EXECUTE MODE - Performing deletion...")
            print("="*80)

            # Delete chunks from Supabase
            if chunks_to_delete:
                print(f"\n🗑️  Deleting {len(chunks_to_delete)} chunks from Supabase...")
                deleted_chunks = delete_chunks_from_supabase(chunks_to_delete)
                print(f"   ✓ Deleted {deleted_chunks} chunks")

            # Delete vectors from Pinecone
            if vectors_to_delete:
                print(f"\n🗑️  Deleting {len(vectors_to_delete)} vectors from Pinecone...")
                deleted_vectors = delete_vectors_from_pinecone(vectors_to_delete)
                print(f"   ✓ Deleted {deleted_vectors} vectors")

            print("\n✅ Cleanup complete!")
            print(f"\nFinal state:")
            print(f"  Remaining chunks: {len(chunks) - len(chunks_to_delete)}")
            print(f"  Remaining vectors: {len(vector_ids) - len(vectors_to_delete)}")
            print()

    except KeyboardInterrupt:
        print("\n\n⚠️  Script interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    main()

"""
Test script for semantic chunking system.

Tests the complete pipeline with a sample document.
"""

import asyncio
import os
import sys
from pathlib import Path

# Add app to path
sys.path.insert(0, str(Path(__file__).parent))

from app.chunking import get_processor
from app.pinecone_client import pinecone_client


async def test_chunking():
    """Test the complete chunking pipeline."""

    print("=" * 80)
    print("Semantic Chunking System - End-to-End Test")
    print("=" * 80)
    print()

    # Check for LlamaParse API key
    if not os.getenv('LLAMAPARSE_API_KEY'):
        print("❌ ERROR: LLAMAPARSE_API_KEY not found in environment")
        print("   Please add LLAMAPARSE_API_KEY to your .env file")
        return

    print("✅ LLAMAPARSE_API_KEY found")
    print()

    # Initialize processor
    print("Initializing document processor...")
    processor = get_processor(
        pinecone_client=pinecone_client,
        supabase_client=None  # Skip Supabase for now
    )
    print("✅ Processor initialized")
    print()

    # Test with a sample PDF
    # You'll need to provide a test file
    test_file = input("Enter path to test PDF file: ").strip()

    if not test_file or not Path(test_file).exists():
        print(f"❌ File not found: {test_file}")
        return

    print()
    print(f"Processing: {test_file}")
    print("-" * 80)
    print()

    # Process document
    result = await processor.process_document(
        file_path=test_file,
        filename=Path(test_file).name,
        metadata={
            'test': True,
            'source': 'test_script'
        }
    )

    # Display results
    print()
    print("=" * 80)
    print("RESULTS")
    print("=" * 80)
    print()

    if result['success']:
        print(f"✅ SUCCESS")
        print()
        print(f"Document ID:     {result['document_id']}")
        print(f"Filename:        {result['filename']}")
        print(f"Total Chunks:    {result['total_chunks']}")
        print(f"Total Tokens:    {result['total_tokens']}")
        print()

        stats = result['statistics']
        print("Statistics:")
        print(f"  Avg tokens/chunk:   {stats['avg_tokens_per_chunk']:.1f}")
        print(f"  Chunks with tables: {stats['chunks_with_tables']}")
        print(f"  Chunks with lists:  {stats['chunks_with_lists']}")
        print(f"  Chunks with code:   {stats['chunks_with_code']}")
        print(f"  Unique sections:    {stats['unique_sections']}")
        print()

        print("Pinecone Result:")
        pinecone = result['pinecone_result']
        if pinecone['success']:
            print(f"  ✅ Stored {pinecone.get('upserted_count', 0)} vectors")
        else:
            print(f"  ❌ Failed: {pinecone.get('error')}")
        print()

        print("Supabase Result:")
        supabase = result['supabase_result']
        if supabase.get('simulated'):
            print(f"  ⚠️  Simulated (no Supabase client)")
        elif supabase['success']:
            print(f"  ✅ Stored {supabase.get('stored_count', 0)} records")
        else:
            print(f"  ❌ Failed: {supabase.get('error')}")

    else:
        print(f"❌ FAILED")
        print()
        print(f"Error: {result.get('error')}")
        print(f"Stage: {result.get('stage', 'unknown')}")

    print()
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(test_chunking())

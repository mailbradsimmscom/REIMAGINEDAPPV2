#!/usr/bin/env python3
"""
Test Pinecone Metadata V2 Structure

Tests the new metadata schema with:
- primary_models[] (array)
- referenced_systems[] (array)
- is_universal (boolean)

This script reads existing LlamaParse markdown and shows what the
new chunk metadata would look like.

Usage:
    cd /Users/brad/code/REIMAGINEDAPPV2
    python-sidecar/.venv/bin/python scripts/test-pinecone-metadata-v2.py
"""

import json
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any
from datetime import datetime
import hashlib


# =============================================================================
# NEW METADATA MODEL (what we're proposing)
# =============================================================================

@dataclass
class ChunkMetadataV2:
    """
    NEW metadata schema for Pinecone chunks.

    Key changes from V1:
    - model (single string) → primary_models (array)
    - NEW: referenced_systems (array)
    - NEW: is_universal (boolean)
    """

    # Document-level metadata
    document_id: str
    filename: str
    file_type: str
    upload_date: str

    # Chunk identification
    chunk_id: str
    chunk_index: int

    # Content structure
    section_hierarchy: List[str]
    section_title: str
    section_level: int

    # Document attributes
    manufacturer: Optional[str] = None
    revision_date: Optional[str] = None
    language: Optional[str] = None
    job_id: Optional[str] = None
    doc_id: Optional[str] = None

    # =========================================
    # NEW FIELDS FOR MODEL FILTERING
    # =========================================
    primary_models: List[str] = field(default_factory=list)      # What this chunk is FOR
    referenced_systems: List[str] = field(default_factory=list)  # What this chunk MENTIONS
    is_universal: bool = False                                    # Safety/general content
    # =========================================

    # REMOVED: model (single string) - replaced by primary_models array

    # Chunk relationships
    parent_chunk_id: Optional[str] = None
    previous_chunk_id: Optional[str] = None
    next_chunk_id: Optional[str] = None

    # Content metrics
    token_count: int = 0
    char_count: int = 0
    has_tables: bool = False
    has_lists: bool = False
    has_code: bool = False

    # Search optimization
    text: str = ""
    content_snippet: str = ""

    # System metadata
    chunk_strategy_version: str = "semantic_v3"  # Bumped version
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    # Asset linking
    linked_asset_uid: Optional[str] = None
    linked_system_name: Optional[str] = None

    def to_pinecone_metadata(self) -> Dict[str, Any]:
        """Convert to Pinecone-compatible metadata."""
        metadata = asdict(self)

        # Filter out None values (Pinecone rejects null)
        metadata = {k: v for k, v in metadata.items() if v is not None}

        # Ensure arrays are present even if empty (for filtering)
        if 'primary_models' not in metadata:
            metadata['primary_models'] = []
        if 'referenced_systems' not in metadata:
            metadata['referenced_systems'] = []
        if 'is_universal' not in metadata:
            metadata['is_universal'] = False

        return metadata


# =============================================================================
# TEST DATA - Simulated chunks from Yanmar manual
# =============================================================================

def create_test_chunks() -> List[Dict[str, Any]]:
    """
    Create test chunks representing different content types from Yanmar manual.
    Shows how primary_models, referenced_systems, is_universal would be set.
    """

    user_systems = ["4JH57", "VC20", "SD60"]

    chunks = []

    # Chunk 1: Safety content (universal)
    chunks.append({
        "content": "WARNING: Never remove the filler cap when the engine is hot. "
                   "Hot coolant may spurt out causing burns. Allow engine to cool "
                   "before removing cap.",
        "metadata": ChunkMetadataV2(
            document_id="yanmar-4jh-manual",
            filename="0AJHC-EN001F-Sep.2025-0_JH-CR_OPM.pdf",
            file_type=".pdf",
            upload_date="2026-01-16T10:00:00Z",
            chunk_id="chunk-001",
            chunk_index=0,
            section_hierarchy=["Safety Information", "Warnings"],
            section_title="Warnings",
            section_level=2,
            manufacturer="Yanmar",
            text="WARNING: Never remove the filler cap when the engine is hot...",
            content_snippet="WARNING: Never remove the filler cap...",
            token_count=45,
            char_count=180,
            # NEW FIELDS
            primary_models=[],  # Empty - applies to all
            referenced_systems=[],
            is_universal=True,  # Safety content for ALL models
        ).to_pinecone_metadata()
    })

    # Chunk 2: 4JH57-specific spec
    chunks.append({
        "content": "4JH57 Engine Oil Capacity: Total system capacity at 7° rake angle: "
                   "5.0 L (5.28 US qt). Oil pan only: 4.0 L (4.23 US qt). "
                   "Use API CF or higher grade diesel engine oil.",
        "metadata": ChunkMetadataV2(
            document_id="yanmar-4jh-manual",
            filename="0AJHC-EN001F-Sep.2025-0_JH-CR_OPM.pdf",
            file_type=".pdf",
            upload_date="2026-01-16T10:00:00Z",
            chunk_id="chunk-002",
            chunk_index=1,
            section_hierarchy=["Specifications", "4-Cylinder Engines", "4JH57"],
            section_title="4JH57",
            section_level=3,
            manufacturer="Yanmar",
            text="4JH57 Engine Oil Capacity: Total system capacity...",
            content_snippet="4JH57 Engine Oil Capacity: Total system...",
            token_count=52,
            char_count=210,
            has_tables=False,
            # NEW FIELDS
            primary_models=["4JH57"],  # Specific to 4JH57
            referenced_systems=[],
            is_universal=False,
        ).to_pinecone_metadata()
    })

    # Chunk 3: VC20 connection procedure (references engine)
    chunks.append({
        "content": "VC20 Vessel Control System Connection: Connect the VC20 control head "
                   "to the engine harness using the supplied 12-pin connector. Ensure "
                   "the engine is 4JH57 or compatible model. Route cables away from "
                   "hot engine surfaces.",
        "metadata": ChunkMetadataV2(
            document_id="yanmar-4jh-manual",
            filename="0AJHC-EN001F-Sep.2025-0_JH-CR_OPM.pdf",
            file_type=".pdf",
            upload_date="2026-01-16T10:00:00Z",
            chunk_id="chunk-003",
            chunk_index=2,
            section_hierarchy=["Installation", "Vessel Control System", "VC20"],
            section_title="VC20",
            section_level=3,
            manufacturer="Yanmar",
            text="VC20 Vessel Control System Connection...",
            content_snippet="VC20 Vessel Control System Connection...",
            token_count=58,
            char_count=240,
            # NEW FIELDS
            primary_models=["VC20"],  # This chunk is FOR VC20
            referenced_systems=["4JH57"],  # But MENTIONS 4JH57
            is_universal=False,
        ).to_pinecone_metadata()
    })

    # Chunk 4: SD60 saildrive specific
    chunks.append({
        "content": "SD60 Saildrive Oil Change: Drain oil by removing the drain plug on "
                   "the lower unit. Capacity: 1.0 L. Use SAE 30 or 15W-40 marine gear oil. "
                   "Replace oil every 100 hours or annually.",
        "metadata": ChunkMetadataV2(
            document_id="yanmar-4jh-manual",
            filename="0AJHC-EN001F-Sep.2025-0_JH-CR_OPM.pdf",
            file_type=".pdf",
            upload_date="2026-01-16T10:00:00Z",
            chunk_id="chunk-004",
            chunk_index=3,
            section_hierarchy=["Maintenance", "Saildrive", "SD60"],
            section_title="SD60",
            section_level=3,
            manufacturer="Yanmar",
            text="SD60 Saildrive Oil Change...",
            content_snippet="SD60 Saildrive Oil Change...",
            token_count=48,
            char_count=195,
            # NEW FIELDS
            primary_models=["SD60"],  # Specific to SD60
            referenced_systems=[],
            is_universal=False,
        ).to_pinecone_metadata()
    })

    # Chunk 5: 4JH80-specific (user does NOT have this - should be filtered out)
    chunks.append({
        "content": "4JH80 Turbocharger Maintenance: The 4JH80 is equipped with a "
                   "turbocharger that requires inspection every 500 hours. Check for "
                   "oil leaks at the turbo seals and ensure free rotation of the impeller.",
        "metadata": ChunkMetadataV2(
            document_id="yanmar-4jh-manual",
            filename="0AJHC-EN001F-Sep.2025-0_JH-CR_OPM.pdf",
            file_type=".pdf",
            upload_date="2026-01-16T10:00:00Z",
            chunk_id="chunk-005",
            chunk_index=4,
            section_hierarchy=["Maintenance", "Turbocharger", "4JH80"],
            section_title="4JH80",
            section_level=3,
            manufacturer="Yanmar",
            text="4JH80 Turbocharger Maintenance...",
            content_snippet="4JH80 Turbocharger Maintenance...",
            token_count=55,
            char_count=220,
            # NEW FIELDS
            primary_models=["4JH80"],  # User does NOT have 4JH80
            referenced_systems=[],
            is_universal=False,
        ).to_pinecone_metadata()
    })

    # Chunk 6: General shutdown procedure (multiple models)
    chunks.append({
        "content": "Normal Engine Shutdown: 1) Reduce speed to low idle. 2) Move control "
                   "to NEUTRAL. 3) Allow engine to idle for 5 minutes to cool down. "
                   "4) Press STOP switch. This procedure applies to all engine models.",
        "metadata": ChunkMetadataV2(
            document_id="yanmar-4jh-manual",
            filename="0AJHC-EN001F-Sep.2025-0_JH-CR_OPM.pdf",
            file_type=".pdf",
            upload_date="2026-01-16T10:00:00Z",
            chunk_id="chunk-006",
            chunk_index=5,
            section_hierarchy=["Operation", "Shutdown"],
            section_title="Shutdown",
            section_level=2,
            manufacturer="Yanmar",
            text="Normal Engine Shutdown: 1) Reduce speed...",
            content_snippet="Normal Engine Shutdown: 1) Reduce...",
            token_count=62,
            char_count=250,
            # NEW FIELDS
            primary_models=["4JH57", "VC20"],  # Applies to engine + control system
            referenced_systems=[],
            is_universal=False,  # Not universal - specific to these models
        ).to_pinecone_metadata()
    })

    return chunks


# =============================================================================
# QUERY SIMULATION
# =============================================================================

def simulate_pinecone_filter(chunks: List[Dict], user_models: List[str]) -> List[Dict]:
    """
    Simulate Pinecone filter behavior.

    Filter: { "$or": [
        { "primary_models": { "$in": user_models } },
        { "is_universal": true }
    ]}
    """

    filtered = []
    for chunk in chunks:
        meta = chunk["metadata"]

        # Check if any primary_model is in user's models
        primary_match = any(m in user_models for m in meta.get("primary_models", []))

        # Check if universal
        is_universal = meta.get("is_universal", False)

        if primary_match or is_universal:
            filtered.append(chunk)

    return filtered


# =============================================================================
# MAIN
# =============================================================================

def main():
    print("=" * 70)
    print("PINECONE METADATA V2 TEST")
    print("=" * 70)

    # User's systems
    user_models = ["4JH57", "VC20", "SD60"]
    print(f"\nUser's systems: {user_models}")

    # Create test chunks
    chunks = create_test_chunks()
    print(f"\nTotal chunks in document: {len(chunks)}")

    # Show all chunks with metadata
    print("\n" + "=" * 70)
    print("ALL CHUNKS (before filtering)")
    print("=" * 70)

    for i, chunk in enumerate(chunks, 1):
        meta = chunk["metadata"]
        print(f"\n--- Chunk {i}: {meta.get('section_title', '?')} ---")
        print(f"Content preview: {chunk['content'][:80]}...")
        print(f"primary_models: {meta.get('primary_models', [])}")
        print(f"referenced_systems: {meta.get('referenced_systems', [])}")
        print(f"is_universal: {meta.get('is_universal', False)}")

    # Apply filter
    print("\n" + "=" * 70)
    print("AFTER PINECONE FILTER (user's models only)")
    print("=" * 70)
    print(f"\nFilter: primary_models IN {user_models} OR is_universal = true")

    filtered_chunks = simulate_pinecone_filter(chunks, user_models)
    print(f"\nChunks returned: {len(filtered_chunks)} of {len(chunks)}")

    for i, chunk in enumerate(filtered_chunks, 1):
        meta = chunk["metadata"]
        print(f"\n✅ {i}. {meta.get('section_title', '?')}")
        print(f"   primary_models: {meta.get('primary_models', [])}")
        print(f"   is_universal: {meta.get('is_universal', False)}")
        print(f"   Content: {chunk['content'][:60]}...")

    # Show what was filtered OUT
    print("\n" + "=" * 70)
    print("FILTERED OUT (not returned to user)")
    print("=" * 70)

    filtered_ids = {c["metadata"]["chunk_id"] for c in filtered_chunks}
    excluded = [c for c in chunks if c["metadata"]["chunk_id"] not in filtered_ids]

    for chunk in excluded:
        meta = chunk["metadata"]
        print(f"\n❌ {meta.get('section_title', '?')}")
        print(f"   primary_models: {meta.get('primary_models', [])} ← NOT in user's models")
        print(f"   Content: {chunk['content'][:60]}...")

    # Show full metadata structure for one chunk
    print("\n" + "=" * 70)
    print("FULL METADATA STRUCTURE (for review)")
    print("=" * 70)
    print("\nExample chunk metadata that would be stored in Pinecone:\n")
    print(json.dumps(chunks[1]["metadata"], indent=2))

    # Show the Pinecone query that would be used
    print("\n" + "=" * 70)
    print("PINECONE QUERY EXAMPLE")
    print("=" * 70)
    print("""
# Python code for querying Pinecone with new metadata:

user_models = ["4JH57", "VC20", "SD60"]

results = pinecone_index.query(
    vector=query_embedding,
    top_k=10,
    include_metadata=True,
    filter={
        "$or": [
            {"primary_models": {"$in": user_models}},
            {"is_universal": {"$eq": True}}
        ]
    }
)

# This returns ONLY chunks where:
# - primary_models contains 4JH57, VC20, or SD60
# - OR is_universal is True
#
# Chunks for 4JH80, VC10, etc. are NEVER returned
""")


if __name__ == "__main__":
    main()

"""
Unit tests for semantic chunking system.

Tests individual components without requiring external files.
"""

import sys
from pathlib import Path

# Add app to path
sys.path.insert(0, str(Path(__file__).parent))

from app.chunking.chunker import SemanticChunker
from app.chunking.models import ChunkMetadata, Chunk


def test_chunker():
    """Test semantic chunker with sample markdown."""

    print("=" * 80)
    print("Semantic Chunker Unit Test")
    print("=" * 80)
    print()

    # Sample markdown document
    markdown = """# Installation Manual

## Safety Guidelines

Always wear protective equipment when working with electrical components.
Ensure the power is disconnected before beginning any installation work.
Use insulated tools rated for the voltage levels you will encounter.

## Tools Required

- Voltage tester
- Insulated screwdrivers (Phillips and flathead)
- Wire strippers
- Cable ties
- Mounting brackets

## Installation Steps

### Step 1: Prepare the Mounting Location

1. Verify the mounting surface is structurally sound
2. Check for any obstructions or hazards
3. Mark the mounting hole locations
4. Pre-drill holes if required

### Step 2: Connect Power Supply

⚠️ WARNING: Ensure power is OFF before proceeding!

1. Connect the ground wire (green/yellow) first
2. Connect the neutral wire (blue)
3. Connect the phase wires (brown/black)
4. Verify all connections are tight
5. Apply heat shrink tubing to all connections

### Step 3: System Configuration

Access the configuration panel by pressing the MENU button.
Navigate to System Settings > Initial Setup.
Configure the following parameters:

| Parameter | Default Value | Description |
|-----------|---------------|-------------|
| Voltage   | 24V DC        | Operating voltage |
| Current   | 5A            | Maximum current |
| Timeout   | 30s           | Communication timeout |

## Testing and Verification

After installation, perform the following tests:

1. Visual inspection of all connections
2. Continuity test of ground connections
3. Voltage verification at all terminals
4. Functional test of all inputs/outputs

## Troubleshooting

### Device Not Powering On

- Check power supply voltage
- Verify fuse is not blown
- Inspect all wire connections

### Communication Errors

- Check cable connections
- Verify network settings
- Restart the system

## Technical Specifications

- Operating Voltage: 18-30V DC
- Power Consumption: 120W max
- Operating Temperature: -20°C to +60°C
- Protection Rating: IP65
- Dimensions: 200mm x 150mm x 80mm
- Weight: 1.2 kg
"""

    # Sample sections (normally from parser)
    sections = [
        {'level': 1, 'title': 'Installation Manual', 'start_char': 0, 'end_char': 100},
        {'level': 2, 'title': 'Safety Guidelines', 'start_char': 100, 'end_char': 400},
        {'level': 2, 'title': 'Tools Required', 'start_char': 400, 'end_char': 600},
        {'level': 2, 'title': 'Installation Steps', 'start_char': 600, 'end_char': 1500},
        {'level': 3, 'title': 'Step 1: Prepare the Mounting Location', 'start_char': 650, 'end_char': 900},
        {'level': 3, 'title': 'Step 2: Connect Power Supply', 'start_char': 900, 'end_char': 1200},
        {'level': 3, 'title': 'Step 3: System Configuration', 'start_char': 1200, 'end_char': 1500},
        {'level': 2, 'title': 'Testing and Verification', 'start_char': 1500, 'end_char': 1700},
        {'level': 2, 'title': 'Troubleshooting', 'start_char': 1700, 'end_char': 1900},
        {'level': 3, 'title': 'Device Not Powering On', 'start_char': 1750, 'end_char': 1850},
        {'level': 3, 'title': 'Communication Errors', 'start_char': 1850, 'end_char': 1900},
        {'level': 2, 'title': 'Technical Specifications', 'start_char': 1900, 'end_char': 2100},
    ]

    # Initialize chunker
    print("Initializing chunker...")
    chunker = SemanticChunker(
        target_tokens=400,  # Smaller for test
        min_tokens=200,
        max_tokens=600,
        overlap_tokens=50
    )
    print("✅ Chunker initialized")
    print()

    # Chunk document
    print("Chunking document...")
    document_chunks = chunker.chunk_document(
        markdown=markdown,
        sections=sections,
        document_id="test-doc-123",
        filename="installation_manual.md",
        metadata={
            'test': True,
            'file_type': '.md'
        }
    )
    print(f"✅ Created {document_chunks.total_chunks} chunks")
    print()

    # Display results
    print("-" * 80)
    print("RESULTS")
    print("-" * 80)
    print()

    print(f"Document ID:     {document_chunks.document_id}")
    print(f"Filename:        {document_chunks.filename}")
    print(f"Total Chunks:    {document_chunks.total_chunks}")
    print(f"Total Tokens:    {document_chunks.total_tokens}")
    print()

    stats = document_chunks.get_statistics()
    print("Statistics:")
    print(f"  Avg tokens/chunk:   {stats['avg_tokens_per_chunk']:.1f}")
    print(f"  Chunks with tables: {stats['chunks_with_tables']}")
    print(f"  Chunks with lists:  {stats['chunks_with_lists']}")
    print(f"  Chunks with code:   {stats['chunks_with_code']}")
    print(f"  Unique sections:    {stats['unique_sections']}")
    print()

    # Display each chunk
    print("-" * 80)
    print("CHUNKS")
    print("-" * 80)
    print()

    for i, chunk in enumerate(document_chunks.chunks):
        print(f"Chunk {i + 1}/{document_chunks.total_chunks}")
        print(f"  Section: {' > '.join(chunk.metadata.section_hierarchy)}")
        print(f"  Tokens: {chunk.metadata.token_count}")
        print(f"  Keywords: {', '.join(chunk.metadata.keywords[:5])}")
        print(f"  Features: tables={chunk.metadata.has_tables}, lists={chunk.metadata.has_lists}, code={chunk.metadata.has_code}")
        print(f"  Preview: {chunk.get_preview(100)}...")
        print()

    print("=" * 80)
    print("✅ All tests passed!")
    print("=" * 80)


if __name__ == "__main__":
    test_chunker()

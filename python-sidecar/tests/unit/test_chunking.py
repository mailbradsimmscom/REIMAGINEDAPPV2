# python-sidecar/tests/unit/test_chunking.py
#
# Unit tests for semantic chunking system.
# Converted from ad-hoc test_chunking_unit.py to proper pytest tests.

import pytest
from unittest.mock import patch, MagicMock

# Import chunking modules
from app.chunking.chunker import SemanticChunker
from app.chunking.models import ChunkMetadata, Chunk, DocumentChunks


# ============================================
# FIXTURES
# ============================================

@pytest.fixture
def chunker():
    """Create a SemanticChunker with test-friendly token limits."""
    return SemanticChunker(
        target_tokens=400,
        min_tokens=200,
        max_tokens=600,
        overlap_tokens=50
    )


@pytest.fixture
def sample_markdown():
    """Sample markdown document for testing."""
    return """# Installation Manual

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

WARNING: Ensure power is OFF before proceeding!

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

## Technical Specifications

- Operating Voltage: 18-30V DC
- Power Consumption: 120W max
- Operating Temperature: -20C to +60C
- Protection Rating: IP65
"""


@pytest.fixture
def sample_sections():
    """Sample sections structure from parser."""
    return [
        {'level': 1, 'title': 'Installation Manual', 'start_char': 0, 'end_char': 100},
        {'level': 2, 'title': 'Safety Guidelines', 'start_char': 100, 'end_char': 400},
        {'level': 2, 'title': 'Tools Required', 'start_char': 400, 'end_char': 600},
        {'level': 2, 'title': 'Installation Steps', 'start_char': 600, 'end_char': 1500},
        {'level': 3, 'title': 'Step 1: Prepare the Mounting Location', 'start_char': 650, 'end_char': 900},
        {'level': 3, 'title': 'Step 2: Connect Power Supply', 'start_char': 900, 'end_char': 1200},
        {'level': 3, 'title': 'Step 3: System Configuration', 'start_char': 1200, 'end_char': 1500},
        {'level': 2, 'title': 'Technical Specifications', 'start_char': 1500, 'end_char': 1700},
    ]


# ============================================
# CHUNKER INITIALIZATION TESTS
# ============================================

class TestSemanticChunkerInit:
    """Tests for SemanticChunker initialization."""

    def test_default_initialization(self):
        """Test chunker initializes with default values."""
        chunker = SemanticChunker()

        assert chunker.target_tokens == 800
        assert chunker.min_tokens == 400
        assert chunker.max_tokens == 1200
        assert chunker.overlap_tokens == 200

    def test_custom_initialization(self, chunker):
        """Test chunker initializes with custom values."""
        assert chunker.target_tokens == 400
        assert chunker.min_tokens == 200
        assert chunker.max_tokens == 600
        assert chunker.overlap_tokens == 50

    def test_tokenizer_initialized(self, chunker):
        """Test tiktoken tokenizer is initialized."""
        assert chunker.tokenizer is not None
        # Verify tokenizer works
        tokens = chunker.tokenizer.encode("hello world")
        assert len(tokens) > 0

    def test_abbreviations_loaded(self, chunker):
        """Test common abbreviations are loaded."""
        assert 'dr' in chunker.abbreviations
        assert 'mr' in chunker.abbreviations
        assert 'etc' in chunker.abbreviations
        assert 'fig' in chunker.abbreviations


# ============================================
# TOKEN COUNTING TESTS
# ============================================

class TestTokenCounting:
    """Tests for token counting functionality."""

    def test_count_tokens_simple(self, chunker):
        """Test token counting for simple text."""
        count = chunker._count_tokens("Hello world")
        assert count > 0
        assert count < 10  # Should be ~2 tokens

    def test_count_tokens_empty(self, chunker):
        """Test token counting for empty string."""
        count = chunker._count_tokens("")
        assert count == 0

    def test_count_tokens_long_text(self, chunker):
        """Test token counting for longer text."""
        long_text = "This is a test sentence. " * 50
        count = chunker._count_tokens(long_text)
        # Approximately 6 tokens per sentence * 50 = ~300 tokens
        assert count > 100
        assert count < 500


# ============================================
# CONTENT ANALYSIS TESTS
# ============================================

class TestContentAnalysis:
    """Tests for content feature detection."""

    def test_detect_tables(self, chunker):
        """Test detection of markdown tables."""
        text_with_table = """
| Header 1 | Header 2 |
|----------|----------|
| Value 1  | Value 2  |
"""
        result = chunker._analyze_content(text_with_table)
        assert result['has_tables'] is True

    def test_no_tables(self, chunker):
        """Test no false positive for tables."""
        text_without_table = "This is just plain text without any tables."
        result = chunker._analyze_content(text_without_table)
        assert result['has_tables'] is False

    def test_detect_lists_bullet(self, chunker):
        """Test detection of bullet lists."""
        text_with_list = """
Here is a list:
- Item one
- Item two
- Item three
"""
        result = chunker._analyze_content(text_with_list)
        assert result['has_lists'] is True

    def test_detect_lists_numbered(self, chunker):
        """Test detection of numbered lists."""
        text_with_list = """
Steps:
1. First step
2. Second step
3. Third step
"""
        result = chunker._analyze_content(text_with_list)
        assert result['has_lists'] is True

    def test_detect_code(self, chunker):
        """Test detection of code blocks."""
        text_with_code = """
Here is some code:
```python
def hello():
    print("world")
```
"""
        result = chunker._analyze_content(text_with_code)
        assert result['has_code'] is True

    def test_no_code(self, chunker):
        """Test no false positive for code."""
        text_without_code = "This is plain text without code blocks."
        result = chunker._analyze_content(text_without_code)
        assert result['has_code'] is False


# ============================================
# DOCUMENT CHUNKING TESTS
# ============================================

class TestDocumentChunking:
    """Tests for full document chunking."""

    def test_chunk_document_creates_chunks(self, chunker, sample_markdown, sample_sections):
        """Test that chunk_document creates chunks."""
        result = chunker.chunk_document(
            markdown=sample_markdown,
            sections=sample_sections,
            document_id="test-doc-123",
            filename="test_manual.md",
            metadata={'test': True}
        )

        assert isinstance(result, DocumentChunks)
        assert result.total_chunks > 0
        assert len(result.chunks) == result.total_chunks

    def test_chunk_document_metadata(self, chunker, sample_markdown, sample_sections):
        """Test that chunks have proper metadata."""
        result = chunker.chunk_document(
            markdown=sample_markdown,
            sections=sample_sections,
            document_id="test-doc-123",
            filename="test_manual.md",
            metadata={'test': True, 'file_type': '.md'}
        )

        # Check first chunk has required metadata
        first_chunk = result.chunks[0]
        assert first_chunk.metadata.document_id == "test-doc-123"
        assert first_chunk.metadata.filename == "test_manual.md"
        assert first_chunk.metadata.chunk_index == 0

    def test_chunk_document_relationships(self, chunker, sample_markdown, sample_sections):
        """Test that chunks have proper relationships."""
        result = chunker.chunk_document(
            markdown=sample_markdown,
            sections=sample_sections,
            document_id="test-doc-123",
            filename="test_manual.md",
            metadata={}
        )

        if len(result.chunks) > 1:
            # First chunk has no previous
            assert result.chunks[0].metadata.previous_chunk_id is None

            # Middle chunks have both prev and next
            for i in range(1, len(result.chunks) - 1):
                assert result.chunks[i].metadata.previous_chunk_id is not None
                assert result.chunks[i].metadata.next_chunk_id is not None

            # Last chunk has no next
            assert result.chunks[-1].metadata.next_chunk_id is None

    def test_chunk_document_token_counts(self, chunker, sample_markdown, sample_sections):
        """Test that token counts are populated."""
        result = chunker.chunk_document(
            markdown=sample_markdown,
            sections=sample_sections,
            document_id="test-doc-123",
            filename="test_manual.md",
            metadata={}
        )

        assert result.total_tokens > 0
        for chunk in result.chunks:
            assert chunk.metadata.token_count > 0

    def test_chunk_document_respects_max_tokens(self, chunker, sample_markdown, sample_sections):
        """Test that no chunk exceeds max_tokens."""
        result = chunker.chunk_document(
            markdown=sample_markdown,
            sections=sample_sections,
            document_id="test-doc-123",
            filename="test_manual.md",
            metadata={}
        )

        for chunk in result.chunks:
            # Allow some tolerance for tokenizer edge cases
            assert chunk.metadata.token_count <= chunker.max_tokens + 10, \
                f"Chunk exceeds max: {chunk.metadata.token_count} > {chunker.max_tokens}"


# ============================================
# STATISTICS TESTS
# ============================================

class TestDocumentStatistics:
    """Tests for DocumentChunks statistics."""

    def test_get_statistics(self, chunker, sample_markdown, sample_sections):
        """Test statistics calculation."""
        result = chunker.chunk_document(
            markdown=sample_markdown,
            sections=sample_sections,
            document_id="test-doc-123",
            filename="test_manual.md",
            metadata={}
        )

        stats = result.get_statistics()

        assert 'total_chunks' in stats
        assert 'total_tokens' in stats
        assert 'avg_tokens_per_chunk' in stats
        assert 'chunks_with_tables' in stats
        assert 'chunks_with_lists' in stats
        assert 'chunks_with_code' in stats
        assert 'unique_sections' in stats

    def test_statistics_values(self, chunker, sample_markdown, sample_sections):
        """Test statistics have reasonable values."""
        result = chunker.chunk_document(
            markdown=sample_markdown,
            sections=sample_sections,
            document_id="test-doc-123",
            filename="test_manual.md",
            metadata={}
        )

        stats = result.get_statistics()

        assert stats['total_chunks'] == result.total_chunks
        assert stats['total_tokens'] == result.total_tokens
        assert stats['avg_tokens_per_chunk'] > 0


# ============================================
# MODELS TESTS
# ============================================

class TestChunkMetadata:
    """Tests for ChunkMetadata model."""

    def test_to_dict(self):
        """Test ChunkMetadata serialization."""
        metadata = ChunkMetadata(
            document_id="doc-123",
            filename="test.md",
            file_type=".md",
            upload_date="2025-01-01",
            chunk_id="chunk-1",
            chunk_index=0,
            section_hierarchy=["Title", "Section"],
            section_title="Section",
            section_level=2
        )

        data = metadata.to_dict()
        assert data['document_id'] == "doc-123"
        assert data['chunk_index'] == 0
        assert data['section_hierarchy'] == ["Title", "Section"]

    def test_from_dict(self):
        """Test ChunkMetadata deserialization."""
        data = {
            'document_id': "doc-123",
            'filename': "test.md",
            'file_type': ".md",
            'upload_date': "2025-01-01",
            'chunk_id': "chunk-1",
            'chunk_index': 0,
            'section_hierarchy': ["Title"],
            'section_title': "Title",
            'section_level': 1
        }

        metadata = ChunkMetadata.from_dict(data)
        assert metadata.document_id == "doc-123"
        assert metadata.chunk_index == 0

    def test_to_pinecone_metadata_excludes_none(self):
        """Test Pinecone metadata excludes None values."""
        metadata = ChunkMetadata(
            document_id="doc-123",
            filename="test.md",
            file_type=".md",
            upload_date="2025-01-01",
            chunk_id="chunk-1",
            chunk_index=0,
            section_hierarchy=["Title"],
            section_title="Title",
            section_level=1,
            manufacturer=None,  # Should be excluded
            model=None  # Should be excluded
        )

        pinecone_meta = metadata.to_pinecone_metadata()
        assert 'manufacturer' not in pinecone_meta
        assert 'model' not in pinecone_meta


class TestChunk:
    """Tests for Chunk model."""

    def test_get_preview_short(self):
        """Test preview for short content."""
        metadata = ChunkMetadata(
            document_id="doc", filename="f", file_type="md",
            upload_date="2025", chunk_id="c", chunk_index=0,
            section_hierarchy=[], section_title="", section_level=0
        )
        chunk = Chunk(content="Short text", metadata=metadata)

        preview = chunk.get_preview(200)
        assert preview == "Short text"

    def test_get_preview_long(self):
        """Test preview for long content."""
        metadata = ChunkMetadata(
            document_id="doc", filename="f", file_type="md",
            upload_date="2025", chunk_id="c", chunk_index=0,
            section_hierarchy=[], section_title="", section_level=0
        )
        long_content = "A" * 300
        chunk = Chunk(content=long_content, metadata=metadata)

        preview = chunk.get_preview(200)
        assert len(preview) == 203  # 200 + "..."
        assert preview.endswith("...")

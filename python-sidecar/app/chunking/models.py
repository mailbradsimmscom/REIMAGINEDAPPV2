"""
Data models for semantic chunking system.

Defines structured models for chunks and metadata with:
- Hierarchical section tracking
- Parent/child chunk relationships
- Hybrid search support (dense + sparse)
- Validation and serialization
"""

from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field, asdict
from datetime import datetime


@dataclass
class ChunkMetadata:
    """
    Hierarchical metadata for document chunks.

    Tracks document context, section hierarchy, and chunk relationships
    for precise retrieval and context reconstruction.
    """

    # Document-level metadata
    document_id: str
    filename: str
    file_type: str
    upload_date: str

    # Chunk identification
    chunk_id: str
    chunk_index: int  # Position within document (0-indexed)

    # Content structure
    section_hierarchy: List[str]  # ["Main Title", "Section 2", "Subsection 2.1"]
    section_title: str  # Immediate parent section
    section_level: int  # Header level (1-6)

    # Document attributes (CRITICAL for Pinecone filtering!)
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    revision_date: Optional[str] = None
    language: Optional[str] = None
    job_id: Optional[str] = None
    doc_id: Optional[str] = None  # Alias for document_id (legacy compatibility)

    # Chunk relationships
    parent_chunk_id: Optional[str] = None  # For hierarchical chunking
    previous_chunk_id: Optional[str] = None  # Sequential navigation
    next_chunk_id: Optional[str] = None

    # Content metrics
    token_count: int = 0
    char_count: int = 0
    has_tables: bool = False
    has_lists: bool = False
    has_code: bool = False

    # Search optimization
    text: str = ""  # Full chunk text for RAG retrieval
    content_snippet: str = ""  # First 200 chars for preview
    keywords: List[str] = field(default_factory=list)  # BM25 keywords

    # System metadata
    chunk_strategy_version: str = "semantic_v2"
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    # Asset linking (for DIP system)
    linked_asset_uid: Optional[str] = None
    linked_system_name: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ChunkMetadata':
        """Create instance from dictionary."""
        return cls(**data)

    def to_pinecone_metadata(self) -> Dict[str, Any]:
        """
        Convert to Pinecone-compatible metadata.

        Removes content and converts types for Pinecone storage.
        Pinecone metadata is limited to 40KB per vector.
        """
        metadata = self.to_dict()

        # Remove large fields (stored in Supabase)
        metadata.pop('keywords', None)  # Can be large

        # Ensure all values are Pinecone-compatible types
        # (str, int, float, bool, list of str/int/float/bool)
        if 'section_hierarchy' in metadata:
            metadata['section_hierarchy'] = [str(s) for s in metadata['section_hierarchy']]

        # CRITICAL: Filter out None values - Pinecone rejects null
        metadata = {k: v for k, v in metadata.items() if v is not None}

        return metadata


@dataclass
class Chunk:
    """
    Semantic chunk with content and metadata.

    Represents a single semantically coherent unit of document content
    with full context for retrieval and generation.
    """

    # Core content
    content: str  # The actual chunk text
    metadata: ChunkMetadata

    # Vector embeddings (populated during processing)
    dense_vector: Optional[List[float]] = None  # OpenAI embedding (3,072 dim)
    sparse_vector: Optional[Dict[str, float]] = None  # BM25 keywords

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            'content': self.content,
            'metadata': self.metadata.to_dict(),
            'dense_vector': self.dense_vector,
            'sparse_vector': self.sparse_vector
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Chunk':
        """Create instance from dictionary."""
        return cls(
            content=data['content'],
            metadata=ChunkMetadata.from_dict(data['metadata']),
            dense_vector=data.get('dense_vector'),
            sparse_vector=data.get('sparse_vector')
        )

    def get_pinecone_vector(self) -> Dict[str, Any]:
        """
        Format chunk for Pinecone upsert.

        Returns dict with id, values, and metadata.
        Content is stored in Supabase, not in Pinecone metadata.
        """
        if not self.dense_vector:
            raise ValueError("Dense vector not generated for chunk")

        return {
            'id': self.metadata.chunk_id,
            'values': self.dense_vector,
            'metadata': self.metadata.to_pinecone_metadata()
        }

    def get_supabase_record(self) -> Dict[str, Any]:
        """
        Format chunk for Supabase storage.

        Stores full content, metadata, and sparse vectors for backup
        and analytics.
        """
        import hashlib

        # Generate checksum for content (required by DB)
        checksum = hashlib.sha256(self.content.encode('utf-8')).hexdigest()

        return {
            'chunk_id': self.metadata.chunk_id,
            'doc_id': self.metadata.document_id,
            'content_type': 'text',
            'text': self.content,
            'checksum': checksum,
            'chunk_index': self.metadata.chunk_index,
            'metadata': self.metadata.to_dict(),
            'created_at': self.metadata.created_at
        }

    def get_preview(self, max_length: int = 200) -> str:
        """Get preview of chunk content."""
        if len(self.content) <= max_length:
            return self.content
        return self.content[:max_length] + "..."


@dataclass
class DocumentChunks:
    """
    Collection of chunks from a single document.

    Maintains document-level context and chunk relationships.
    """

    document_id: str
    filename: str
    chunks: List[Chunk]
    total_chunks: int
    total_tokens: int
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            'document_id': self.document_id,
            'filename': self.filename,
            'chunks': [chunk.to_dict() for chunk in self.chunks],
            'total_chunks': self.total_chunks,
            'total_tokens': self.total_tokens,
            'metadata': self.metadata
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'DocumentChunks':
        """Create instance from dictionary."""
        return cls(
            document_id=data['document_id'],
            filename=data['filename'],
            chunks=[Chunk.from_dict(c) for c in data['chunks']],
            total_chunks=data['total_chunks'],
            total_tokens=data['total_tokens'],
            metadata=data.get('metadata', {})
        )

    def get_pinecone_vectors(self) -> List[Dict[str, Any]]:
        """Get all chunks formatted for Pinecone upsert."""
        return [chunk.get_pinecone_vector() for chunk in self.chunks]

    def get_supabase_records(self) -> List[Dict[str, Any]]:
        """Get all chunks formatted for Supabase insert."""
        return [chunk.get_supabase_record() for chunk in self.chunks]

    def get_statistics(self) -> Dict[str, Any]:
        """Get statistics about the chunks."""
        return {
            'total_chunks': self.total_chunks,
            'total_tokens': self.total_tokens,
            'avg_tokens_per_chunk': self.total_tokens / max(self.total_chunks, 1),
            'chunks_with_tables': sum(1 for c in self.chunks if c.metadata.has_tables),
            'chunks_with_lists': sum(1 for c in self.chunks if c.metadata.has_lists),
            'chunks_with_code': sum(1 for c in self.chunks if c.metadata.has_code),
            'unique_sections': len(set(
                tuple(c.metadata.section_hierarchy) for c in self.chunks
            ))
        }

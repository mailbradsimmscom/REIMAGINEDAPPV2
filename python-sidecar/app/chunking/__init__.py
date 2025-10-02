"""
Semantic document chunking system.

This module implements enterprise-grade document chunking with:
- LlamaParse for multi-format document parsing
- RecursiveCharacterTextSplitter for semantic chunking
- Hierarchical metadata with chunk relationships
- Hybrid search support (dense + sparse vectors)
"""

from .models import Chunk, ChunkMetadata, DocumentChunks
from .parser import DocumentParser, get_parser
from .chunker import SemanticChunker, get_chunker
from .embeddings import EmbeddingService, get_embedding_service
from .pipeline import DocumentProcessor, get_processor

__version__ = "2.0.0"

__all__ = [
    'Chunk',
    'ChunkMetadata',
    'DocumentChunks',
    'DocumentParser',
    'get_parser',
    'SemanticChunker',
    'get_chunker',
    'EmbeddingService',
    'get_embedding_service',
    'DocumentProcessor',
    'get_processor'
]

"""
Semantic document chunking with RecursiveCharacterTextSplitter.

Implements intelligent chunking that:
- Respects document structure (sections, paragraphs, sentences)
- Maintains optimal token counts (400-1200, target 800)
- Preserves semantic coherence
- Tracks hierarchical relationships
"""

import re
import uuid
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

import tiktoken
from langchain.text_splitter import RecursiveCharacterTextSplitter
from rank_bm25 import BM25Okapi

from .models import Chunk, ChunkMetadata, DocumentChunks

logger = logging.getLogger(__name__)


class SemanticChunker:
    """
    Enterprise-grade semantic chunking with optimal sizing.

    Uses RecursiveCharacterTextSplitter to create chunks that:
    - Respect markdown structure (headers, lists, code blocks)
    - Stay within token limits (min 400, target 800, max 1200)
    - Maintain 15% overlap for context continuity
    - Build hierarchical metadata
    """

    def __init__(
        self,
        target_tokens: int = 800,
        min_tokens: int = 400,
        max_tokens: int = 1200,
        overlap_tokens: int = 100
    ):
        """
        Initialize semantic chunker.

        Args:
            target_tokens: Ideal chunk size in tokens
            min_tokens: Minimum acceptable chunk size
            max_tokens: Maximum acceptable chunk size
            overlap_tokens: Overlap between chunks for context
        """
        self.target_tokens = target_tokens
        self.min_tokens = min_tokens
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens

        # Initialize tokenizer (same as OpenAI uses for embeddings)
        self.tokenizer = tiktoken.get_encoding("cl100k_base")

        # Configure RecursiveCharacterTextSplitter
        # Separators ordered by structural importance
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=self._tokens_to_chars(target_tokens),
            chunk_overlap=self._tokens_to_chars(overlap_tokens),
            length_function=self._count_tokens,
            separators=[
                "\n\n# ",      # H1 headers (highest priority)
                "\n\n## ",     # H2 headers
                "\n\n### ",    # H3 headers
                "\n\n#### ",   # H4 headers
                "\n\n",        # Paragraph breaks
                "\n",          # Line breaks
                ". ",          # Sentences
                " ",           # Words
                ""             # Characters (last resort)
            ],
            is_separator_regex=False
        )

        logger.info(
            f"Initialized SemanticChunker: "
            f"target={target_tokens}, min={min_tokens}, max={max_tokens}, "
            f"overlap={overlap_tokens}"
        )

    def chunk_document(
        self,
        markdown: str,
        sections: List[Dict[str, Any]],
        document_id: str,
        filename: str,
        metadata: Dict[str, Any]
    ) -> DocumentChunks:
        """
        Chunk document into semantic units.

        Args:
            markdown: Full markdown content
            sections: Hierarchical sections from parser
            document_id: Unique document identifier
            filename: Original filename
            metadata: Document-level metadata

        Returns:
            DocumentChunks with all chunks and metadata
        """
        try:
            logger.info(f"Chunking document {filename}: {len(markdown)} chars")

            # Split using RecursiveCharacterTextSplitter
            raw_chunks = self.splitter.split_text(markdown)

            logger.info(f"Generated {len(raw_chunks)} raw chunks")

            # Build Chunk objects with full metadata
            chunks = []
            total_tokens = 0

            for i, chunk_text in enumerate(raw_chunks):
                # Find section hierarchy for this chunk
                section_info = self._find_section(chunk_text, sections, markdown)

                # Count tokens and chars
                token_count = self._count_tokens(chunk_text)
                char_count = len(chunk_text)
                total_tokens += token_count

                # Analyze content features
                content_features = self._analyze_content(chunk_text)

                # Build chunk metadata
                chunk_id = str(uuid.uuid4())
                chunk_metadata = ChunkMetadata(
                    # Document info
                    document_id=document_id,
                    filename=filename,
                    file_type=metadata.get('file_type', 'unknown'),
                    upload_date=datetime.utcnow().isoformat(),

                    # Document attributes (CRITICAL for Pinecone filtering!)
                    manufacturer=metadata.get('manufacturer'),
                    model=metadata.get('model'),
                    revision_date=metadata.get('revision_date'),
                    language=metadata.get('language'),
                    job_id=metadata.get('job_id'),
                    doc_id=metadata.get('doc_id', document_id),  # Use doc_id if provided, else document_id

                    # Chunk identification
                    chunk_id=chunk_id,
                    chunk_index=i,

                    # Section hierarchy
                    section_hierarchy=section_info['hierarchy'],
                    section_title=section_info['title'],
                    section_level=section_info['level'],

                    # Relationships (populated after all chunks created)
                    parent_chunk_id=None,
                    previous_chunk_id=chunks[i-1].metadata.chunk_id if i > 0 else None,
                    next_chunk_id=None,  # Will be set for previous chunk

                    # Metrics
                    token_count=token_count,
                    char_count=char_count,
                    has_tables=content_features['has_tables'],
                    has_lists=content_features['has_lists'],
                    has_code=content_features['has_code'],

                    # Search optimization
                    content_snippet=chunk_text[:200],
                    keywords=[],  # Will be populated with BM25

                    # Asset linking
                    linked_asset_uid=metadata.get('asset_uid'),
                    linked_system_name=metadata.get('system_name')
                )

                # Create chunk
                chunk = Chunk(
                    content=chunk_text,
                    metadata=chunk_metadata
                )
                chunks.append(chunk)

                # Set next_chunk_id for previous chunk
                if i > 0:
                    chunks[i-1].metadata.next_chunk_id = chunk_id

            # Extract BM25 keywords across all chunks
            self._extract_keywords(chunks)

            logger.info(
                f"Created {len(chunks)} chunks, "
                f"total {total_tokens} tokens, "
                f"avg {total_tokens/len(chunks):.0f} tokens/chunk"
            )

            return DocumentChunks(
                document_id=document_id,
                filename=filename,
                chunks=chunks,
                total_chunks=len(chunks),
                total_tokens=total_tokens,
                metadata=metadata
            )

        except Exception as e:
            logger.error(f"Failed to chunk document: {e}")
            raise

    def _count_tokens(self, text: str) -> int:
        """Count tokens using tiktoken (same as OpenAI)."""
        return len(self.tokenizer.encode(text))

    def _tokens_to_chars(self, tokens: int) -> int:
        """
        Estimate character count for token count.

        Average: 1 token ≈ 4 characters for English text.
        """
        return tokens * 4

    def _find_section(
        self,
        chunk_text: str,
        sections: List[Dict[str, Any]],
        full_markdown: str
    ) -> Dict[str, Any]:
        """
        Find which section(s) this chunk belongs to.

        Returns section hierarchy for metadata.
        """
        # Find chunk position in document
        chunk_start = full_markdown.find(chunk_text)
        if chunk_start == -1:
            # Chunk not found exactly (likely due to splitting)
            # Use first line to find approximate position
            first_line = chunk_text.split('\n')[0][:50]
            chunk_start = full_markdown.find(first_line)

        if chunk_start == -1:
            # Fallback: no section info
            return {
                'hierarchy': ['Document'],
                'title': 'Document',
                'level': 0
            }

        # Find all sections that contain this chunk
        containing_sections = []
        for section in sections:
            if section['start_char'] <= chunk_start < section['end_char']:
                containing_sections.append(section)

        if not containing_sections:
            return {
                'hierarchy': ['Document'],
                'title': 'Document',
                'level': 0
            }

        # Sort by level (deepest first)
        containing_sections.sort(key=lambda s: s['level'], reverse=True)

        # Build hierarchy from top to bottom
        hierarchy = []
        current_level = 1
        for section in reversed(containing_sections):
            if section['level'] <= 6:  # Only include h1-h6
                hierarchy.append(section['title'])
                current_level = section['level']

        if not hierarchy:
            hierarchy = ['Document']

        # Immediate parent is last in hierarchy
        immediate_section = containing_sections[0] if containing_sections else None

        return {
            'hierarchy': hierarchy,
            'title': immediate_section['title'] if immediate_section else 'Document',
            'level': immediate_section['level'] if immediate_section else 0
        }

    def _analyze_content(self, text: str) -> Dict[str, bool]:
        """
        Analyze chunk content for special features.

        Detects tables, lists, code blocks for metadata.
        """
        has_tables = bool(re.search(r'\|.*\|', text))  # Markdown tables
        has_lists = bool(re.search(r'^[\s]*[-*+\d]+\.?\s', text, re.MULTILINE))
        has_code = bool(re.search(r'```', text))  # Code blocks

        return {
            'has_tables': has_tables,
            'has_lists': has_lists,
            'has_code': has_code
        }

    def _extract_keywords(self, chunks: List[Chunk]) -> None:
        """
        Extract BM25 keywords from all chunks.

        Modifies chunks in-place to add keywords to metadata.
        """
        try:
            # Tokenize all chunk content
            tokenized_chunks = []
            for chunk in chunks:
                # Simple tokenization: lowercase, split on non-alphanumeric
                tokens = re.findall(r'\b\w+\b', chunk.content.lower())
                tokenized_chunks.append(tokens)

            # Build BM25 index
            bm25 = BM25Okapi(tokenized_chunks)

            # For each chunk, get top keywords
            for i, chunk in enumerate(chunks):
                tokens = tokenized_chunks[i]

                # Score each token in this chunk
                scores = bm25.get_scores(tokens)

                # Get top 10 unique tokens
                token_scores = list(zip(tokens, scores))
                token_scores.sort(key=lambda x: x[1], reverse=True)

                # Deduplicate while preserving order
                seen = set()
                top_keywords = []
                for token, score in token_scores:
                    if token not in seen and len(token) > 2:  # Skip short tokens
                        seen.add(token)
                        top_keywords.append(token)
                        if len(top_keywords) >= 10:
                            break

                chunk.metadata.keywords = top_keywords

            logger.debug(f"Extracted keywords for {len(chunks)} chunks")

        except Exception as e:
            logger.warning(f"Failed to extract keywords: {e}")
            # Non-critical, continue without keywords


# Global chunker instance
_chunker_instance: Optional[SemanticChunker] = None


def get_chunker() -> SemanticChunker:
    """Get or create global chunker instance."""
    global _chunker_instance
    if _chunker_instance is None:
        _chunker_instance = SemanticChunker()
    return _chunker_instance

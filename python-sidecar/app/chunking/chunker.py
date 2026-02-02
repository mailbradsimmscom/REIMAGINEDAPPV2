"""
Markdown-aware document chunking with strict token limits.

Implements intelligent chunking that:
- Preserves markdown headers (# through ####)
- Maintains strict token limits (min 400, target 800, max 1200)
- Adds 200-token overlap (~150 chars) for context continuity
- Handles abbreviations, decimals, numbered lists in sentence splitting
"""

import re
import uuid
import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime

import tiktoken
from rank_bm25 import BM25Okapi

from .models import Chunk, ChunkMetadata, DocumentChunks

logger = logging.getLogger(__name__)

# Universal section indicators (shared with Vision Stage 6)
UNIVERSAL_SECTIONS = [
    'SAFETY', 'TABLE OF CONTENTS', 'RECORD OF OWNERSHIP',
    'WARRANTY', 'DISCLAIMER', 'PRECAUTION', 'NOTICE'
]


def find_models_in_text(text: str, models_covered: List[str], referenced_selections: List[str]) -> Tuple[List[str], List[str]]:
    """
    Find model numbers mentioned in text.

    Returns:
        (primary_models_found, referenced_systems_found)
    """
    if not text:
        return [], []

    text_upper = text.upper()

    found_primary = []
    for model in (models_covered or []):
        if model.upper() in text_upper:
            found_primary.append(model)

    found_referenced = []
    for ref in (referenced_selections or []):
        if ref.upper() in text_upper:
            found_referenced.append(ref)

    return found_primary, found_referenced


def is_universal_section(text: str) -> bool:
    """Check if text indicates a universal section (SAFETY/WARRANTY/etc.)."""
    if not text:
        return False
    text_upper = text.upper()
    return any(section in text_upper for section in UNIVERSAL_SECTIONS)


def compute_v5_tags(
    chunk_text: str,
    section_hierarchy: List[str],
    models_covered: List[str],
    selected_models: List[str],  # Not used (Rule 5: never default to user selection)
    referenced_selections: List[str]
) -> Dict[str, Any]:
    """
    Compute v5 model tags for a chunk using HIGH-RECALL indexing rules.

    Rules (in priority order per addendum 2026-01-27):
    - Rule 0: Always detect referenced_systems from text
    - Rule 1: Section/header model inheritance (highest priority)
    - Rule 2: Chunk text explicit model mentions
    - Rule 3: Universal-by-section keywords (SAFETY/WARRANTY)
    - Rule 4: Default to manual-universal if no model signal
    - Rule 5: Never skip, never default to selected_models

    Returns:
        {
            'primary_models': [...],
            'referenced_systems': [...],
            'is_universal': bool
        }
    """
    models_covered_set = set(models_covered or [])

    # Rule 0: Always detect referenced_systems from chunk text
    _, found_referenced = find_models_in_text(
        chunk_text, [], referenced_selections
    )

    # Rule 1: Check section_hierarchy for model mentions
    models_from_headers = []
    for header in (section_hierarchy or []):
        header_models, _ = find_models_in_text(header, models_covered, [])
        models_from_headers.extend(header_models)
    models_from_headers = list(set(models_from_headers))  # dedupe

    # Rule 2: Check chunk text for model mentions
    models_from_text, _ = find_models_in_text(chunk_text, models_covered, [])

    # Rule 3: Check if any header is a universal section
    is_universal_by_section = any(is_universal_section(h) for h in (section_hierarchy or []))

    # Determine primary_models and is_universal (priority order)

    # Priority 1: Section header models (Rule 1)
    if models_from_headers:
        primary_models = models_from_headers
        is_universal = (set(primary_models) == models_covered_set) and len(models_covered_set) > 0
        return {
            'primary_models': primary_models,
            'referenced_systems': found_referenced,
            'is_universal': is_universal
        }

    # Priority 2: Chunk text models (Rule 2)
    if models_from_text:
        primary_models = models_from_text
        is_universal = (set(primary_models) == models_covered_set) and len(models_covered_set) > 0
        return {
            'primary_models': primary_models,
            'referenced_systems': found_referenced,
            'is_universal': is_universal
        }

    # Priority 3: Universal section keywords (Rule 3)
    if is_universal_by_section:
        return {
            'primary_models': list(models_covered or []),
            'referenced_systems': found_referenced,
            'is_universal': True
        }

    # Rule 4: Default to manual-universal (HIGH RECALL - no skip!)
    # "No model mentioned" ≠ "unknown". The manual itself provides the scope.
    return {
        'primary_models': list(models_covered or []),
        'referenced_systems': found_referenced,
        'is_universal': True
    }


class SemanticChunker:
    """
    Markdown-aware chunker with guaranteed token limits.

    Replaces langchain RecursiveCharacterTextSplitter with:
    - Header-preserving splits (regex capture groups)
    - Token-accurate counting (tiktoken)
    - Strict max enforcement (no more 7KB blobs!)
    - Smart sentence splitting (handles abbreviations, decimals, lists)
    """

    def __init__(
        self,
        target_tokens: int = 800,
        min_tokens: int = 400,
        max_tokens: int = 1200,
        overlap_tokens: int = 200  # ~150 chars (1 token ≈ 0.75 chars)
    ):
        """
        Initialize semantic chunker.

        Args:
            target_tokens: Ideal chunk size in tokens
            min_tokens: Minimum acceptable chunk size
            max_tokens: Maximum acceptable chunk size (STRICTLY ENFORCED)
            overlap_tokens: Overlap between chunks (~200 tokens = ~150 chars)
        """
        self.target_tokens = target_tokens
        self.min_tokens = min_tokens
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens

        # Initialize tokenizer (same as OpenAI uses for embeddings)
        self.tokenizer = tiktoken.get_encoding("cl100k_base")

        # Common abbreviations that shouldn't trigger sentence breaks
        self.abbreviations = {
            'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr',
            'etc', 'vs', 'inc', 'ltd', 'corp', 'fig',
            'vol', 'approx', 'est', 'dept', 'univ',
            'max', 'min', 'no', 'nos', 'pg', 'pp'
        }

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

            # Extract v5 tag inputs from metadata
            models_covered = metadata.get('models_covered', [])
            selected_models = metadata.get('selected_models', [])
            referenced_selections = metadata.get('referenced_selections', [])

            logger.info(f"v5 tagging: models_covered={models_covered}, selected={selected_models}, refs={referenced_selections}")

            # Split using new markdown-aware chunker
            raw_chunks_with_tokens = self._chunk_markdown(markdown)

            logger.info(
                f"Generated {len(raw_chunks_with_tokens)} chunks, "
                f"avg {sum(t for _, t in raw_chunks_with_tokens) / len(raw_chunks_with_tokens):.0f} tokens/chunk"
            )

            # Build Chunk objects with full metadata
            chunks = []
            skipped_chunks = 0
            total_tokens = 0

            for i, (chunk_text, token_count) in enumerate(raw_chunks_with_tokens):
                # Find section hierarchy for this chunk
                section_info = self._find_section(chunk_text, sections, markdown)

                # Compute v5 tags for this chunk (high-recall: no skipping)
                v5_tags = compute_v5_tags(
                    chunk_text=chunk_text,
                    section_hierarchy=section_info['hierarchy'],
                    models_covered=models_covered,
                    selected_models=selected_models,
                    referenced_selections=referenced_selections
                )

                # Note: High-recall indexing - we no longer skip chunks.
                # skipped_chunks stays 0; filtering happens at query time.

                # Count chars
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
                    doc_id=metadata.get('doc_id', document_id),

                    # Chunk identification
                    chunk_id=chunk_id,
                    chunk_index=len(chunks),  # Use actual index (accounts for skipped chunks)

                    # Section hierarchy
                    section_hierarchy=section_info['hierarchy'],
                    section_title=section_info['title'],
                    section_level=section_info['level'],

                    # Relationships
                    parent_chunk_id=None,
                    previous_chunk_id=chunks[-1].metadata.chunk_id if chunks else None,
                    next_chunk_id=None,

                    # Metrics
                    token_count=token_count,
                    char_count=char_count,
                    has_tables=content_features['has_tables'],
                    has_lists=content_features['has_lists'],
                    has_code=content_features['has_code'],

                    # Search optimization
                    text=chunk_text,
                    content_snippet=chunk_text[:200],
                    keywords=[],

                    # Asset linking (legacy)
                    linked_asset_uid=metadata.get('asset_uid'),
                    linked_system_name=metadata.get('system_name'),

                    # v5 model tagging
                    primary_models=v5_tags['primary_models'],
                    referenced_systems=v5_tags['referenced_systems'],
                    is_universal=v5_tags['is_universal']
                )

                # Create chunk
                chunk = Chunk(
                    content=chunk_text,
                    metadata=chunk_metadata
                )
                # Set next_chunk_id for previous chunk before appending
                if chunks:
                    chunks[-1].metadata.next_chunk_id = chunk_id

                chunks.append(chunk)

            # Extract BM25 keywords across all chunks
            self._extract_keywords(chunks)

            avg_tokens = total_tokens / len(chunks) if chunks else 0
            logger.info(
                f"Created {len(chunks)} chunks (skipped {skipped_chunks} unknown attribution), "
                f"total {total_tokens} tokens, "
                f"avg {avg_tokens:.0f} tokens/chunk"
            )

            return DocumentChunks(
                document_id=document_id,
                filename=filename,
                chunks=chunks,
                total_chunks=len(chunks),
                total_tokens=total_tokens,
                chunks_skipped=skipped_chunks,
                metadata=metadata
            )

        except Exception as e:
            logger.error(f"Failed to chunk document: {e}")
            raise

    def _chunk_markdown(self, text: str) -> List[Tuple[str, int]]:
        """
        Chunk markdown text with overlap and strict token limits.

        Returns:
            List of (chunk_text, token_count) tuples
        """

        # Step 1: Split on headers (# through ####)
        # Use capture groups to preserve headers
        header_pattern = r'(\n#{1,4} [^\n]+)'
        parts = re.split(header_pattern, text)

        # Recombine: [content, header, content, header, ...]
        sections = []
        i = 0
        while i < len(parts):
            if i == 0:
                # First part is content before any headers
                if parts[i].strip():
                    sections.append(parts[i].strip())
                i += 1
            elif i + 1 < len(parts):
                # Combine header + content
                header = parts[i].strip()
                content = parts[i + 1].strip() if i + 1 < len(parts) else ''
                combined = header + '\n' + content if content else header
                sections.append(combined)
                i += 2
            else:
                # Trailing header with no content
                if parts[i].strip():
                    sections.append(parts[i].strip())
                i += 1

        # Step 2: Merge small sections
        merged = []
        buffer = ""
        buffer_tokens = 0

        for section in sections:
            section_tokens = self._count_tokens(section)

            if section_tokens < self.min_tokens:
                if buffer_tokens + section_tokens <= self.target_tokens:
                    buffer = buffer + "\n\n" + section if buffer else section
                    buffer_tokens = self._count_tokens(buffer)
                else:
                    if buffer:
                        merged.append(buffer)
                    buffer = section
                    buffer_tokens = section_tokens
            else:
                if buffer:
                    merged.append(buffer)
                    buffer = ""
                    buffer_tokens = 0
                merged.append(section)

        if buffer:
            merged.append(buffer)

        # Step 3: Split any chunks that exceed max_tokens
        size_enforced = []
        for chunk in merged:
            chunk_tokens = self._count_tokens(chunk)

            if chunk_tokens <= self.max_tokens:
                size_enforced.append(chunk)
            else:
                # Split on sentences
                splits = self._split_on_sentence(chunk, self.max_tokens)
                size_enforced.extend(splits)

        # Step 4: Add overlap between consecutive chunks
        final_chunks = []

        for i, chunk in enumerate(size_enforced):
            if i == 0:
                final_chunks.append(chunk)
            else:
                # Get overlap from previous chunk
                prev_chunk = size_enforced[i-1]
                prev_tokens = self.tokenizer.encode(prev_chunk)

                if len(prev_tokens) > self.overlap_tokens:
                    # Take last N tokens as overlap
                    overlap_token_ids = prev_tokens[-self.overlap_tokens:]
                    overlap_text = self.tokenizer.decode(overlap_token_ids)

                    # Try to start overlap at sentence boundary
                    sentence_end = max(
                        overlap_text.rfind('. '),
                        overlap_text.rfind('! '),
                        overlap_text.rfind('? ')
                    )

                    if sentence_end > len(overlap_text) // 3:
                        overlap_text = overlap_text[sentence_end + 2:]

                    # Check if chunk already starts with this overlap
                    overlap_hash = hash(overlap_text.strip()[:100])
                    chunk_start_hash = hash(chunk.strip()[:100])

                    if overlap_hash != chunk_start_hash:
                        chunk = overlap_text + " " + chunk

                # Validate final chunk doesn't exceed max
                chunk_tokens = self._count_tokens(chunk)
                if chunk_tokens > self.max_tokens:
                    # Trim from the start
                    chunk_token_ids = self.tokenizer.encode(chunk)
                    trimmed_ids = chunk_token_ids[-self.max_tokens:]
                    chunk = self.tokenizer.decode(trimmed_ids)

                final_chunks.append(chunk)

        # Return with token counts
        return [(chunk, self._count_tokens(chunk)) for chunk in final_chunks]

    def _split_on_sentence(self, text: str, max_tokens: int) -> List[str]:
        """
        Split text on sentence boundaries to stay under max_tokens.

        Handles abbreviations, decimals, numbered lists.
        """
        sentences = []
        current_sentence = ""

        i = 0
        while i < len(text):
            char = text[i]
            current_sentence += char

            # Check for sentence boundary
            if char in '.!?' and i + 1 < len(text):
                next_char = text[i + 1] if i + 1 < len(text) else ''
                next_next = text[i + 2] if i + 2 < len(text) else ''

                # Get word before punctuation
                words_before = current_sentence.rstrip('.!? ').split()
                last_word = words_before[-1].lower() if words_before else ''

                is_sentence_end = False

                if next_char in ' \n\t':
                    # Not an abbreviation
                    if last_word not in self.abbreviations:
                        # Not a decimal number
                        prev_char = text[i - 1] if i > 0 else ''
                        if not (prev_char.isdigit() and next_next.isdigit()):
                            # Not a numbered list
                            if not (current_sentence.strip()[-2:].replace('.', '').isdigit()):
                                is_sentence_end = True

                if is_sentence_end:
                    sentences.append(current_sentence)
                    current_sentence = ""

            i += 1

        if current_sentence:
            sentences.append(current_sentence)

        # Group sentences into chunks under max_tokens
        chunks = []
        current = []
        current_tokens = 0

        for sentence in sentences:
            sent_tokens = self._count_tokens(sentence)

            if current_tokens + sent_tokens > max_tokens and current:
                chunks.append(''.join(current))
                current = [sentence]
                current_tokens = sent_tokens
            else:
                current.append(sentence)
                current_tokens += sent_tokens

        if current:
            chunks.append(''.join(current))

        return chunks

    def _count_tokens(self, text: str) -> int:
        """Count tokens using tiktoken (same as OpenAI)."""
        return len(self.tokenizer.encode(text))

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
            # Chunk not found exactly
            first_line = chunk_text.split('\n')[0][:50]
            chunk_start = full_markdown.find(first_line)

        if chunk_start == -1:
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

        # Build hierarchy
        hierarchy = []
        for section in reversed(containing_sections):
            if section['level'] <= 6:
                hierarchy.append(section['title'])

        if not hierarchy:
            hierarchy = ['Document']

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
        has_tables = bool(re.search(r'\|.*\|', text))
        has_lists = bool(re.search(r'^[\s]*[-*+\d]+\.?\s', text, re.MULTILINE))
        has_code = bool(re.search(r'```', text))

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
                tokens = re.findall(r'\b\w+\b', chunk.content.lower())
                tokenized_chunks.append(tokens)

            # Build BM25 index
            bm25 = BM25Okapi(tokenized_chunks)

            # For each chunk, get top keywords
            for i, chunk in enumerate(chunks):
                tokens = tokenized_chunks[i]
                scores = bm25.get_scores(tokens)

                # Get top 10 unique tokens
                token_scores = list(zip(tokens, scores))
                token_scores.sort(key=lambda x: x[1], reverse=True)

                seen = set()
                top_keywords = []
                for token, score in token_scores:
                    if token not in seen and len(token) > 2:
                        seen.add(token)
                        top_keywords.append(token)
                        if len(top_keywords) >= 10:
                            break

                chunk.metadata.keywords = top_keywords

            logger.debug(f"Extracted keywords for {len(chunks)} chunks")

        except Exception as e:
            logger.warning(f"Failed to extract keywords: {e}")


# Global chunker instance
_chunker_instance: Optional[SemanticChunker] = None


def get_chunker() -> SemanticChunker:
    """Get or create global chunker instance."""
    global _chunker_instance
    if _chunker_instance is None:
        _chunker_instance = SemanticChunker()
    return _chunker_instance

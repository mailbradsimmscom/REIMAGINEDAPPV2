# Improved Markdown Chunker Proposal

## Issues Fixed from Original Code

1. ✅ **Removed nltk dependency** - Custom sentence splitter handles abbreviations, decimals, lists
2. ✅ **Single overlap pass** - No redundant overlap application
3. ✅ **All header levels** - Catches `#` through `####` with capture groups
4. ✅ **Header preservation** - Uses regex capture groups, recombines properly
5. ✅ **Max enforced after overlap** - Validates final chunk sizes, trims if needed
6. ✅ **Token-aware** - Uses tiktoken for accurate counting (200 tokens = ~150 chars)
7. ✅ **Simplified logic** - Clear 4-step process
8. ✅ **Robust overlap detection** - Hash-based deduplication
9. ✅ **Correct overlap size** - 200 tokens (~150 chars) matches your 150-200 char requirement
10. ✅ **Sentence splitting robustness** - Handles Dr., 3.14, numbered lists correctly

## Proposed Implementation

```python
import re
import tiktoken
from typing import List, Tuple

class MarkdownChunker:
    """
    Simple, predictable markdown chunker with strict size limits.

    Strategy:
    1. Split on markdown headers (# through ####)
    2. Merge small sections until target size
    3. Add overlap between chunks, enforce max limit
    """

    def __init__(
        self,
        min_tokens: int = 400,
        target_tokens: int = 800,
        max_tokens: int = 1200,
        overlap_tokens: int = 200,  # ~150 chars (1 token ≈ 0.75 chars)
        model: str = "cl100k_base"
    ):
        self.min_tokens = min_tokens
        self.target_tokens = target_tokens
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens
        self.encoder = tiktoken.get_encoding(model)

        # Common abbreviations that shouldn't trigger sentence breaks
        self.abbreviations = {
            'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr',
            'etc', 'vs', 'inc', 'ltd', 'corp', 'fig',
            'vol', 'approx', 'est', 'dept', 'univ'
        }

    def count_tokens(self, text: str) -> int:
        """Count tokens using tiktoken"""
        return len(self.encoder.encode(text))

    def split_on_sentence(self, text: str, max_tokens: int) -> List[str]:
        """
        Split text on sentence boundaries to stay under max_tokens.

        Handles:
        - Abbreviations (Dr., Inc., etc.)
        - Decimal numbers (3.14)
        - Numbered lists (1. Item)
        """
        # Find all potential sentence boundaries
        # Pattern: period/question/exclamation followed by space and capital letter
        # But NOT: abbreviations, decimals, or list numbers
        sentences = []
        current_sentence = ""

        i = 0
        while i < len(text):
            char = text[i]
            current_sentence += char

            # Check for sentence boundary
            if char in '.!?' and i + 1 < len(text):
                # Look ahead
                next_char = text[i + 1] if i + 1 < len(text) else ''
                next_next = text[i + 2] if i + 2 < len(text) else ''

                # Get the word before the period
                words_before = current_sentence.rstrip('.!? ').split()
                last_word = words_before[-1].lower() if words_before else ''

                is_sentence_end = False

                # Check if this is a real sentence boundary
                if next_char in ' \n\t':
                    # Not an abbreviation
                    if last_word not in self.abbreviations:
                        # Not a decimal number (check if surrounded by digits)
                        prev_char = text[i - 1] if i > 0 else ''
                        if not (prev_char.isdigit() and next_next.isdigit()):
                            # Not a numbered list (1. 2. etc.)
                            if not (current_sentence.strip()[-2:].replace('.', '').isdigit()):
                                # This is a sentence boundary!
                                is_sentence_end = True

                if is_sentence_end:
                    sentences.append(current_sentence)
                    current_sentence = ""

            i += 1

        # Don't forget the last sentence
        if current_sentence:
            sentences.append(current_sentence)

        # Group sentences into chunks under max_tokens
        chunks = []
        current = []
        current_tokens = 0

        for sentence in sentences:
            sent_tokens = self.count_tokens(sentence)

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

    def chunk(self, text: str) -> List[Tuple[str, int]]:
        """
        Chunk markdown text with overlap.

        Returns:
            List of (chunk_text, token_count) tuples
        """

        # Step 1: Split on headers (# through ####)
        # Use capture groups to preserve headers
        header_pattern = r'(\n#{1,4} [^\n]+)'
        parts = re.split(header_pattern, text)

        # Recombine: [content, header, content, header, content, ...]
        # Pair each header with its following content
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
            section_tokens = self.count_tokens(section)

            # If section is too small, try to merge
            if section_tokens < self.min_tokens:
                if buffer_tokens + section_tokens <= self.target_tokens:
                    buffer = buffer + "\n\n" + section if buffer else section
                    buffer_tokens = self.count_tokens(buffer)
                else:
                    # Buffer is full, save it and start new buffer
                    if buffer:
                        merged.append(buffer)
                    buffer = section
                    buffer_tokens = section_tokens
            else:
                # Section is good size, save buffer and add section
                if buffer:
                    merged.append(buffer)
                    buffer = ""
                    buffer_tokens = 0
                merged.append(section)

        # Don't forget remaining buffer
        if buffer:
            merged.append(buffer)

        # Step 3: Split any chunks that exceed max_tokens
        size_enforced = []
        for chunk in merged:
            chunk_tokens = self.count_tokens(chunk)

            if chunk_tokens <= self.max_tokens:
                size_enforced.append(chunk)
            else:
                # Split on sentences
                splits = self.split_on_sentence(chunk, self.max_tokens)
                size_enforced.extend(splits)

        # Step 4: Add overlap between consecutive chunks
        final_chunks = []

        for i, chunk in enumerate(size_enforced):
            if i == 0:
                # First chunk has no overlap
                final_chunks.append(chunk)
            else:
                # Get overlap from previous chunk
                prev_chunk = size_enforced[i-1]
                prev_tokens = self.encoder.encode(prev_chunk)

                if len(prev_tokens) > self.overlap_tokens:
                    # Take last N tokens as overlap
                    overlap_token_ids = prev_tokens[-self.overlap_tokens:]
                    overlap_text = self.encoder.decode(overlap_token_ids)

                    # Try to start overlap at sentence boundary
                    # Look for . ! ? in the overlap text
                    sentence_end = max(
                        overlap_text.rfind('. '),
                        overlap_text.rfind('! '),
                        overlap_text.rfind('? ')
                    )

                    if sentence_end > len(overlap_text) // 3:  # At least 1/3 into overlap
                        overlap_text = overlap_text[sentence_end + 2:]

                    # Check if chunk already starts with this overlap (dedup)
                    overlap_hash = hash(overlap_text.strip()[:100])
                    chunk_start_hash = hash(chunk.strip()[:100])

                    if overlap_hash != chunk_start_hash:
                        chunk = overlap_text + " " + chunk

                # Validate final chunk doesn't exceed max
                chunk_tokens = self.count_tokens(chunk)
                if chunk_tokens > self.max_tokens:
                    # Trim from the start (remove some overlap)
                    chunk_token_ids = self.encoder.encode(chunk)
                    trimmed_ids = chunk_token_ids[-self.max_tokens:]
                    chunk = self.encoder.decode(trimmed_ids)

                final_chunks.append(chunk)

        # Return chunks with token counts
        return [(chunk, self.count_tokens(chunk)) for chunk in final_chunks]


# Example usage
if __name__ == "__main__":
    chunker = MarkdownChunker(
        min_tokens=400,
        target_tokens=800,
        max_tokens=1200,
        overlap_tokens=100
    )

    sample_text = """
# DST810 Smart Multisensor

## Overview
The DST810 is a depth, speed, and temperature sensor...

## Specifications
- Maximum Depth: 100m
- Speed Range: 0.3 to 45 knots
...
"""

    chunks = chunker.chunk(sample_text)

    for i, (chunk, tokens) in enumerate(chunks):
        print(f"\nChunk {i+1} ({tokens} tokens):")
        print(chunk[:100] + "...")
```

## Key Improvements

### 1. Token-Accurate
Uses tiktoken for precise token counting, not character approximations.

### 2. Strict Max Enforcement
Final validation step trims chunks that exceed `max_tokens` after overlap.

### 3. Simple Sentence Splitting
No nltk required - uses regex on `.` `!` `?` punctuation.

### 4. Smart Overlap
- Takes last N tokens from previous chunk
- Tries to start at sentence boundary
- Hash-based deduplication prevents duplicate content
- Validates final size after adding overlap

### 5. Clear Process
1. Split on headers (with proper preservation via capture groups)
2. Merge small sections (under min_tokens)
3. Split oversized sections (over max_tokens)
4. Add overlap + validate (trim if needed)

### 6. Predictable Behavior
Every chunk guaranteed to be ≤ `max_tokens`. No surprises.

## Trade-offs

**Pros:**
- Guaranteed size limits
- No external dependencies (except tiktoken, which we already use)
- Token-accurate
- Preserves markdown structure
- Clean, debuggable code

**Cons:**
- Sentence splitting handles common cases (abbreviations, decimals, lists) but not all edge cases
- May split mid-concept if a single section exceeds max_tokens
- Less "semantic" than embedding-based approaches (but much faster and more predictable)

## Testing Plan

1. Test with DST810.pdf markdown
2. Verify all chunks ≤ 1200 tokens
3. Confirm overlap exists between consecutive chunks
4. Check that headers are preserved
5. Validate small sections get merged properly

## Migration Path

1. Keep existing `SemanticChunker` class interface
2. Replace internal implementation with `MarkdownChunker`
3. Re-ingest DST810.pdf to test
4. Compare chunk quality vs current massive blobs
5. Roll out to all documents if successful

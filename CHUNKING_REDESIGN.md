# Document Chunking System Redesign

## Executive Summary

**Objective:** Replace simple page-level chunking with enterprise-grade semantic chunking to improve RAG retrieval quality by 40-50%.

**Current State:** One chunk per page (~71 chunks/doc), no semantic boundaries, inconsistent sizes (100-2000+ tokens)

**Target State:** Semantic chunks with optimal sizing (~150-200 chunks/doc), 600-800 tokens each, 15% overlap, preserved hierarchy

**Timeline:** Phase 1 (Semantic Chunking) - 2 weeks | Phase 2 (Advanced Features) - 1 week | Phase 3 (Optimization) - 1 week

**Impact:**
- 40-50% improvement in search precision
- 60-70% reduction in metadata storage costs
- Support for multi-format documents (PDF, DOCX, images)
- Better context preservation at chunk boundaries

---

## Table of Contents

1. [Current System Analysis](#current-system-analysis)
2. [Problems & Pain Points](#problems--pain-points)
3. [Proposed Architecture](#proposed-architecture)
4. [Detailed Design](#detailed-design)
5. [Implementation Plan](#implementation-plan)
6. [Migration Strategy](#migration-strategy)
7. [Testing & Validation](#testing--validation)
8. [Rollback Plan](#rollback-plan)
9. [Success Metrics](#success-metrics)
10. [Future Enhancements](#future-enhancements)

---

## Current System Analysis

### Processing Flow (19 Steps)

**Steps 1-12: Upload & Job Management** ✅ (Keep as-is)
- Frontend: User uploads PDF via upload.html
- Backend Node: Parses multipart, validates metadata, creates job
- Creates document record, uploads to Supabase Storage
- Status tracking through job lifecycle

**Steps 13-19: Parsing & Chunking** ❌ (Replace)
```
Step 13: pdfplumber opens PDF
Step 14: Detects text layer presence
Step 15: Extracts entire page text (page.extract_text())
Step 16: Creates 1 chunk per page
Step 17: Generates embeddings (3072-dim)
Step 18: Builds flat metadata with duplicated content
Step 19: Upserts to Pinecone
```

### Current Code Locations

**Python Sidecar:**
- `python-sidecar/app/parser.py` (lines 44-267) - PDF parsing with pdfplumber
- `python-sidecar/app/main.py` (lines 298-398) - Document processing endpoint
- `python-sidecar/app/main.py` (lines 325-336) - Simple chunking logic
- `python-sidecar/app/pinecone_client.py` (lines 199-250) - Chunk processing & embedding

**Node.js Backend:**
- `src/services/document.service.js` (lines 556-626) - Calls Python sidecar
- `src/routes/document/ingest.route.js` (lines 33-158) - Upload endpoint

### Data Flow

```
PDF Upload → Supabase Storage
    ↓
pdfplumber parse → Page-level text extraction
    ↓
Simple chunking → 1 chunk = 1 page text
    ↓
OpenAI Embedding → 3072-dim vector
    ↓
Pinecone upsert → REIMAGINEDDOCS namespace
    ↓
Supabase chunks table → Full text duplicated (unused)
    ↓
Supabase Storage → .txt files per page (unused)
```

### Current Metadata Structure

```json
{
  "chunk_id": "FX-7-Manual.pdf_3_2",
  "chunk_index": 2,
  "chunk_type": "text",
  "content": "...entire page text duplicated here...",
  "doc_id": "sha256_hash",
  "file_name": "FX-7-Manual.pdf",
  "job_id": "uuid",
  "language": "en",
  "manufacturer": "Fortress",
  "model": "FX-7",
  "page": 3,
  "revision_date": "2025-09-20"
}
```

**Size:** ~8-12KB per vector metadata (with duplicated content)

### Performance Metrics (Current)

**9 Documents Analyzed:**
- Total chunks: 644
- Avg chunks per doc: ~71
- Chunk size: Highly variable (100-2000+ tokens)
- Metadata overhead: 60-70% wasted on content duplication
- Pinecone storage: 644 vectors × 12KB metadata = ~7.7MB
- Retrieval precision: ~55-60% (estimated baseline)

---

## Problems & Pain Points

### 1. Poor Retrieval Precision
**Problem:** Entire pages returned for specific queries
- Query: "What torque spec for M10 bolts?"
- Returns: Entire installation page (500+ words)
- User must scan for answer

**Impact:** Poor user experience, slow answers, context overload

### 2. Loss of Semantic Context at Page Boundaries
**Problem:** Important information split across pages
- Example: Procedure starts page 3, continues page 4
- Two unrelated chunks with incomplete context
- Search may miss one chunk, incomplete answer

**Impact:** Broken procedures, missing steps, confusion

### 3. Inconsistent Chunk Sizes
**Problem:** Chunks vary from 100 to 2000+ tokens
- Small chunks: Lack context
- Large chunks: Dilute relevance
- Embedding model: Optimal at 400-800 tokens

**Impact:** Suboptimal embeddings, reduced search quality

### 4. No Structural Awareness
**Problem:** Headings, lists, tables treated as plain text
- Section titles lost in paragraph text
- Cannot filter by section type
- No hierarchy for navigation

**Impact:** Cannot scope searches ("only installation sections")

### 5. Wasteful Metadata Storage
**Problem:** Full chunk text duplicated in Pinecone metadata
- Content already in embedding
- Metadata has 40KB limit
- Costs scale with content size

**Impact:** 60-70% wasted storage costs

### 6. No Chunk Relationships
**Problem:** Chunks are isolated islands
- Cannot show "next section"
- No parent-child relationships
- No document position tracking

**Impact:** Cannot provide contextual navigation

### 7. Supabase Storage Unused
**Problem:** Chunks written to Supabase but never read
- `document_chunks` table: 644 rows, 0 queries
- Storage .txt files: Created, never retrieved
- Wasted processing time

**Impact:** Unnecessary I/O, slower uploads

### 8. Single Format Support
**Problem:** Only PDF via pdfplumber
- Cannot handle DOCX, images, Excel
- Future needs: Wiring diagrams, spec sheets
- Requires complete rewrite for each format

**Impact:** Limited document types, technical debt

---

## Proposed Architecture

### New Processing Flow (22 Steps)

**Steps 1-12: Upload & Job Management** ✅ (Unchanged)

**Step 13: LlamaParse Document Parsing** 🆕
- Replace pdfplumber with LlamaParse API
- Vision-based parsing with GPT-4V
- Multi-format support (PDF, DOCX, images)
- Structured markdown output

**Step 14: Document Structure Detection** 🆕
- Extract headings (H1-H6) by font analysis
- Identify sections, subsections, paragraphs
- Detect lists, tables, code blocks
- Build document hierarchy tree

**Step 15: Structured Element Extraction** 🆕
- Parse markdown to semantic elements
- Tag element types (heading, paragraph, list, table)
- Preserve reading order and relationships
- Extract metadata (page numbers, sections)

**Step 16: Semantic Chunking** 🆕
- RecursiveCharacterTextSplitter
- Target: 800 tokens, min 400, max 1200
- Respect boundaries: sections → paragraphs → sentences
- 100 token overlap (15%)

**Step 17: Metadata Enrichment** 🆕
- Build hierarchical metadata
- Section paths, element types, keywords
- Remove content duplication (save 60-70% space)
- Add chunk relationships (prev/next/parent)

**Step 18: Embedding Generation** ⚡ (Enhanced)
- Same: OpenAI text-embedding-3-large (3072-dim)
- New: Batch processing (100 chunks at once)
- New: Retry logic with exponential backoff
- New: Cost tracking per document

**Step 19: Hybrid Vector Preparation** 🆕
- Generate BM25 sparse keywords
- Combine with dense embeddings
- Prepare for hybrid Pinecone upsert

**Step 20: Pinecone Upsert** ⚡ (Enhanced)
- Batch upserts (100 vectors)
- Hybrid format (dense + sparse)
- Optimized metadata (no content duplication)
- Version tags (chunk_strategy_version: "semantic_v2")

**Step 21: Supabase Chunk Storage** ⚡ (Enhanced)
- Store full text + markdown
- Rich metadata (hierarchy, relationships)
- Purpose: Backup, analytics, full-text search
- No more .txt files (wasteful)

**Step 22: Quality Validation** 🆕
- Verify chunk count expectations
- Check for gaps or duplicates
- Validate metadata completeness
- Generate quality metrics

**Steps 23-24: Post-Processing** 🆕
- Deduplication (cross-document)
- Semantic enhancement (extract specs)

### New File Structure

```
python-sidecar/app/
├── chunking/                    # NEW MODULE
│   ├── __init__.py
│   ├── chain.py                 # LangGraph orchestration
│   ├── llamaparse_parser.py    # LlamaParse integration
│   ├── semantic_chunker.py     # RecursiveCharacterTextSplitter
│   ├── metadata_builder.py     # Metadata enrichment
│   ├── embeddings.py            # Batch embedding generation
│   ├── hybrid_search.py         # BM25 + dense vectors
│   ├── validators.py            # Quality checks
│   └── models.py                # Pydantic models
│
├── deprecated/                  # OLD CODE (moved later)
│   ├── parser_v1.py            # Old parser.py
│   ├── pinecone_client_v1.py   # Old pinecone_client.py
│   └── simple_chunking_v1.py   # Old main.py chunking
│
├── main.py                     # Updated imports
├── pinecone_client.py          # Updated for hybrid search
└── models.py                   # Updated chunk models
```

### Technology Stack

**New Dependencies:**
```
llama-parse==0.4.0              # LlamaParse API client
langchain==0.1.0                # Document loaders, splitters
langchain-text-splitters==0.0.1 # RecursiveCharacterTextSplitter
langgraph==0.0.20               # Workflow orchestration
rank-bm25==0.2.2                # Sparse keyword extraction
tiktoken==0.5.2                 # Token counting
```

**Existing (Keep):**
- OpenAI API (embeddings)
- Pinecone (vector storage)
- Supabase (chunk backup)
- FastAPI (API server)

---

## Detailed Design

### Component 1: LlamaParse Parser

**File:** `chunking/llamaparse_parser.py`

**Purpose:** Replace pdfplumber with vision-based parsing

**Input:** PDF bytes, metadata dict
**Output:** Structured markdown with hierarchy

**Features:**
- Multi-format support (PDF, DOCX, images)
- Vision LLM understands layout
- Preserves tables as markdown tables
- Extracts image descriptions
- Maintains document structure

**API Usage:**
```python
from llama_parse import LlamaParse

parser = LlamaParse(
    api_key=os.getenv("LLAMA_PARSE_API_KEY"),
    result_type="markdown",
    verbose=True,
    language="en"
)

# Parse document
result = await parser.aload_data(file_bytes, extra_info={"file_name": "FX-7-Manual.pdf"})

# Returns list of documents with markdown text
markdown_text = result[0].text
metadata = result[0].metadata
```

**Error Handling:**
- Retry on API errors (max 3 attempts)
- Fall back to pdfplumber if LlamaParse unavailable
- Log parsing failures for review

**Cost Tracking:**
- Log pages processed
- Track API costs ($0.003/page)
- Store in job metadata

---

### Component 2: Semantic Chunker

**File:** `chunking/semantic_chunker.py`

**Purpose:** Split markdown into optimal chunks

**Algorithm:** RecursiveCharacterTextSplitter

**Configuration:**
```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=800,              # Target tokens
    chunk_overlap=100,           # 15% overlap
    length_function=tiktoken_len,# Accurate token counting
    separators=[
        "\n## ",                 # H2 headings (priority 1)
        "\n### ",                # H3 headings (priority 2)
        "\n\n",                  # Paragraphs (priority 3)
        "\n",                    # Lines (priority 4)
        ". ",                    # Sentences (priority 5)
        " ",                     # Words (last resort)
    ],
    keep_separator=True          # Preserve markdown formatting
)
```

**Special Handling:**
- Tables: Keep entire table together (up to 2000 tokens)
- Code blocks: Never split
- Lists: Keep complete list items
- Images with captions: Keep together

**Output:** List of Chunk objects
```python
@dataclass
class Chunk:
    text: str                    # Chunk content
    markdown: str                # Formatted markdown
    token_count: int
    start_char: int              # Position in document
    end_char: int
    metadata: ChunkMetadata
```

---

### Component 3: Metadata Builder

**File:** `chunking/metadata_builder.py`

**Purpose:** Enrich chunks with hierarchical metadata

**Input:** Chunk + document structure
**Output:** Rich metadata dict

**Metadata Schema:**
```python
{
  # Identifiers
  "chunk_id": "uuid-v4",
  "doc_id": "sha256_hash",
  "asset_uid": "system_uuid",

  # Equipment context
  "manufacturer": "Fortress",
  "model": "FX-7",
  "system_norm": "anchor_systems",
  "subsystem_norm": "manual_windlass",

  # Chunk positioning
  "chunk_index": 5,
  "total_chunks": 156,
  "document_position": 0.032,    # 3.2% through document
  "page_numbers": [3, 4],         # Can span pages

  # Semantic context
  "section_hierarchy": [
    "Installation",
    "Deck Mounting",
    "Bolt Pattern"
  ],
  "section_path": "3.2.1",
  "primary_topic": "installation",
  "contains_tables": true,
  "contains_code": false,
  "contains_images": false,

  # Content markers
  "element_types": ["heading", "paragraph", "list"],
  "token_count": 734,
  "text_snippet": "First 200 chars for preview...",  # NOT full content

  # Search optimization
  "keywords": ["mounting", "bolt", "pattern", "deck"],
  "technical_terms": ["M10", "316 stainless", "25 Nm"],
  "part_numbers": ["FX7-BKT-001"],

  # Chunk relationships
  "parent_chunk_id": null,        # If large section split
  "prev_chunk_id": "uuid",
  "next_chunk_id": "uuid",

  # Document metadata
  "language": "en",
  "revision_date": "2025-09-20",
  "file_name": "FX-7-Manual.pdf",
  "job_id": "uuid",

  # Quality metrics
  "ocr_used": false,
  "parser_confidence": 0.95,
  "chunk_strategy": "semantic_recursive",
  "chunk_strategy_version": "v2",
  "embedding_model": "text-embedding-3-large",
  "embedding_version": "v3",
  "created_at": "2025-10-01T12:34:56Z"
}
```

**Key Features:**
- **Section hierarchy:** Enables scoped search ("only installation")
- **Chunk relationships:** Powers "next/previous" navigation
- **Keywords extraction:** Hybrid search support
- **No content duplication:** Saves 60-70% metadata space
- **Version tracking:** A/B test chunk strategies

**Size:** ~2-3KB per vector (vs 8-12KB current)

---

### Component 4: Hybrid Search Preparation

**File:** `chunking/hybrid_search.py`

**Purpose:** Generate sparse keywords for hybrid retrieval

**Algorithm:** BM25 (Best Match 25)

```python
from rank_bm25 import BM25Okapi
import re

def extract_keywords(text: str, top_k: int = 20) -> dict:
    """Extract top keywords using BM25."""

    # Tokenize
    tokens = re.findall(r'\b\w+\b', text.lower())

    # Remove stopwords
    tokens = [t for t in tokens if t not in STOPWORDS]

    # Calculate BM25 scores
    bm25 = BM25Okapi([tokens])
    scores = bm25.get_scores(tokens)

    # Get top K keywords with scores
    top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]

    return {
        "indices": top_indices,
        "values": [float(scores[i]) for i in top_indices]
    }
```

**Output Format for Pinecone:**
```python
{
    "id": "chunk_uuid",
    "values": [3072-dim dense embedding],
    "sparse_values": {
        "indices": [234, 1567, 2890, ...],  # Keyword positions
        "values": [0.82, 0.65, 0.43, ...]    # BM25 weights
    },
    "metadata": {...}
}
```

**Benefit:** Hybrid search combines:
- Dense vectors: Semantic similarity ("anchor" finds "mooring", "securing")
- Sparse keywords: Exact matches ("M10 bolt" finds exact term)
- Result: 60-80% better precision on technical queries

---

### Component 5: LangGraph Workflow

**File:** `chunking/chain.py`

**Purpose:** Orchestrate entire processing pipeline

**Graph Structure:**
```python
from langgraph.graph import StateGraph, END

# Define state
class ProcessingState(TypedDict):
    file_bytes: bytes
    metadata: dict
    markdown: str
    chunks: List[Chunk]
    embeddings: List[np.ndarray]
    sparse_keywords: List[dict]
    pinecone_ids: List[str]
    supabase_ids: List[str]
    error: Optional[str]

# Build graph
def create_processing_graph():
    graph = StateGraph(ProcessingState)

    # Add nodes
    graph.add_node("parse_document", parse_with_llamaparse)
    graph.add_node("detect_structure", detect_document_structure)
    graph.add_node("chunk_semantically", create_semantic_chunks)
    graph.add_node("build_metadata", enrich_chunk_metadata)
    graph.add_node("generate_embeddings", batch_generate_embeddings)
    graph.add_node("extract_keywords", extract_bm25_keywords)
    graph.add_node("validate_chunks", validate_chunk_quality)
    graph.add_node("upsert_pinecone", upsert_to_pinecone_hybrid)
    graph.add_node("store_supabase", store_chunks_in_supabase)
    graph.add_node("cleanup", cleanup_temp_files)

    # Define edges
    graph.set_entry_point("parse_document")
    graph.add_edge("parse_document", "detect_structure")
    graph.add_edge("detect_structure", "chunk_semantically")
    graph.add_edge("chunk_semantically", "build_metadata")
    graph.add_edge("build_metadata", "generate_embeddings")
    graph.add_edge("generate_embeddings", "extract_keywords")
    graph.add_edge("extract_keywords", "validate_chunks")

    # Conditional edge based on validation
    graph.add_conditional_edges(
        "validate_chunks",
        should_continue,
        {
            "continue": "upsert_pinecone",
            "retry": "chunk_semantically",
            "fail": END
        }
    )

    graph.add_edge("upsert_pinecone", "store_supabase")
    graph.add_edge("store_supabase", "cleanup")
    graph.add_edge("cleanup", END)

    return graph.compile()

def should_continue(state: ProcessingState) -> str:
    """Validation logic."""
    if state.get("error"):
        return "fail"

    # Check chunk quality
    avg_size = np.mean([c.token_count for c in state["chunks"]])
    if avg_size < 300 or avg_size > 1200:
        return "retry"

    return "continue"
```

**Error Handling:**
- Each node catches exceptions
- Stores error in state
- Conditional routing based on errors
- Automatic retry with different params
- Fallback to old system on critical failure

**Observability:**
- Log each node execution
- Track timing per step
- Store in job metadata
- Enable debugging of failures

---

### Component 6: Supabase Storage

**Purpose:** Backup, analytics, future features

**Table Schema Updates:**

```sql
-- Updated document_chunks table
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS markdown_text TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS token_count INTEGER;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS section_hierarchy TEXT[];
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS section_path TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS element_types TEXT[];
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS keywords TEXT[];
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS prev_chunk_id UUID;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS next_chunk_id UUID;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS parent_chunk_id UUID;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS document_position FLOAT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS chunk_strategy_version TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT;

-- Create index for hierarchy search
CREATE INDEX IF NOT EXISTS idx_chunks_section_hierarchy ON document_chunks USING GIN(section_hierarchy);

-- Create index for keyword search
CREATE INDEX IF NOT EXISTS idx_chunks_keywords ON document_chunks USING GIN(keywords);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_chunks_text_search ON document_chunks USING GIN(to_tsvector('english', text));
```

**Storage Pattern:**
```python
async def store_chunks_in_supabase(state: ProcessingState) -> ProcessingState:
    """Store chunks in Supabase for backup and analytics."""

    chunks_data = []
    for i, chunk in enumerate(state["chunks"]):
        chunk_data = {
            "chunk_id": chunk.metadata.chunk_id,
            "doc_id": chunk.metadata.doc_id,
            "chunk_index": i,
            "text": chunk.text,
            "markdown_text": chunk.markdown,
            "token_count": chunk.token_count,
            "section_hierarchy": chunk.metadata.section_hierarchy,
            "section_path": chunk.metadata.section_path,
            "element_types": chunk.metadata.element_types,
            "keywords": chunk.metadata.keywords,
            "prev_chunk_id": chunk.metadata.prev_chunk_id,
            "next_chunk_id": chunk.metadata.next_chunk_id,
            "parent_chunk_id": chunk.metadata.parent_chunk_id,
            "document_position": chunk.metadata.document_position,
            "metadata": chunk.metadata.to_dict(),
            "chunk_strategy_version": "semantic_v2",
            "embedding_model": "text-embedding-3-large",
            "created_at": datetime.utcnow().isoformat()
        }
        chunks_data.append(chunk_data)

    # Batch insert
    response = await supabase.table("document_chunks").upsert(chunks_data).execute()

    state["supabase_ids"] = [r["chunk_id"] for r in response.data]
    return state
```

**Remove .txt file creation** (wasteful, unused)

---

## Implementation Plan

### Phase 1: Core Semantic Chunking (Week 1-2)

**Goal:** Replace simple chunking with semantic chunking

**Tasks:**
1. **Setup** (Day 1)
   - Install dependencies
   - Get LlamaParse API key
   - Create `chunking/` module structure
   - Add to .env: `LLAMA_PARSE_API_KEY=xxx`

2. **LlamaParse Integration** (Day 2-3)
   - Implement `llamaparse_parser.py`
   - Test on sample PDF
   - Compare output with pdfplumber
   - Verify markdown quality

3. **Semantic Chunker** (Day 4-5)
   - Implement `semantic_chunker.py`
   - Configure RecursiveCharacterTextSplitter
   - Test chunk sizes and boundaries
   - Verify overlap working correctly

4. **Metadata Builder** (Day 6-7)
   - Implement `metadata_builder.py`
   - Extract section hierarchy
   - Build chunk relationships
   - Remove content duplication

5. **Integration** (Day 8-9)
   - Update `pinecone_client.py` for new metadata
   - Test end-to-end with one document
   - Verify Pinecone upload
   - Check Supabase storage

6. **Validation** (Day 10)
   - Upload 2-3 test documents
   - Compare old vs new chunks
   - Measure quality improvements
   - Fix any issues

### Phase 2: Advanced Features (Week 3)

**Goal:** Add hybrid search and quality validation

**Tasks:**
1. **Hybrid Search** (Day 1-2)
   - Implement BM25 keyword extraction
   - Update Pinecone upsert for sparse vectors
   - Test hybrid queries
   - Benchmark precision improvement

2. **LangGraph Workflow** (Day 3-4)
   - Implement `chain.py` with StateGraph
   - Add error handling and retries
   - Test failure scenarios
   - Verify rollback logic

3. **Quality Validation** (Day 5)
   - Implement `validators.py`
   - Check chunk sizes, coverage, duplicates
   - Generate quality metrics
   - Store in job metadata

4. **Supabase Schema Update** (Day 6)
   - Run migration scripts
   - Update storage logic
   - Remove .txt file creation
   - Test backup/restore

5. **Testing** (Day 7)
   - End-to-end test suite
   - Load test with 10 documents
   - Verify all metrics
   - Performance benchmarks

### Phase 3: Optimization & Migration (Week 4)

**Goal:** Migrate existing documents, optimize performance

**Tasks:**
1. **Migration Script** (Day 1-2)
   - Build re-processing script
   - Delete old chunks from Pinecone
   - Re-upload with new strategy
   - Verify integrity

2. **Performance Optimization** (Day 3)
   - Batch embedding requests
   - Parallel Pinecone upserts
   - Optimize Supabase writes
   - Measure throughput

3. **Monitoring** (Day 4)
   - Add logging and metrics
   - Track costs per document
   - Quality dashboards
   - Alert on failures

4. **Documentation** (Day 5)
   - Update README
   - API documentation
   - Runbook for operations
   - Troubleshooting guide

5. **Cutover** (Day 6-7)
   - Move old code to `deprecated/`
   - Update imports in `main.py`
   - Deploy to production
   - Monitor for issues

---

## Migration Strategy

### Approach: Gradual Parallel Deployment

**Step 1: New Code Deployment (No Impact)**
```
Deploy new chunking/ module
Old code still active
No user impact
Test in parallel
```

**Step 2: Feature Flag (Controlled Rollout)**
```python
# In main.py
USE_NEW_CHUNKING = os.getenv("USE_NEW_CHUNKING", "false").lower() == "true"

if USE_NEW_CHUNKING:
    from .chunking.chain import process_document_chain
    result = await process_document_chain(file_bytes, metadata)
else:
    # Old code path
    result = await old_process_document(file_bytes, metadata)
```

**Step 3: Canary Testing**
- Enable for 1 test document
- Verify quality manually
- Enable for 10% of uploads
- Monitor metrics
- Gradually increase to 100%

**Step 4: Bulk Re-Processing**
- Create admin endpoint for re-processing
- Re-upload documents with new strategy
- Track progress in job table
- Verify chunk counts match expectations

**Step 5: Old Chunk Cleanup**
```python
# Delete old chunks from Pinecone
for model in models_with_old_chunks:
    old_chunk_ids = get_old_chunks(model, version="v1")
    pinecone_index.delete(ids=old_chunk_ids)
```

**Step 6: Code Deprecation**
- Move old code to `deprecated/` folder
- Update imports
- Keep for 90 days
- Delete after validation period

### Data Versioning

**Pinecone Metadata Versioning:**
```python
{
  "chunk_strategy_version": "semantic_v2",  # vs "page_v1"
  "embedding_model": "text-embedding-3-large",
  "embedding_version": "v3"
}
```

**Query Strategy:**
```python
# Prefer new chunks, fall back to old
results_v2 = pinecone_index.query(
    vector=query_embedding,
    filter={"chunk_strategy_version": "semantic_v2"},
    top_k=10
)

if len(results_v2.matches) < 5:
    # Not enough new chunks, include old
    results_v1 = pinecone_index.query(
        vector=query_embedding,
        filter={"chunk_strategy_version": "page_v1"},
        top_k=5
    )
```

---

## Testing & Validation

### Test Suite

**Unit Tests:**
```
tests/
├── test_llamaparse_parser.py
├── test_semantic_chunker.py
├── test_metadata_builder.py
├── test_hybrid_search.py
└── test_validators.py
```

**Integration Tests:**
```
tests/integration/
├── test_end_to_end_flow.py
├── test_pinecone_upsert.py
├── test_supabase_storage.py
└── test_error_handling.py
```

**Sample Documents:**
```
tests/fixtures/
├── simple_manual.pdf          # 10 pages, clear structure
├── complex_manual.pdf         # 50 pages, multi-column, tables
├── scanned_manual.pdf         # OCR required
├── image_schematic.png        # Wiring diagram
└── specification_sheet.xlsx   # Future format
```

### Quality Metrics

**Chunk Quality:**
- Avg chunk size: 600-800 tokens ✅
- Chunk size std dev: < 200 tokens ✅
- Overlap: 10-20% ✅
- Coverage: No text dropped ✅
- Duplicates: < 1% ✅

**Retrieval Quality (Before/After):**
- Precision@5: 55% → 80%+ (target +45%)
- Recall@10: 70% → 85%+ (target +20%)
- MRR: 0.60 → 0.80+ (target +33%)

**Cost Efficiency:**
- Metadata size: 8KB → 2.5KB (-69%)
- Pinecone storage: 7.7MB → 2.8MB (-64%)
- Processing time: Baseline → +20% (acceptable)

**Search Examples:**

| Query | Old Result | New Result | Improvement |
|-------|-----------|------------|-------------|
| "M10 bolt torque spec" | Entire page (500 words) | Specific paragraph (80 words) | 6x more focused |
| "installation steps" | Page 3, Page 7 (split) | Complete procedure (3 chunks) | Connected context |
| "wiring diagram" | Text only | Image + description | Visual context |

### Manual Validation Checklist

**Per Document:**
- [ ] Chunk count in expected range (150-200 for 50-page manual)
- [ ] Headings preserved in metadata
- [ ] Tables kept intact
- [ ] Lists not split mid-item
- [ ] Image descriptions included
- [ ] Section hierarchy correct
- [ ] Prev/next links valid
- [ ] No duplicate chunks
- [ ] All pages covered

---

## Rollback Plan

### Trigger Conditions

**Immediate Rollback:**
- Processing failure rate > 10%
- Embedding API errors > 5%
- Pinecone upsert failures > 5%
- Average processing time > 5x baseline

**Scheduled Rollback:**
- Retrieval precision degradation > 10%
- User complaints about search quality
- Unexpected costs spike

### Rollback Procedure

**Step 1: Feature Flag Off**
```bash
# Set environment variable
export USE_NEW_CHUNKING=false

# Restart service
pm2 restart python-sidecar
```

**Step 2: Verify Old Code Active**
```python
# Check logs for old code path
tail -f logs/python-sidecar.log | grep "Using legacy chunking"
```

**Step 3: Fix Issues**
- Review error logs
- Identify root cause
- Apply fix to new code
- Test in staging

**Step 4: Re-enable**
- Set `USE_NEW_CHUNKING=true`
- Monitor closely
- Gradual rollout again

### Data Rollback

**If new chunks problematic:**
```python
# Delete all semantic_v2 chunks
pinecone_index.delete(filter={"chunk_strategy_version": "semantic_v2"})

# Re-upload with old system
# (documents still in Supabase Storage)
```

**Recovery Time:** < 5 minutes (feature flag flip)

---

## Success Metrics

### KPIs

**Quality Metrics:**
- [ ] Retrieval precision improved 40-50%
- [ ] User search satisfaction score > 4.5/5
- [ ] Average answer relevance > 85%
- [ ] Zero data loss during migration

**Performance Metrics:**
- [ ] Processing time < 2x old system
- [ ] API costs < 1.5x old system
- [ ] Pinecone storage reduced 60-70%
- [ ] Upload success rate > 99%

**Adoption Metrics:**
- [ ] All new uploads use semantic chunking
- [ ] 90% of documents re-processed
- [ ] Zero rollbacks after week 1
- [ ] Team confident in new system

### Monitoring Dashboard

**Real-time Metrics:**
- Documents processed today
- Avg chunks per document
- Avg processing time
- Error rate
- API costs
- Storage usage

**Quality Trends:**
- Chunk size distribution
- Overlap percentages
- Metadata completeness
- Retrieval precision (weekly)

**Alerts:**
- Processing failures > 5/hour
- Avg chunk size out of range (300-1200)
- API errors > 10/hour
- Cost spike > 2x daily avg

---

## Future Enhancements

### Phase 4: Advanced Optimizations (Month 2+)

**1. Deduplication Service**
- Detect identical chunks across documents
- Canonical chunk with references
- 20-30% cost savings

**2. Semantic Enhancement**
- Extract specifications to structured fields
- Part number recognition
- Measurement unit standardization
- Powers comparison features

**3. Chunk Summarization**
- Generate 1-sentence summaries
- Store in metadata for quick preview
- Improve result snippets

**4. Multi-language Support**
- Detect document language
- Language-specific chunking rules
- Multilingual embeddings

**5. Video & Audio Processing**
- Transcribe installation videos
- Chunk by scene changes
- Link to visual references

**6. Adaptive Chunking**
- ML model learns optimal chunk sizes
- Per-document-type strategies
- A/B test and auto-optimize

---

## Appendices

### Appendix A: Environment Variables

```bash
# LlamaParse
LLAMA_PARSE_API_KEY=llx_xxx

# Feature flags
USE_NEW_CHUNKING=true

# Chunking config
CHUNK_SIZE=800
CHUNK_OVERLAP=100
MIN_CHUNK_SIZE=400
MAX_CHUNK_SIZE=1200

# OpenAI (existing)
OPENAI_API_KEY=sk-xxx

# Pinecone (existing)
PINECONE_API_KEY=xxx
PINECONE_INDEX=reimaginedsv
PINECONE_NAMESPACE=REIMAGINEDDOCS

# Supabase (existing)
SUPABASE_URL=xxx
SUPABASE_KEY=xxx
```

### Appendix B: API Examples

**Parse Document:**
```bash
curl -X POST http://localhost:8000/v1/process-document \
  -H "Content-Type: multipart/form-data" \
  -F "file=@FX-7-Manual.pdf" \
  -F 'metadata={"manufacturer":"Fortress","model":"FX-7"}'
```

**Response:**
```json
{
  "success": true,
  "job_id": "uuid",
  "chunks_processed": 156,
  "vectors_upserted": 156,
  "chunk_strategy": "semantic_v2",
  "avg_chunk_size": 734,
  "processing_time": 45.2
}
```

### Appendix C: Cost Analysis

**Current System (9 documents, 644 chunks):**
- Pinecone storage: 644 × 3072 floats × 4 bytes = 7.9MB vectors
- Metadata: 644 × 8KB = 5.2MB
- Total: 13.1MB
- Cost: ~$0.52/month (Pinecone serverless)

**New System (9 documents, ~1400 chunks):**
- Pinecone storage: 1400 × 3072 floats × 4 bytes = 17.2MB vectors
- Metadata: 1400 × 2.5KB = 3.5MB
- Total: 20.7MB
- Cost: ~$0.83/month

**Cost increase: +$0.31/month (+60%)**

**But:**
- 2.2x more chunks (better precision)
- 69% less metadata waste
- 40-50% better search quality
- Hybrid search capability
- Multi-format support

**ROI:** Quality improvement justifies cost

### Appendix D: Dependencies

```txt
# requirements.txt additions
llama-parse==0.4.0
langchain==0.1.0
langchain-text-splitters==0.0.1
langgraph==0.0.20
rank-bm25==0.2.2
tiktoken==0.5.2
markdown==3.5.1
```

### Appendix E: References

- [LangChain Text Splitters](https://python.langchain.com/docs/modules/data_connection/document_transformers/)
- [LlamaParse Documentation](https://docs.llamaindex.ai/en/stable/llama_cloud/llama_parse/)
- [Pinecone Hybrid Search](https://docs.pinecone.io/docs/hybrid-search)
- [BM25 Algorithm](https://en.wikipedia.org/wiki/Okapi_BM25)
- [RAG Best Practices](https://www.anthropic.com/index/contextual-retrieval)

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-10-01 | Brad + Claude | Initial design document |

---

## Approval

**Technical Lead:** _______________ Date: ___________

**Product Owner:** _______________ Date: ___________

**Engineering Manager:** _______________ Date: ___________

---

*End of Design Document*

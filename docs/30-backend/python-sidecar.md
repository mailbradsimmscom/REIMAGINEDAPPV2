# Python Sidecar

## Overview

The Python Sidecar is a FastAPI service that handles heavy processing: LLM calls, document parsing (LlamaParse), chunking, DIP extraction (Anthropic Claude), and vector indexing. Node.js delegates to it for all AI operations.

**Service:** `boatos-python` on Render
**Port:** 8000 (local), `$PORT` (Render)
**Framework:** FastAPI

---

## Why Python?

- Better ML/AI library support (OpenAI, Anthropic async clients)
- LlamaParse cloud API integration for PDF parsing
- PIL/Pillow for image cropping and figure extraction
- Heavy processing isolated from Node.js
- SSE streaming support for long-running DIP extraction

---

## Architecture

```
+------------------------------------------------------------------+
|  Node.js (boatos-main)                                           |
|  +-- HTTP calls to Python Sidecar                                |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
|  Python Sidecar (boatos-python)                                  |
|  +-- /health               - Health check (incl. llamaparse)     |
|  +-- /v1/chat/process      - Chat workflow (with doc_assets)     |
|  +-- /v1/chat/process/stream - Streaming chat                    |
|  +-- /v1/llamaparse        - PDF parsing via LlamaParse          |
|  +-- /v1/detect-models     - Model detection (gpt-4.1-mini)     |
|  +-- /v1/vision/analyze-pages - Layout analysis from LlamaParse  |
|  +-- /v1/vision/crop-figures  - Figure cropping via PIL          |
|  +-- /v1/dip/run           - DIP extraction (SSE, Anthropic)     |
|  +-- /v1/index-document    - v5 document indexing                |
+------------------------------------------------------------------+
                              |
         +--------------------+--------------------+
         v                    v                    v
+-----------------+  +-----------------+  +-----------------+
|  OpenAI API     |  |  Anthropic API  |  |  LlamaParse     |
|                 |  |                 |  |  (Cloud)        |
|  - Embeddings   |  |  - DIP extract  |  |  - PDF parsing  |
|  - Chat synth.  |  |  - Prompt cache |  |  - Layout data  |
|  - Model detect |  |  - 5 DIP modes  |  |  - Markdown out |
+-----------------+  +-----------------+  +-----------------+
         |                                        |
         v                                        v
+-----------------+  +-----------------+  +-----------------+
|  Pinecone API   |  |  Perplexity API |  |  Supabase       |
|                 |  |  (optional)     |  |                 |
|  - Search       |  |  - Web search   |  |  - Doc assets   |
|  - Upsert       |  |  - Citations    |  |  - DIP results  |
+-----------------+  +-----------------+  +-----------------+
```

---

## Chat Workflow (chat_workflow_sequential.py)

### ChatWorkflowSequential Class

```python
# python-sidecar/app/chat/workflows/chat_workflow_sequential.py
class ChatWorkflowSequential:
    """Sequential chat workflow without LangGraph dependency"""

    def __init__(self, llm_service, dip_retriever, pinecone_client=None, doc_assets_retriever=None):
        """
        Initialize workflow with required services

        Args:
            llm_service: LLM service for classification and synthesis
            dip_retriever: DIP retriever (production)
            pinecone_client: Optional Pinecone client for semantic search
            doc_assets_retriever: v5 doc_assets retriever for figures/assets
        """
        self.llm_service = llm_service
        self.dip_retriever = dip_retriever
        self.pinecone_client = pinecone_client
        self.doc_assets_retriever = doc_assets_retriever
```

### process_chat Method

```python
async def process_chat(self,
                      user_query: str,
                      systems_context: List[Dict[str, Any]],
                      thread_id: Optional[str] = None,
                      conversation_summary: Optional[str] = None,
                      memory_context: Optional[Dict[str, Any]] = None,
                      synthesis_model: Optional[str] = None) -> Dict[str, Any]:
    """
    Process chat query through sequential workflow

    Steps:
        1. Query Classification
        2. Data Retrieval (DIP + Pinecone + doc_assets in parallel)
        3. Parallel Synthesis (OpenAI) + Perplexity web search
        4. Assemble Response with all sources

    Returns:
        Dict with response, sources, metadata, detailed_metrics
    """
```

### Detailed Metrics Collection

```python
detailed_metrics = {
    "timing_summary": {
        "total_processing_ms": processing_time,
        "total_measured_ms": total_measured,
        "breakdown": {
            "classification_ms": classification_ms,
            "dip_retrieval_ms": dip_ms,
            "pinecone_search_ms": pinecone_ms,
            "doc_assets_ms": doc_assets_ms,
            "chunk_ranking_ms": ranking_ms,
            "synthesis_ms": synthesis_ms,
            "perplexity_ms": perplexity_ms,
            "assembly_ms": assembly_ms
        }
    },
    "classification": {
        "intent": state["classification"].get("intent", "unknown"),
        "confidence": state["classification"].get("confidence", 0),
        "complexity_score": state["classification"].get("complexity_score", 0),
        "complexity": state["classification"].get("complexity", "unknown"),
        "table_types_needed": state["classification"].get("table_types_needed", [])
    },
    "pinecone": {
        "total_matches": ...,
        "filtered_matches": ...,
        "metadata_filter_used": ...
    },
    "synthesis": {
        "reasoning_effort": state.get("reasoning_effort", "medium"),
        "token_usage": state.get("synthesis_token_usage", {}),
        "model_used": state.get("synthesis_model_used", "unknown")
    }
}
```

### Streaming Response

```python
async def process_chat_streaming(
    self,
    user_query: str,
    systems_context: List[Dict[str, Any]],
    thread_id: Optional[str] = None,
    conversation_summary: Optional[str] = None,
    memory_context: Optional[Dict[str, Any]] = None,
    synthesis_model: Optional[str] = None
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Streaming version of process_chat - yields events as they complete.

    Events:
    - synthesis: When OpenAI response is ready
    - perplexity: When Perplexity response is ready
    - done: Final metrics
    """
```

---

## DIP Extraction (v5)

DIP (Document Intelligence Pipeline) extraction uses **Anthropic Claude** with prompt caching and SSE streaming.

### How It Works

1. **Warmup**: Sends `intent_router` mode first to prime the Anthropic prompt cache with the full document markdown
2. **Parallel extraction**: Runs remaining modes 2-at-a-time using `asyncio.Semaphore(2)` with `AsyncAnthropic` client
3. **5 extraction modes**: `specs`, `procedures`, `troubleshooting`, `golden_rules`, `intent_router`
4. **SSE streaming**: Progress events sent to the client in real-time as each mode completes

### DIP SSE Events

```
event: warmup_complete     # intent_router finished, cache primed
event: mode_started        # A mode began processing
event: mode_completed      # A mode finished (includes items[] and stats)
event: dip_complete        # All modes done, final summary
event: error               # Something failed
```

### Why Anthropic for DIP?

- Prompt caching reduces cost by ~90% for repeated document analysis
- Cache is primed once with full document text via `intent_router` warmup
- Subsequent modes reuse the cached document prefix
- Better structured extraction quality for marine technical content

---

## LlamaParse Integration (v5)

LlamaParse replaced pdfplumber as the primary PDF parser.

### Why LlamaParse?

- Cloud-based API, no local PDF library dependencies
- Superior table and layout extraction from complex technical manuals
- Returns both markdown text and layout data (bounding boxes, figure regions)
- `extract_layout=True` provides structural information for figure detection

### Cached Output

Parsed markdown is cached locally in `llamaparse_output/` during development to avoid re-parsing the same PDFs.

---

## Canonical Model Normalization

The Python sidecar includes a `normalize_model_key()` function for canonical model name normalization. This ensures consistent model identification across the system (e.g., "Leopard 45 Classic" and "L45C" resolve to the same canonical key).

---

## Directory Structure

```
python-sidecar/
+-- app/
|   +-- main.py                      # FastAPI app, ALL routes (monolith)
|   +-- models.py                    # Pydantic models
|   +-- pinecone_client.py           # Pinecone operations
|   +-- logging_config.py            # Logging setup
|   +-- chat/
|   |   +-- workflows/
|   |   |   +-- chat_workflow_sequential.py
|   |   +-- services/
|   |   |   +-- llm_service.py
|   |   |   +-- perplexity_service.py
|   |   |   +-- production_dip_retriever.py
|   |   |   +-- doc_assets_retriever.py    # v5: doc asset retrieval
|   |   +-- config/
|   |       +-- system_prompts.py
|   +-- chunking/                    # Document chunking
|   +-- analysis/                    # Analysis tools
+-- llamaparse_output/               # Cached LlamaParse markdown (dev)
+-- logs/                            # Log files
+-- requirements.txt                 # Dependencies
+-- .venv/                           # Virtual environment
```

---

## Key Files

| File | Purpose |
|------|---------|
| `main.py` | FastAPI app, all routes (monolith pattern) |
| `chat/workflows/chat_workflow_sequential.py` | Chat processing with doc_assets retrieval |
| `chat/services/llm_service.py` | OpenAI LLM calls (chat synthesis, model detection) |
| `chat/services/perplexity_service.py` | Web search integration |
| `chat/services/production_dip_retriever.py` | DIP data retrieval for chat |
| `chat/services/doc_assets_retriever.py` | v5 doc asset retrieval (figures, images) |
| `chat/config/system_prompts.py` | All LLM prompts |
| `pinecone_client.py` | Vector search + embeddings |

---

## API Endpoints

### Health Check

```
GET /health
```

Response includes `llamaparse_available: true/false` indicating whether the LLAMA_CLOUD_API_KEY is configured.

---

### Chat Process (Non-Streaming)

```
POST /v1/chat/process
Content-Type: application/json

{
  "query": "How do I change the oil filter?",
  "thread_id": "uuid",
  "systems_context": [...],
  "conversation_summary": "...",
  "memory_context": {...}
}
```

v5 change: Data retrieval now fetches DIP results, Pinecone chunks, **and doc_assets** (figures, images) in parallel.

---

### Chat Process (Streaming)

```
POST /v1/chat/process/stream
Content-Type: application/json

{
  "query": "...",
  "systems_context": [...]
}
```

Returns SSE events:
- `event: synthesis` - OpenAI response ready
- `event: perplexity` - Web search ready
- `event: done` - Final metrics

---

### LlamaParse (v5)

```
POST /v1/llamaparse
Content-Type: multipart/form-data

file: <PDF binary>
extract_layout: true
```

Response:
```json
{
  "markdown": "# Manual Title\n\n## Chapter 1...",
  "layout_data": { ... },
  "pages_total": 42
}
```

Parses a PDF through the LlamaParse cloud API. The `extract_layout=True` flag returns bounding box and structural layout information alongside the markdown text.

---

### Detect Models (v5)

```
POST /v1/detect-models
Content-Type: application/json

{
  "text": "<full parsed markdown>",
  "doc_id": "uuid",
  "filename": "leopard-45-owners-manual.pdf"
}
```

Response:
```json
{
  "primary_models": ["Leopard 45 Classic"],
  "referenced_products": ["Yanmar 4JH80", "Victron MultiPlus"],
  "is_multi_model": false,
  "confidence": 0.95,
  "evidence": "Title page states 'Leopard 45 Classic Owner Manual'",
  "product_category": "catamaran",
  "manufacturer": "Leopard Catamarans"
}
```

Uses gpt-4.1-mini to analyze the full parsed markdown and detect which boat models and referenced products the document covers.

---

### Vision: Analyze Pages (v5)

```
POST /v1/vision/analyze-pages
Content-Type: application/json

{
  "doc_id": "uuid",
  "pages": [1, 2, 3, 5, 8],
  "models_covered": ["Leopard 45 Classic"],
  "user_model": "Leopard 45 Classic"
}
```

Response:
```json
{
  "pages_analyzed": 5,
  "figures_found": 12,
  "results": [
    {
      "page_number": 1,
      "figures": [
        {
          "bbox": [100, 200, 400, 500],
          "description": "Helm station layout diagram",
          "model_attribution": "Leopard 45 Classic"
        }
      ]
    }
  ]
}
```

Analyzes page layout data from LlamaParse (not Claude Vision) to identify figures, diagrams, and images with bounding boxes and model attribution.

---

### Vision: Crop Figures (v5)

```
POST /v1/vision/crop-figures
Content-Type: application/json

{
  "doc_id": "uuid",
  "page_number": 3,
  "image_base64": "<base64 encoded page image>",
  "figures": [
    {
      "bbox": [100, 200, 400, 500],
      "description": "Wiring diagram"
    }
  ]
}
```

Response:
```json
{
  "cropped_figures": [
    {
      "description": "Wiring diagram",
      "image_base64": "<base64 cropped image>",
      "bbox": [100, 200, 400, 500]
    }
  ]
}
```

Uses PIL/Pillow to crop individual figures from full page images based on bounding box coordinates.

---

### DIP Run (v5, SSE Streaming)

```
POST /v1/dip/run
Content-Type: application/json

{
  "doc_id": "uuid",
  "models_covered": ["Leopard 45 Classic"],
  "selected_models": ["Leopard 45 Classic"],
  "exclude_systems": []
}
```

Response: SSE event stream

```
event: warmup_complete
data: {"mode": "intent_router", "cached": true}

event: mode_started
data: {"mode": "specs"}

event: mode_completed
data: {"mode": "specs", "items": [...], "stats": {"items_extracted": 15, "duration_ms": 3200}}

event: mode_started
data: {"mode": "procedures"}

event: mode_completed
data: {"mode": "procedures", "items": [...], "stats": {"items_extracted": 8, "duration_ms": 4100}}

...

event: dip_complete
data: {"total_items": 47, "modes_completed": 5, "total_duration_ms": 18500}
```

**Implementation details:**
- Uses `AsyncAnthropic` client with prompt caching
- `asyncio.Semaphore(2)` limits to 2 concurrent mode extractions
- `intent_router` always runs first as warmup to prime the prompt cache
- Remaining 4 modes run 2-at-a-time after warmup completes
- Each mode extracts structured data: specs, procedures, troubleshooting, golden_rules, intent_router

---

### Index Document (v5)

```
POST /v1/index-document
Content-Type: application/json

{
  "doc_id": "uuid",
  "asset_uid": "asset-uuid",
  "models_covered": ["Leopard 45 Classic"],
  "selected_models": ["Leopard 45 Classic"]
}
```

Response:
```json
{
  "chunks_created": 156,
  "vectors_upserted": 156
}
```

v5 document indexing that creates model-tagged chunks and upserts them to Pinecone with model metadata for filtered retrieval.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | - | OpenAI API key (chat synthesis, embeddings, model detection) |
| `OPENAI_MODEL` | `gpt-5.1-chat-latest` | Primary chat synthesis model |
| `OPENAI_SUMMARY_MODEL` | `gpt-4.1-mini` | Fast model (classification, model detection) |
| `VISION_MODEL` | `gpt-4o` | Vision analysis model |
| `ANTHROPIC_API_KEY` | - | Anthropic API key (DIP extraction via Claude) |
| `LLAMA_CLOUD_API_KEY` | - | LlamaParse cloud API key (PDF parsing) |
| `PINECONE_API_KEY` | - | Pinecone API key |
| `PINECONE_INDEX` | `reimaginedsv` | Pinecone index name |
| `PINECONE_NAMESPACE` | `REIMAGINEDDOCS` | Pinecone namespace |
| `SUPABASE_URL` | - | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | - | Supabase service role key |
| `COHERE_API_KEY` | - | Cohere API key (chunk reranking) |
| `PERPLEXITY_API_KEY` | - | Perplexity key (optional, web search) |
| `PERPLEXITY_ENABLED` | `false` | Enable Perplexity web search |

---

## Running Locally

```bash
cd python-sidecar
source .venv/bin/activate
python3 -m app.main
```

Or with uvicorn:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

---

## Logging

```python
import logging
logger = logging.getLogger(__name__)

logger.info("WORKFLOW ENTRY - process_chat() called")
logger.info(f"  - Query: {user_query[:100]}")
logger.info(f"  - Systems context count: {len(systems_context)}")
```

Logs to: `python-sidecar/logs/chat.log`

---

## Updating Dependencies

```bash
cd python-sidecar
pip freeze > requirements.txt
```

---

## Render Deployment

| Setting | Value |
|---------|-------|
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Workers | Optional: `--workers 2` for concurrency |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Uses LangChain" | **No.** Direct OpenAI/Anthropic API calls |
| "Uses LangGraph" | **No.** Removed. Sequential workflow. |
| "Uses pdfplumber" | **No.** LlamaParse (cloud API) replaced it in v5 |
| "DIP uses OpenAI" | **No.** DIP uses Anthropic Claude with prompt caching |
| "Node.js calls OpenAI" | **No.** All LLM calls through Python sidecar |
| "Stores data" | **No.** Stateless. Supabase/Pinecone store data. |
| "Blocking requests" | **No.** Async throughout with asyncio.gather / Semaphore |
| "Claude Vision for layout" | **No.** Layout analysis uses LlamaParse data, not vision API |

---

## Related Docs

- [Chat](../10-user-features/chat.md) - Chat flow details
- [Documents](../20-admin-tools/documents.md) - Document processing
- [Pinecone](../20-admin-tools/pinecone.md) - Vector storage
- [Environments](../00-foundations/environments.md) - Deployment config

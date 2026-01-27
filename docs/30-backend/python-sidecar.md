# Python Sidecar

## Overview

The Python Sidecar is a FastAPI service that handles heavy processing: LLM calls, document parsing, chunking, and DIP extraction. Node.js delegates to it for AI operations.

**Service:** `boatos-python` on Render
**Port:** 8000 (local), `$PORT` (Render)
**Framework:** FastAPI

---

## Why Python?

- Better ML/AI library support
- PDF parsing libraries (PDFPlumber)
- OpenAI/Anthropic async clients
- Heavy processing isolated from Node.js

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Node.js (boatos-main)                                          │
│  └── HTTP calls to Python Sidecar                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Python Sidecar (boatos-python)                                 │
│  ├── /chat/process - Chat workflow                              │
│  ├── /chat/process/stream - Streaming chat                      │
│  ├── /dip/process - DIP extraction                              │
│  ├── /chunk - Document chunking                                 │
│  └── /health - Health check                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ↓                    ↓                    ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  OpenAI API     │  │  Pinecone API   │  │  Perplexity API │
│                 │  │                 │  │  (optional)     │
│  - Embeddings   │  │  - Search       │  │  - Web search   │
│  - Completions  │  │  - Upsert       │  │  - Citations    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Chat Workflow (chat_workflow_sequential.py)

### ChatWorkflowSequential Class

```python
# python-sidecar/app/chat/workflows/chat_workflow_sequential.py:26-48
class ChatWorkflowSequential:
    """Sequential chat workflow without LangGraph dependency"""

    def __init__(self, llm_service, dip_retriever, pinecone_client=None):
        """
        Initialize workflow with required services

        Args:
            llm_service: LLM service for classification and synthesis
            dip_retriever: DIP retriever (staging or production)
            pinecone_client: Optional Pinecone client for semantic search
        """
        self.llm_service = llm_service
        self.dip_retriever = dip_retriever
        self.pinecone_client = pinecone_client

        logger.info("✅ Sequential chat workflow initialized (No LangGraph)")
```

### process_chat Method

```python
# python-sidecar/app/chat/workflows/chat_workflow_sequential.py:50-130
async def process_chat(self,
                      user_query: str,
                      systems_context: List[Dict[str, Any]],
                      thread_id: Optional[str] = None,
                      conversation_summary: Optional[str] = None,
                      memory_context: Optional[Dict[str, Any]] = None,
                      synthesis_model: Optional[str] = None) -> Dict[str, Any]:
    """
    Process chat query through sequential workflow

    Args:
        user_query: User's conversational query
        systems_context: Equipment found by Node.js systems search
        thread_id: Optional thread ID
        conversation_summary: Weighted conversation summary from Node.js
        memory_context: Memory context with weights and equipment transitions
        synthesis_model: Optional model override for synthesis

    Returns:
        Dict with response, sources, metadata, etc.
    """
    start_time = datetime.now()

    # Initialize state
    state = {
        "user_query": user_query,
        "thread_id": thread_id,
        "systems_context": systems_context,
        "conversation_summary": conversation_summary,
        "memory_context": memory_context,
        "synthesis_model": synthesis_model,
        "classification": None,
        "primary_equipment": None,
        "secondary_equipment": [],
        "dip_results": [],
        "pinecone_results": None,
        "final_response": None,
        "response_score": None,
        "processing_steps": [],
        "start_time": start_time,
        "error": None
    }

    # ===== STEP 1: Query Classification =====
    state = await self._classify_query(state)

    # ===== STEP 2: Data Retrieval =====
    state = await self._retrieve_data(state)

    # ===== STEP 3: Parallel OpenAI + Perplexity =====
    openai_task = asyncio.create_task(self._synthesize_response(state))
    perplexity_task = asyncio.create_task(self._query_perplexity(state))

    openai_result, perplexity_result = await asyncio.gather(
        openai_task,
        perplexity_task,
        return_exceptions=True
    )

    # ===== STEP 4: Assemble Response =====
    state = await self._assemble_response(openai_result, perplexity_result, state)

    return result
```

### Detailed Metrics Collection

```python
# python-sidecar/app/chat/workflows/chat_workflow_sequential.py:203-283
# Collect detailed metrics for stats panel
classification_ms = state.get("classification_duration_ms", 0)
dip_ms = state.get("dip_duration_ms", 0)
pinecone_ms = state.get("pinecone_duration_ms", 0)
ranking_ms = state.get("pinecone_complexity_filtering", {}).get("ranking_duration_ms", 0)
synthesis_ms = state.get("synthesis_duration_ms", 0)
perplexity_ms = state.get("perplexity_duration_ms", 0)
assembly_ms = state.get("assembly_duration_ms", 0)

detailed_metrics = {
    "timing_summary": {
        "total_processing_ms": processing_time,
        "total_measured_ms": total_measured,
        "breakdown": {
            "classification_ms": classification_ms,
            "dip_retrieval_ms": dip_ms,
            "pinecone_search_ms": pinecone_ms,
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
        "total_matches": (state.get("pinecone_results") or {}).get("total_matches", 0),
        "filtered_matches": (state.get("pinecone_results") or {}).get("filtered_matches", 0),
        "metadata_filter_used": (state.get("pinecone_results") or {}).get("metadata_filter_used", False)
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
# python-sidecar/app/chat/workflows/chat_workflow_sequential.py:349-399
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
    - synthesis: When OpenAI response is ready (~5s)
    - perplexity: When Perplexity response is ready (~10s)
    - done: Final metrics
    """
    start_time = datetime.now()

    # Initialize state (same as process_chat)
    state = {...}

    # STEP 1: Classification
    state = await self._classify_query(state)

    if state.get("error"):
        yield {"event": "error", "error": state["error"]}
        return
```

---

## Directory Structure

```
python-sidecar/
├── app/
│   ├── main.py                      # FastAPI app, routes
│   ├── models.py                    # Pydantic models
│   ├── parser.py                    # PDF parsing (PDFPlumber)
│   ├── pinecone_client.py           # Pinecone operations
│   ├── dip_processor.py             # DIP extraction
│   ├── logging_config.py            # Logging setup
│   ├── debug_logger.py              # Debug logging
│   ├── chat/
│   │   ├── workflows/
│   │   │   └── chat_workflow_sequential.py
│   │   ├── services/
│   │   │   ├── llm_service.py
│   │   │   └── perplexity_service.py
│   │   └── config/
│   │       └── system_prompts.py
│   ├── chunking/                    # Document chunking
│   └── analysis/                    # Analysis tools
├── logs/                            # Log files
├── requirements.txt                 # Dependencies
└── venv/                            # Virtual environment
```

---

## Key Files

| File | Purpose |
|------|---------|
| `main.py` | FastAPI app, all routes |
| `chat/workflows/chat_workflow_sequential.py` | 5-step chat processing |
| `chat/services/llm_service.py` | OpenAI LLM calls |
| `chat/services/perplexity_service.py` | Web search integration |
| `chat/config/system_prompts.py` | All LLM prompts |
| `dip_processor.py` | Structured data extraction |
| `parser.py` | PDF parsing with OCR fallback |
| `pinecone_client.py` | Vector search + embeddings |

---

## API Endpoints

### Health Check

```
GET /health
```

### Chat Process (Non-Streaming)

```
POST /chat/process
Content-Type: application/json

{
  "query": "How do I change the oil filter?",
  "thread_id": "uuid",
  "systems_context": [...],
  "conversation_summary": "...",
  "memory_context": {...}
}
```

### Chat Process (Streaming)

```
POST /chat/process/stream
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

### DIP Process

```
POST /dip/process
Content-Type: application/json

{
  "document_id": "uuid",
  "content": "...",
  "page": 1
}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | - | OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o` | Chat model |
| `OPENAI_SUMMARY_MODEL` | `gpt-4o-mini` | Fast model |
| `PERPLEXITY_API_KEY` | - | Perplexity key (optional) |
| `PERPLEXITY_ENABLED` | `false` | Enable web search |
| `PINECONE_API_KEY` | - | Pinecone API key |
| `PINECONE_INDEX` | `reimaginedsv` | Index name |
| `PINECONE_NAMESPACE` | `REIMAGINEDDOCS` | Namespace |

---

## Running Locally

```bash
cd python-sidecar
source venv/bin/activate
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

logger.info("🚀 WORKFLOW ENTRY - process_chat() called")
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
| "Uses LangChain" | **No.** Direct OpenAI/Anthropic calls |
| "Uses LangGraph" | **No.** Removed. Sequential workflow. |
| "Node.js calls OpenAI" | **No.** All LLM calls through Python |
| "Stores data" | **No.** Stateless. Supabase/Pinecone store data. |
| "Blocking requests" | **No.** Async throughout with asyncio.gather |

---

## Related Docs

- [Chat](../10-user-features/chat.md) - Chat flow details
- [Documents](../20-admin-tools/documents.md) - Document processing
- [Pinecone](../20-admin-tools/pinecone.md) - Vector storage
- [Environments](../00-foundations/environments.md) - Deployment config

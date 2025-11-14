# REIMAGINEDAPPV2 – System Architecture (Current)

**Last Updated:** 2025-10-26
**Based on:** Deep code analysis with verified flows and LLM integration points

---

## 1. Overview & Purpose

REIMAGINEDAPPV2 is an **AI-powered boat operating system for catamarans** that manages 200+ interconnected marine equipment systems through:
- Semantic document search using vector embeddings
- Intelligent chat with equipment context awareness
- Technical manual ingestion and processing
- Equipment relationship inference
- Maintenance task management

**Technology Stack:**
- **Backend:** Node.js (Express.js, ESM modules)
- **Frontend:** Vanilla JavaScript with Apple-inspired UI
- **Database:** Supabase (PostgreSQL)
- **Vector Search:** Pinecone
- **Web Search:** Perplexity (sonar-pro model for real-world marine insights)
- **Python Sidecar:** FastAPI for heavy processing (LlamaParse, embeddings, chat workflow)
- **LLM Providers:** OpenAI (GPT-5, GPT-4.1-mini), Anthropic Claude (DIP extraction), Perplexity (web search)

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│  Frontend (Vanilla JS)                              │
│  - Chat Interface (/index.html)                     │
│  - Admin Dashboard (/admin)                         │
│  - System Dashboard (/public/dashboard.html)        │
│  - Document Upload (/upload.html)                   │
│  - Log Viewer (/logs-viewer.html)                   │
│  - Maintenance Management                           │
└─────────────────────────────────────────────────────┘
                          │
                          ↓
┌─────────────────────────────────────────────────────┐
│  Node.js Backend (Express, ESM)                     │
│  - Routes: HTTP handlers (thin, validation only)    │
│  - Services: Business logic                         │
│  - Repositories: DB/storage/network I/O             │
│  - Middleware: Auth, logging, validation            │
└─────────────────────────────────────────────────────┘
                          │
                          ↓
┌──────────────────────┬──────────────────────────────┐
│  Python Sidecar      │  External Services           │
│  (FastAPI)           │                              │
│  - LlamaParse        │  - Supabase (PostgreSQL)     │
│  - Chat Workflow     │  - Pinecone (vector search)  │
│  - DIP Extraction    │  - OpenAI API                │
│  - Embeddings        │  - Anthropic API             │
└──────────────────────┴──────────────────────────────┘
```

---

## 3. Major Data Flows

### 3.1 Document Upload & Processing Flow

**Entry:** `/docs/ingest` → `document.service.js` → Python sidecar

#### Synchronous Phase (returns immediately):
1. **Receive multipart form** (`ingest.route.js:38-122`)
2. **Validate metadata** (`ingest.route.js:84-100`)
3. **Look up system in database** (`document.service.js:244-292`)
4. **Generate doc_id** SHA256 hash (`document.service.js:235`)
5. **Create job record** (`document.service.js:302-325`)
6. **Upload to Supabase Storage** (`document.service.js:359`)
7. **Verify storage** (`document.service.js:369`)
8. **Return job_id** (`document.service.js:398-402`)

#### Asynchronous Phase (`processJob`):
9. **Call Python sidecar** (`document.service.js:817`)
   - **[LLM: LlamaParse]** Vision-based PDF parsing (`chunking/parser.py:76`)
   - Semantic chunking (token-based: 400-1200 tokens)
   - **[LLM: OpenAI]** Generate embeddings (`text-embedding-3-large`)
   - Store in Pinecone + Supabase

10. **Extract colloquial keywords** (`document.service.js:510`)
    - **[LLM: OpenAI]** Natural language terms extraction

11. **Run DIP extraction** (`document.service.js:552`)
    - **[LLM: Anthropic Claude]** Extract 4 types:
      - Specifications (`spec_suggestions`)
      - Procedures (`playbook_hints`)
      - Intent routing (`intent_router`)
      - Golden tests (`golden_tests`)

12. **Update job status** to completed (`document.service.js:611-614`)

---

### 3.2 Chat Processing Flow

**Entry:** `/chat/process` → `chat-proxy.service.js` → Python sidecar

#### Node.js Processing:
1. **Get conversation context** (`chat-proxy.service.js:36`)
   - Last 20 messages with weighted recency
   - Load equipment_context from thread

2. **Parallel equipment search** (`chat-proxy.service.js:189-207`)
   - Keyword search in systems table
   - **[LLM: OpenAI]** Equipment name extraction

3. **Equipment relationship inference** (`chat-proxy.service.js:95-102`)
   - **[LLM: OpenAI]** Find related systems (conditional)

4. **Update thread equipment** (`chat-proxy.service.js:521-523`)
   - Save to `chat_threads.equipment_context` JSONB

5. **Call Python sidecar** (`chat-proxy.service.js:565`)

#### Python Sidecar Processing (`/v1/chat/process`):
6. **Query Classification** (`chat_workflow_sequential.py:122`)
   - **[LLM: OpenAI]** Classify intent and complexity

7. **Data Retrieval** (`chat_workflow_sequential.py:133`)
   - Query DIP tables (4 types)
   - Pinecone semantic search
   - **[LLM: OpenAI]** Rank chunks by relevance

8. **Parallel Response Generation** (`chat_workflow_sequential.py:148-164`)
   - **Path A: OpenAI Synthesis** (`_synthesize_response`)
     - **[LLM: GPT-5 or GPT-4.1-mini]** Generate response from DIP + Pinecone
   - **Path B: Perplexity Search** (`_query_perplexity`)
     - Build enhanced query with intent, equipment, and vessel context
     - **[LLM: Perplexity sonar-pro]** Web search for real-world marine insights
     - Returns 3-5 concise bullet points with citations
   - Both run in parallel (asyncio.gather)
   - Graceful degradation if either fails

9. **Assemble Response** (`chat_workflow_sequential.py:716-798`)
   - Combine OpenAI response + Perplexity insights
   - Format sources from all 3 data sources (DIP, Pinecone, Perplexity)

10. **Return to frontend** with metadata and sources

#### Frontend Post-Processing:
11. **Save messages** (`app.js:654, 672`)
    - POST to `/chat/messages`

---

## 4. Database Schema

### Core Tables (Supabase/PostgreSQL)

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| **documents** | Document registry | doc_id, manufacturer_norm, model_norm, asset_uid, status |
| **document_chunks** | Text segments | chunk_id, doc_id, content, metadata, embedding_hash |
| **jobs** | Processing jobs | job_id, doc_id, status, storage_path, counters |
| **systems** | Equipment catalog | asset_uid, system_norm, manufacturer_norm, model_norm, spec_keywords, colloquial_keywords |
| **chat_sessions** | Conversations | session_id, name, created_at |
| **chat_threads** | Message threads | thread_id, session_id, equipment_context (JSONB) |
| **chat_messages** | Messages | message_id, thread_id, role, content, metadata |
| **maintenance_tasks** | Task definitions | id, category, frequency, description |
| **maintenance_tasks_queue** | Pending tasks | id, system_name, task_description, criticality, status |

### DIP Tables (4 types, each with staging/production):
- **spec_suggestions** / **staging_spec_suggestions**
- **playbook_hints** / **staging_playbook_hints**
- **intent_router** / **staging_intent_router**
- **golden_tests** / **staging_golden_tests**

---

## 5. Key Services & Their Roles

### Document Processing
- `document.service.js` (830 lines) - Main document handling, job orchestration
- `document-deletion.service.js` - Comprehensive deletion across all storage layers
- `colloquial-extraction.service.js` - Extract natural language keywords
- `anthropic.extraction.service.js` - DIP extraction via Claude

### Chat & Intelligence
- `chat-proxy.service.js` - Main chat orchestrator
- `equipment-extraction.service.js` - LLM-based equipment extraction
- `equipment-relationship-inference.service.js` - Find related systems
- `conversation-context.service.js` - Build weighted context

### Search & Retrieval
- `pinecone.service.js` - Vector search orchestration
- `systems.service.js` - Equipment data and relationships
- `perplexity_service.py` - Web search with intent-based prompts (Python sidecar)

### Maintenance
- `maintenance-tasks.service.js` - CRUD for maintenance tasks
- `maintenance.service.js` - Queue management

---

## 6. Python Sidecar Endpoints

**Location:** `/python-sidecar/app/main.py`

| Endpoint | Purpose | LLM Usage |
|----------|---------|-----------|
| `/v1/parse` | PDF parsing | LlamaParse (vision-based) |
| `/v1/chunk` | Semantic chunking | - |
| `/v1/embed` | Generate embeddings | OpenAI embeddings |
| `/v1/pinecone/upsert` | Store vectors | - |
| `/v1/chat/process` | Chat workflow | GPT-5/4.1-mini + Perplexity (parallel) |
| `/v1/dip/process` | DIP extraction | Anthropic Claude |

---

## 7. LLM Integration Summary

### Total LLM Calls by Provider:

**OpenAI (5-8 calls per operation):**
- Document: Embeddings, colloquial extraction
- Chat: Equipment extraction, relationship inference, classification, ranking, synthesis

**Anthropic Claude (4 calls):**
- DIP extraction: specs, procedures, intent, golden tests

**Perplexity (1 call per chat - optional):**
- Web search for real-world marine troubleshooting insights
- Intent-based query construction with vessel context

**LlamaParse (1 call):**
- Vision-based PDF parsing

### Data Source Architecture:

**3-Source System:**
1. **DIP Tables** - Structured manual data extracted via Claude (specs, procedures, troubleshooting)
2. **Pinecone** - Vector search on document chunks for semantic relevance
3. **Perplexity** - Web search for real-world boat owner experiences and community wisdom

All three sources are combined in the final response, with Perplexity providing supplementary insights from marine forums, YouTube, and cruiser communities.

---

## 8. Deprecated Components (To Be Removed)

### Services (throw errors, replaced by Python):
- `/src/services/enhanced-chat.service.js`
- `/src/services/chat-orchestrator.service.js`
- `/src/services/langgraph-chat.service.js`
- `/src/services/chat-completion.service.js`

### Disabled Code:
- Python Response Scoring (Step 4) - "too slow for production"
- Legacy page-based chunking (when `USE_SEMANTIC_CHUNKING=false`)

### Stale References:
- LangGraph mentions (completely removed but docs reference it)
- Worker references (no implementation exists)
- DIP navigation button (no route exists)

**See `/code updates/99 To-Dos.md` for complete cleanup list (~3,000 lines to remove)**

---

## 9. Configuration & Environment

### Key Environment Variables:
```bash
NODE_ENV=production|development
PORT=3000
SUPABASE_URL=https://*.supabase.co
SUPABASE_SERVICE_KEY=...
PINECONE_API_KEY=...
PINECONE_INDEX=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
PERPLEXITY_API_KEY=...
PYTHON_SIDECAR_URL=http://localhost:8000
ADMIN_TOKEN=...
USE_SEMANTIC_CHUNKING=true
LLAMAPARSE_API_KEY=...
PERPLEXITY_ENABLED=false
PERPLEXITY_MODEL=sonar-pro
PERPLEXITY_TIMEOUT=45
```

### Feature Flags:
- `USE_SEMANTIC_CHUNKING=true` - Use LlamaParse (vs legacy pdfplumber)
- `DIP_ENVIRONMENT=production|staging` - DIP table selection
- `PERPLEXITY_ENABLED=false` - Enable/disable Perplexity web search (default: OFF)

---

## 10. Request Flow Pattern

All requests follow the layered architecture:
```
Routes → Services → Repositories → External Services
         ↓                           ↓
     (validation)              (Supabase/Pinecone/APIs)
```

### Middleware Stack:
1. `helmet` - Security headers
2. `cors` - CORS handling
3. `requestLogging` - Request/response logging
4. `adminGate` - Admin authentication (x-admin-token)
5. `validate` - Zod schema validation
6. `serviceGuards` - Check service availability
7. `errorHandler` - Centralized error handling

---

## 11. Key Implementation Details

### Conversation Context Storage:
- Built fresh each request from message history
- `equipment_context` JSONB persisted in `chat_threads` table
- Weighted recency: recent messages get higher weights (1.0, 0.8, 0.5, 0.2)

### Equipment Search Strategy:
- Parallel execution: keyword search + LLM extraction
- Merge and deduplicate results
- Fallback to relationship inference if no direct matches

### Document Processing:
- Deterministic doc_id via SHA256 hash
- System must exist in database before upload
- Async processing after immediate response
- Multiple storage layers: Supabase Storage, document_chunks, Pinecone

### DIP Data Flow:
- Extract during document processing
- Store in staging tables first
- Manual migration to production tables
- 4 distinct data types with different purposes

### Perplexity Integration:
- Feature flag controlled (PERPLEXITY_ENABLED)
- Parallel execution with OpenAI (both run simultaneously)
- Intent-based query construction (7 intent types)
- Vessel context included (Balance 526 catamaran)
- Graceful degradation (works if Perplexity fails)
- Returns 3-5 concise bullet points with citations

---

## 12. Performance Characteristics

### Typical Processing Times:
- Document upload: 2-5 minutes (async)
- Chat response (without Perplexity): 3-8 seconds
- Chat response (with Perplexity): 10-14 seconds
- Equipment extraction: 1-2 seconds
- DIP extraction: 30-60 seconds
- Embedding generation: 5-10 seconds
- Perplexity search: 21-24 seconds (runs in parallel with OpenAI)

### Bottlenecks:
- LlamaParse API calls (vision processing)
- Anthropic DIP extraction (4 sequential calls)
- Response synthesis with GPT-5 (reasoning model)
- Perplexity web search (21-24s, mitigated by parallel execution)

---

## 13. Recent Architecture Changes

### Completed:
- Removed LangGraph dependency (Python sequential workflow)
- Migrated from Docker to Python venv
- Removed worker process (inline job processing)
- Added colloquial keyword extraction (Update #31)
- Implemented multi-equipment extraction
- Fixed equipment context persistence
- Added source provenance display (Update #34)
- Replaced custom markdown parser with marked.js (Update #35)
- Integrated Perplexity web search (Updates #36, #37)
  - Parallel execution with OpenAI
  - Intent-based query construction
  - 3-source architecture (DIP + Pinecone + Perplexity)

### Pending:
- Remove ~3,000 lines of deprecated code
- Update production domain in CORS config
- Remove disabled response scoring code
- Clean up legacy chunking path

---

## 14. Security Model

### Authentication:
- Admin routes: `x-admin-token` header required
- No user authentication (single-tenant system)

### Data Protection:
- Supabase service role key (not anon)
- Namespace isolation in Pinecone (REIMAGINEDDOCS for manuals, MAINTENANCE_TASKS for schedules)
- Request correlation IDs for tracing

### Input Validation:
- Zod schemas for all inputs
- Response envelope validation
- File size limits (50MB for PDFs)

---

## 15. Monitoring & Debugging

### Logging:
- Structured Winston logging (Node.js)
- Separate log files: chat, api, errors, debug
- Health check filtering
- Request correlation IDs

### Debug Endpoints:
- `/admin/api/health` - Service health checks
- `/admin/api/metrics` - Performance metrics
- `/admin/api/logs/stream` - Real-time log streaming

### Testing Tools:
- Golden tests for regression testing
- Intent router testing interface
- Playbook testing interface

---

## Notes

- System designed for marine domain complexity (200+ interconnected systems)
- Emphasis on equipment relationships and context
- Production system actively processing boat manuals
- Single-tenant architecture (one boat owner)
- Heavy reliance on LLM intelligence for extraction and synthesis

**For implementation details, see individual service files and `/code updates/` documentation**
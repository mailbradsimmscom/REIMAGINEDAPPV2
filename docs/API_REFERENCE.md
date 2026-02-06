# REIMAGINEDAPPV2 - Comprehensive API Reference

**Generated:** 2025-12-10
**Purpose:** Complete documentation of all routes, endpoints, and APIs across the application.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Authentication](#authentication)
3. [Node.js Backend (Port 3000)](#nodejs-backend-port-3000)
   - [Public Endpoints](#public-endpoints)
   - [Chat Endpoints](#chat-endpoints)
   - [Admin Endpoints](#admin-endpoints)
   - [Supplies Endpoints](#supplies-endpoints)
   - [Trips Endpoints](#trips-endpoints)
4. [Python Sidecar (Port 8000)](#python-sidecar-port-8000)
5. [Maintenance Agent (Port 3001)](#maintenance-agent-port-3001)
   - [HTTP Endpoints](#maintenance-agent-http-endpoints)
   - [WebSocket API](#websocket-api)
6. [Response Formats](#response-formats)
7. [Error Handling](#error-handling)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                  │
│  (Web Browser, Mobile App, Admin Dashboard)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Node.js Main   │  │  Python Sidecar │  │  Maintenance    │
│  (Port 3000)    │  │  (Port 8000)    │  │  Agent (3001)   │
│                 │  │                 │  │                 │
│  • Chat API     │  │  • LlamaParse   │  │  • Pipeline     │
│  • Admin API    │  │  • Embeddings   │  │  • Task Mgmt    │
│  • Supplies     │  │  • Vector Ops   │  │  • Dedup Review │
│  • Trips        │  │  • Chat Process │  │  • WebSocket    │
│                 │  │  • DIP Streaming│  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              ▼
              ┌───────────────────────────────┐
              │       External Services        │
              │  • Supabase (PostgreSQL)      │
              │  • Pinecone (Vector DB)       │
              │  • OpenAI / Anthropic APIs    │
              └───────────────────────────────┘
```

---

## Authentication

### Admin Token Authentication
- **Header:** `x-admin-token`
- **Required for:** All `/admin/api/*` routes
- **Value:** Must match `ADMIN_TOKEN` environment variable

### PIN Authentication
- **Endpoint:** `POST /api/auth/pin`
- **Body:** `{ "pin": "string" }`
- **Returns:** `{ "success": true, "token": "string" }`

### Public Endpoints
- Chat, Supplies, Trips, and GPS endpoints require no authentication

---

## Node.js Backend (Port 3000)

### Public Endpoints

#### Static Pages

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Public chat interface |
| GET | `/landing` | Landing page |
| GET | `/upload` | Document upload page |
| GET | `/supplies` | Supplies management page |
| GET | `/trips` | Trips tracking page |
| GET | `/trips/detail` | Trip detail page |
| GET | `/unified-mobile.html` | Unified mobile dashboard |
| GET | `/document-ingest` | Admin document ingest page (v5) |
| GET | `/funnel` | Pipeline funnel visualization |

#### Health & Authentication

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | System health check |
| POST | `/api/auth/pin` | PIN authentication |

**POST /api/auth/pin**
```json
// Request
{ "pin": "1234" }

// Response
{ "success": true, "token": "jwt_token_here" }
```

#### GPS Data

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/gps/current` | Get most recent GPS position |

**Response:**
```json
{
  "success": true,
  "data": {
    "latitude": 38.5,
    "longitude": -123.5,
    "timestamp": "2025-12-10T...",
    "speed_over_ground": 6.5,
    "course_over_ground": 180,
    "depth": 12.5,
    "true_wind_speed": 15.2,
    "true_wind_direction": 270
  },
  "requestId": "req_abc123"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `latitude` | number | GPS latitude (decimal degrees) |
| `longitude` | number | GPS longitude (decimal degrees) |
| `timestamp` | string | ISO timestamp of position |
| `speed_over_ground` | number | SOG in knots |
| `course_over_ground` | number | COG in degrees |
| `depth` | number | Depth in meters (if available) |
| `true_wind_speed` | number | Wind speed in knots (if available) |
| `true_wind_direction` | number | Wind direction in degrees (if available) |

---

### Chat Endpoints

Base path: `/chat`

#### Sessions & Threads

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat/sessions` | Create chat session |
| GET | `/chat/sessions/:sessionId` | Get chat session |
| POST | `/chat/threads` | Create chat thread |
| GET | `/chat/threads/:threadId` | Get chat thread |

**POST /chat/sessions**
```json
// Request
{
  "id": "uuid",
  "name": "Session Name",
  "description": "Optional description",
  "metadata": {}
}
```

#### Messages

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat/messages` | Create message |
| GET | `/chat/messages/:threadId` | Get messages for thread |
| DELETE | `/chat/messages/:threadId/:sequenceNumber` | Delete message |

**POST /chat/messages**
```json
// Request
{
  "threadId": "uuid",
  "role": "user",
  "content": "Message text",
  "sequenceNumber": 1,
  "metadata": {}
}
```

**GET /chat/messages/:threadId**
- Query params: `limit`, `afterSequence`

#### Chat Processing

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat/process` | Process chat message (full response) |
| POST | `/chat/enhanced/process` | Same as above (alias) |
| POST | `/chat/process-simple` | Simple chat processing |

**POST /chat/process**
```json
// Request
{
  "message": "What is the oil capacity?",
  "threadId": "uuid",
  "thread_id": "uuid"  // Alternative
}

// Response
{
  "success": true,
  "data": {
    "sessionId": "uuid",
    "threadId": "uuid",
    "userMessage": {
      "id": "uuid",
      "content": "What is the oil capacity?",
      "role": "user",
      "createdAt": "2025-12-10T..."
    },
    "assistantMessage": {
      "id": "uuid",
      "content": "The oil capacity is...",
      "role": "assistant",
      "createdAt": "2025-12-10T...",
      "sources": [...]
    },
    "systemsContext": [...],
    "sources": [...],
    "telemetry": {
      "retrievalMeta": {
        "specBiasMeta": {...},
        "styleDetected": "technical",
        "temperature": 0,
        "model": "gpt-4o"
      }
    }
  },
  "timestamp": "2025-12-10T..."
}
```

#### History & Navigation

| Method | Path | Description |
|--------|------|-------------|
| GET | `/chat/history` | Get message history |
| GET | `/chat/list` | List chat threads |
| GET | `/chat/context` | Get conversation context |
| GET | `/chat/thread/:sessionId` | Get threads for session |
| DELETE | `/chat/delete` | Delete session (body) |
| DELETE | `/chat/:sessionId` | Delete session (path) |

**GET /chat/list**
- Query params: `limit`, `cursor`
```json
// Response
{
  "success": true,
  "data": {
    "chats": [
      {
        "id": "uuid",
        "name": "Chat Name",
        "description": "Preview...",
        "latestThread": { "id": "uuid" }
      }
    ]
  }
}
```

---

### Admin Endpoints

Base path: `/admin/api`
**Requires:** `x-admin-token` header

#### Health & Status

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/health` | System health status |
| GET | `/admin/api/health/connectivity` | Database connectivity check |

#### Systems Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/systems` | List all systems |
| GET | `/admin/api/systems/lookup` | Lookup by manufacturer/model |
| GET | `/admin/api/systems/minimal` | Minimal system data |

**GET /admin/api/systems**
- Query params: `limit`, `offset`, `status`

**GET /admin/api/systems/lookup**
- Query params: `manufacturer` (required), `model` (required)

#### Logs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/logs` | Get logs with filters |
| GET | `/admin/api/logs/stream` | Stream logs from source |
| GET | `/admin/api/logs/metadata` | Get available log metadata |

**GET /admin/api/logs**
- Query params: `level`, `service`, `module`, `correlationId`, `limit`, `search`

#### Equipment Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/manufacturers` | List manufacturers |
| GET | `/admin/api/models` | List models |

#### Pinecone / Vector Operations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/pinecone` | Pinecone status/stats |
| GET | `/admin/api/pinecone-admin/models` | Models with chunk counts |
| POST | `/admin/api/pinecone-admin/chunks` | Get chunks for model |
| DELETE | `/admin/api/pinecone-admin/chunks` | Delete chunks by IDs |

**POST /admin/api/pinecone-admin/chunks**
```json
{ "model": "Model Name" }
```

**DELETE /admin/api/pinecone-admin/chunks**
```json
{ "vectorIds": ["id1", "id2"] }
```

#### Metrics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/metrics` | Aggregated metrics |
| GET | `/admin/api/metrics/fuzzy` | Fuzzy matching metrics |

**GET /admin/api/metrics**
- Query params: `timeframe` (5m, 15m, 1h, 24h), `limit`

#### Document Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/docs/documents` | List documents |
| GET | `/admin/api/docs/documents/:docId` | Get document details |
| POST | `/admin/api/docs/ingest` | Create ingest job |
| GET | `/admin/api/docs/jobs` | List ingest jobs |
| GET | `/admin/api/docs/jobs/:jobId` | Get job status |

**POST /admin/api/docs/ingest**
- Content-Type: `multipart/form-data`
- Fields: `file` (PDF), `metadata` (JSON)

#### Document Deletion

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/documents/:docId/deletion-preview` | Preview deletion |
| DELETE | `/admin/api/documents/:docId` | Execute deletion |

**DELETE /admin/api/documents/:docId**
```json
{
  "deletionOptions": {...},
  "confirmation": "doc_id_here",
  "reason": "Reason for deletion"
}
```

#### Document Ingest (v5)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/api/documents/:docId/upload-pdf` | Upload PDF to storage, create document row |
| POST | `/admin/api/documents/:docId/dip` | Trigger DIP extraction |
| POST | `/admin/api/documents/:docId/dip/run` | Start DIP with SSE streaming |
| GET | `/admin/api/documents/dip/stream/:dipRunId` | SSE stream for DIP progress |

#### Reference Data

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/system-management/ref/manufacturers` | List manufacturers |
| GET | `/api/system-management/ref/product-types` | List product types |
| GET | `/api/system-management/ref/categories` | List system categories |
| GET | `/api/system-management/ref/subcategories` | List subsystem categories (filterable) |

#### Funnel Statistics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/funnel/stats` | Full pipeline funnel statistics |

#### Suggestions (DIP)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/suggestions/pending` | Get pending suggestions |
| POST | `/admin/api/suggestions/approve` | Approve suggestions |

**POST /admin/api/suggestions/approve**
```json
{
  "docId": "doc_id",
  "approved": {
    "spec_suggestions": ["id1"],
    "playbook_hints": ["id2"],
    "intent_router": ["id3"],
    "golden_tests": ["id4"]
  }
}
```

#### Testing & QA

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/testing/dashboard` | Staging dashboard |
| GET | `/admin/api/testing/:table` | Get staging table data |
| POST | `/admin/api/testing/:table/approve` | Approve items |
| POST | `/admin/api/testing/:table/decline` | Decline items |

#### Golden Tests

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/golden-tests/pending` | Get pending tests |
| POST | `/admin/api/golden-tests/:id/approve` | Approve test |
| POST | `/admin/api/golden-tests/:id/reject` | Reject test |
| POST | `/admin/api/golden-tests/approve` | Bulk approve |

#### Playbooks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/playbooks` | Get all playbook hints |
| GET | `/admin/api/playbooks/stats` | Get statistics |
| GET | `/admin/api/playbooks/:playbookId` | Get specific playbook |

#### Jobs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/jobs` | List all jobs |
| GET | `/admin/api/jobs/queue` | Jobs in queue |
| GET | `/admin/api/jobs/:jobId` | Get job details |
| POST | `/admin/api/jobs/process-next` | Trigger next job |
| GET | `/admin/api/jobs/status` | Processor status |

#### Maintenance Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/maintenance/tasks` | Get pending tasks |
| GET | `/admin/api/maintenance/stats` | Get statistics |
| POST | `/admin/api/maintenance/tasks/:id/approve` | Approve task |
| POST | `/admin/api/maintenance/tasks/:id/reject` | Reject task |
| GET | `/admin/api/maintenance-tasks/list` | All tasks |
| PATCH | `/admin/api/maintenance-tasks/:taskId` | Update task |
| DELETE | `/admin/api/maintenance-tasks/:taskId` | Delete task |
| POST | `/admin/api/maintenance-tasks/bulk-update-status` | Bulk update |

#### Anchor Watch

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/anchor-watch/status` | Get status |
| GET | `/admin/api/anchor-watch/positions` | Get positions |
| POST | `/admin/api/anchor-watch/infer` | Calculate centroid |
| POST | `/admin/api/anchor-watch/activate` | Activate watch |
| POST | `/admin/api/anchor-watch/deactivate` | Deactivate watch |
| PUT | `/admin/api/anchor-watch/radius` | Update radius |

**POST /admin/api/anchor-watch/activate**
```json
{
  "latitude": 38.5,
  "longitude": -123.5,
  "radius_meters": 50
}
```

#### Telemetry

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/telemetry/current` | Current telemetry |
| GET | `/admin/api/telemetry/battery` | Battery info |
| GET | `/admin/api/telemetry/solar` | Solar charger info |
| GET | `/admin/api/telemetry/tanks` | Tank levels |

#### Text Extraction

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/text-extraction/metrics` | Extraction metrics |
| GET | `/admin/api/text-extraction/cache` | Cache statistics |
| DELETE | `/admin/api/text-extraction/cache` | Clear cache |
| GET | `/admin/api/text-extraction/health` | Health status |

#### Test Results

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/test-results` | Recent test results |
| GET | `/admin/api/test-results/history` | Last 7 days |
| GET | `/admin/api/test-results/:runId` | Specific run |
| POST | `/admin/api/test-results/trigger` | Manual trigger |

#### Duplicate Review

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/duplicate-review/candidates` | Get candidates |
| POST | `/admin/api/duplicate-review/decision` | Submit decision |
| GET | `/admin/api/duplicate-review/stats` | Get statistics |

---

### Supplies Endpoints

Base path: `/api/supplies`

#### List & Search

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/supplies` | List supplies |
| GET | `/api/supplies/search` | Full-text search |
| GET | `/api/supplies/low-stock` | Low stock items |
| GET | `/api/supplies/category/:categoryId` | By category |
| GET | `/api/supplies/system/:assetUid` | By system |
| GET | `/api/supplies/systems` | All boat systems |
| GET | `/api/supplies/:id` | Single supply |

**GET /api/supplies**
- Query params: `limit`, `offset`, `categoryId`, `location`, `systemAssetUid`, `lowStock`, `itemType`, `orderBy`, `ascending`

#### CRUD Operations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/supplies` | Create supply |
| PUT | `/api/supplies/:id` | Update supply |
| DELETE | `/api/supplies/:id` | Delete supply |

#### Photo & AI Analysis

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/supplies/analyze-photo` | Analyze with GPT-4V |
| POST | `/api/supplies/suggest-systems` | Suggest boat systems |
| POST | `/api/supplies/upload-photo` | Upload photo (legacy) |
| POST | `/api/supplies/:id/photo` | Upload to Supabase |

**POST /api/supplies/analyze-photo**
```json
{ "imageBase64": "base64_data" }
// or
{ "photoUrl": "https://..." }
```

#### Configuration

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/supplies/config/categories` | List categories |
| POST | `/api/supplies/config/categories` | Create category |
| PUT | `/api/supplies/config/categories/:id` | Update category |
| DELETE | `/api/supplies/config/categories/:id` | Delete category |
| GET | `/api/supplies/config/units` | List units |
| POST | `/api/supplies/config/units` | Create unit |
| PUT | `/api/supplies/config/units/:id` | Update unit |
| DELETE | `/api/supplies/config/units/:id` | Delete unit |
| GET | `/api/supplies/config/locations` | List locations |
| POST | `/api/supplies/config/locations` | Create location |
| PUT | `/api/supplies/config/locations/:id` | Update location |
| DELETE | `/api/supplies/config/locations/:id` | Delete location |

---

### Trips Endpoints

Base path: `/api/trips`

#### Trip Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/trips` | List trips |
| GET | `/api/trips/active` | Get active trip |
| GET | `/api/trips/:id` | Get single trip |
| GET | `/api/trips/:id/stats` | Live stats |
| POST | `/api/trips/start` | Start new trip |
| POST | `/api/trips/:id/stop` | Stop trip |
| POST | `/api/trips/:id/resume` | Resume trip |
| PATCH | `/api/trips/:id` | Update trip |
| DELETE | `/api/trips/:id` | Delete trip |

**GET /api/trips**
- Query params: `status`, `limit`, `offset`

#### Sail Events & Telemetry

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/trips/:id/sail-events` | Get sail events |
| POST | `/api/trips/:id/sail-event` | Record sail change |
| GET | `/api/trips/:id/sail-config` | Current sail config |
| GET | `/api/trips/:id/telemetry-samples` | Telemetry data |

**POST /api/trips/:id/sail-event**
```json
{
  "main_sail": "full",
  "jib": true,
  "code_zero": false,
  "asym_spinnaker": false,
  "notes": "Light winds"
}
```

#### Comments

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/trips/:id/comments` | Add comment |
| GET | `/api/trips/:id/comments` | Get comments |
| DELETE | `/api/trips/:id/comments/:commentId` | Delete comment |

#### Administration

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/trips/regenerate-titles` | Regenerate all trip titles with updated geocoding |
| POST | `/api/trips/collect-weather` | Manually trigger weather collection |

**POST /api/trips/regenerate-titles**

Regenerates titles for all completed trips using the shared nominatim utility. Returns list of updated trips with old and new titles.

---

### Season Recap Endpoints

Base path: `/api/season-recap`

AI-generated sailing season summaries using OpenAI.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/season-recap` | Get all recaps (boring, exciting, unhinged) |
| GET | `/api/season-recap/:style` | Get specific recap |
| POST | `/api/season-recap/:style/generate` | Generate new recap |

**GET /api/season-recap**

Returns all stored recaps:
```json
{
  "success": true,
  "data": {
    "boring": { "id": "...", "content": "<h2>...</h2>", "generated_at": "..." },
    "exciting": { "id": "...", "content": "<h2>...</h2>", "generated_at": "..." },
    "unhinged": { "id": "...", "content": "<h2>...</h2>", "generated_at": "..." }
  }
}
```

**POST /api/season-recap/:style/generate**

Generates a new recap using OpenAI. Style must be `boring`, `exciting`, or `unhinged`.

| Style | Description |
|-------|-------------|
| `boring` | Factual, technical, detailed statistics |
| `exciting` | Dramatic, adventure narrative |
| `unhinged` | Over-the-top legendary tale with Caribbean flavor, maximum verbosity |

Returns generated HTML content with metadata (trips count, anchorages count, model used).

---

### Boat Now Endpoints

Base path: `/api/boat-now`

Current boat status with position, weather, and historical data.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/boat-now` | Get current status + 5-hour history |

**GET /api/boat-now**

Query params: `hours` (optional, default 5)

Returns:
- Current position (from gps_position)
- Place name (from Nominatim)
- Current weather (from Open-Meteo)
- 5-hour history of wind speed, wind direction, lat/lon

```json
{
  "success": true,
  "data": {
    "hasData": true,
    "current": {
      "position": { "latitude": 17.07, "longitude": -61.88, "timestamp": "..." },
      "placeName": "Jolly Harbour, Antigua and Barbuda",
      "weather": {
        "temperature_c": 27.5,
        "wind_speed_kts": 12.3,
        "wind_direction": 95,
        "wave_height_m": 1.2
      }
    },
    "history": {
      "pointCount": 150,
      "data": {
        "timestamps": [...],
        "windSpeed": [...],
        "windDirection": [...],
        "latitude": [...],
        "longitude": [...]
      }
    }
  }
}
```

---

## Python Sidecar (Port 8000)

### Health & Version

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/version` | Version info |

**GET /health**
```json
{
  "status": "healthy",
  "tesseract_available": true,
  "llamaparse_available": true,
  "version": "1.0.0",
  "timestamp": "2025-12-10T..."
}
```

### Pinecone Operations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/pinecone/stats` | Index statistics |
| POST | `/v1/pinecone/search` | Search vectors |
| POST | `/v1/pinecone/delete` | Delete vectors |

**POST /v1/pinecone/search**
```json
// Request
{
  "query": "search text",
  "topK": 10,
  "namespace": "REIMAGINEDDOCS",
  "filter": {},
  "includeMetadata": true,
  "includeValues": false
}

// Response
{
  "success": true,
  "matches": [
    {
      "id": "chunk_id",
      "score": 0.95,
      "metadata": {...}
    }
  ]
}
```

### PDF Parsing

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/parse` | Parse PDF (multipart) |
| POST | `/v1/parse-url` | Parse PDF from URL |

**POST /v1/parse**
- Content-Type: `multipart/form-data`
- Fields: `file`, `extract_tables` (bool), `ocr_enabled` (bool)

```json
// Response
{
  "success": true,
  "filename": "manual.pdf",
  "pages_total": 50,
  "pages_parsed": 50,
  "pages_ocr": 2,
  "tables_found": 15,
  "elements": [
    {
      "page": 1,
      "element_type": "text",
      "content": "...",
      "bbox": {"x0": 0, "y0": 0, "x1": 100, "y1": 100},
      "has_text_layer": true,
      "ocr_used": false
    }
  ],
  "tables": [...],
  "processing_time": 5.2,
  "parser_version": "1.0.0"
}
```

### Embeddings

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/embed` | Generate embedding |
| POST | `/v1/upsert` | Upsert to Pinecone |

**POST /v1/embed**
```json
// Request
{
  "text": "Text to embed",
  "metadata": {}
}

// Response
{
  "success": true,
  "embedding_id": "uuid",
  "vector": [0.1, 0.2, ...],
  "processing_time": 0.5
}
```

### Document Processing

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/process-document` | Full document pipeline |

**POST /v1/process-document**
- Content-Type: `multipart/form-data`
- Fields: `file`, `doc_metadata` (JSON), `extract_tables`, `ocr_enabled`

```json
// Response
{
  "success": true,
  "filename": "manual.pdf",
  "chunks_processed": 150,
  "vectors_upserted": 150,
  "chunks_written_db": 150,
  "namespace": "REIMAGINEDDOCS",
  "chunking_strategy": "semantic_v2",
  "processing_time": 45.2
}
```

### Chat Processing

**Requires:** `CHAT_MODULE_ENABLED=true`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/process` | Process chat query |
| GET | `/v1/chat/health` | Chat module health |

**POST /v1/chat/process**
```json
// Request
{
  "query": "What is the oil capacity?",
  "thread_id": "uuid",
  "systems_context": [
    {"asset_uid": "uuid", "manufacturer": "Yanmar", "model": "4JH45"}
  ],
  "conversation_summary": "Previous context...",
  "table_types": ["spec", "procedure"]
}

// Response
{
  "response": "The oil capacity for the Yanmar 4JH45 is...",
  "thread_id": "uuid",
  "sources": [
    {
      "title": "Yanmar Manual",
      "content": "...",
      "page": 45,
      "confidence": 0.95
    }
  ],
  "score": {
    "total_score": 85,
    "confidence": "high",
    "confidence_emoji": "🟢",
    "reasoning": "..."
  },
  "classification": {
    "primary": "specification",
    "confidence": 0.92,
    "table_types": ["spec"],
    "equipment_context": {"manufacturer": "Yanmar"}
  },
  "processing_time_ms": 2500
}
```

### LlamaParse (v5)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/llamaparse` | Parse PDF via LlamaParse cloud API |

### Model Detection (v5)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/detect-models` | Detect models in parsed document |

### Vision Analysis (v5)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/vision/analyze-pages` | Layout analysis for figures/tables |
| POST | `/v1/vision/crop-figures` | Crop figures from page images |

### DIP Extraction (v5 - SSE Streaming)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/dip/run` | DIP extraction with streaming progress |

### Document Indexing (v5)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/index-document` | Index document with v5 chunk metadata |

---

## Maintenance Agent (Port 3001)

### Maintenance Agent HTTP Endpoints

Base path: `/admin/api` (requires `x-admin-token`)

#### System Maintenance

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/system-maintenance` | Get all systems |
| GET | `/admin/api/system-maintenance/:assetUid` | Get system state |
| POST | `/admin/api/system-maintenance/:assetUid/hours` | Update hours |
| GET | `/admin/api/system-maintenance/:assetUid/hours/history` | Hours history |
| GET | `/admin/api/system-maintenance/:assetUid/hours/statistics` | Statistics |
| POST | `/admin/api/system-maintenance/:assetUid/hours/validate` | Validate update |
| GET | `/admin/api/system-maintenance/stale-hours` | Stale systems |
| GET | `/admin/api/system-maintenance/summary` | Summary |

**POST /admin/api/system-maintenance/:assetUid/hours**
```json
{
  "hours": 1500,
  "notes": "Annual service",
  "meterReplaced": false,
  "submittedBy": "user"
}
```

#### Task Completions

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/api/task-completions` | Record completion |
| GET | `/admin/api/task-completions/task/:taskId/system/:assetUid/history` | History |

#### BoatOS Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/boatos-tasks/due` | Get due tasks |
| GET | `/admin/api/boatos-tasks/statistics` | Statistics |
| POST | `/admin/api/boatos-tasks/:taskId/complete` | Complete task |
| POST | `/admin/api/boatos-tasks/:taskId/dismiss` | Dismiss task |
| POST | `/admin/api/boatos-tasks/create/:assetUid` | Create task |

#### To-Do

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/todo` | Get all todos |
| GET | `/admin/api/todo/statistics` | Statistics |

#### Maintenance Tasks (Approval)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/maintenance-tasks/pending` | Pending tasks |
| GET | `/admin/api/maintenance-tasks/pending-count` | Pending count |
| GET | `/admin/api/maintenance-tasks/approval-stats` | Approval stats |
| POST | `/admin/api/maintenance-tasks/:taskId/approve` | Approve |
| POST | `/admin/api/maintenance-tasks/:taskId/reject` | Reject |
| POST | `/admin/api/maintenance-tasks/bulk-approve` | Bulk approve |
| POST | `/admin/api/maintenance-tasks/bulk-reject` | Bulk reject |
| GET | `/admin/api/maintenance-tasks/list` | All tasks |
| PATCH | `/admin/api/maintenance-tasks/:taskId` | Update task |
| DELETE | `/admin/api/maintenance-tasks/:taskId` | Delete task |

#### User Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/user-tasks` | Get user tasks |
| GET | `/admin/api/user-tasks/:taskId` | Get single task |
| POST | `/admin/api/user-tasks` | Create task |
| PATCH | `/admin/api/user-tasks/:taskId` | Update task |
| POST | `/admin/api/user-tasks/:taskId/complete` | Complete |
| POST | `/admin/api/user-tasks/:taskId/reschedule` | Reschedule |
| DELETE | `/admin/api/user-tasks/:taskId` | Delete task |

**POST /admin/api/user-tasks**
```json
{
  "description": "Change engine oil",
  "due_date": "2025-12-31T...",
  "asset_uid": "uuid",
  "is_recurring": true,
  "recurrence_interval": "monthly"
}
```

#### Deduplication Review

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/dedup-reviews/stats` | Statistics |
| GET | `/admin/api/dedup-reviews/pending` | Pending reviews |
| GET | `/admin/api/dedup-reviews/systems` | Systems in review |
| GET | `/admin/api/dedup-reviews/analyses` | Analysis runs |
| GET | `/admin/api/dedup-reviews/analyses/:analysisId` | Specific analysis |
| GET | `/admin/api/dedup-reviews/pending-commits` | Unexecuted decisions |
| POST | `/admin/api/dedup-reviews/execute` | Execute decisions |
| GET | `/admin/api/dedup-reviews/:reviewId` | Get review |
| PATCH | `/admin/api/dedup-reviews/:reviewId/status` | Update status |
| POST | `/admin/api/dedup-reviews/bulk-update` | Bulk update |

**PATCH /admin/api/dedup-reviews/:reviewId/status**
```json
{
  "status": "keep_both",
  "notes": "Different maintenance intervals",
  "reviewedBy": "user"
}
```

Status values: `pending`, `keep_both`, `merge`, `delete_task1`, `delete_task2`, `delete_both`

#### Pipeline Processing

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/pipeline/systems` | Systems with status |
| GET | `/admin/api/pipeline/systems/:assetUid` | System detail |
| POST | `/admin/api/pipeline/process` | Start processing |
| GET | `/admin/api/pipeline/runs` | Run history |
| POST | `/admin/api/pipeline/check-and-advance/:assetUid` | Advance pipeline |
| POST | `/admin/api/pipeline/mark-review-complete/:assetUid` | Mark complete |

**POST /admin/api/pipeline/process**
```json
{
  "systems": ["asset_uid_1", "asset_uid_2"]
}
```

#### Weather (Public)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/weather/areas` | List weather areas |
| GET | `/api/weather/areas/:id` | Get area |
| POST | `/api/weather/areas` | Create area |
| PUT | `/api/weather/areas/:id` | Update area |
| DELETE | `/api/weather/areas/:id` | Delete area |
| GET | `/api/weather/areas/:id/forecast` | Forecast |
| GET | `/api/weather/areas/:id/current` | Current conditions |
| GET | `/api/weather/areas/:id/7day` | 7-day forecast |
| POST | `/api/weather/areas/:id/fetch` | Trigger fetch |
| GET | `/api/weather/credits` | Meteoblue credits |

---

### WebSocket API

**URL:** `ws://localhost:3001/api/ws`

#### Client → Server Messages

**Subscribe to run:**
```json
{
  "type": "subscribe_run",
  "runId": "uuid"
}
```

**Unsubscribe:**
```json
{
  "type": "unsubscribe_run",
  "runId": "uuid"
}
```

**Ping:**
```json
{ "type": "ping" }
```

#### Server → Client Messages

**Connection established:**
```json
{
  "type": "connection_established",
  "clientId": "abc123",
  "serverTime": "2025-12-10T..."
}
```

**Processing started:**
```json
{
  "type": "processing_started",
  "runId": "uuid",
  "assetUid": "uuid",
  "systemName": "Yanmar 4JH45"
}
```

**Step started:**
```json
{
  "type": "step_started",
  "runId": "uuid",
  "step": "step1_extract",
  "stepNumber": 1,
  "totalSteps": 6
}
```

**Progress update:**
```json
{
  "type": "progress_update",
  "runId": "uuid",
  "step": "step1_extract",
  "progress": 45,
  "message": "Processing item 45 of 100"
}
```

**Step completed:**
```json
{
  "type": "step_completed",
  "runId": "uuid",
  "step": "step1_extract",
  "result": {...},
  "duration": 5000
}
```

**Manual review required:**
```json
{
  "type": "manual_review_required",
  "runId": "uuid",
  "step": "step5_dedupe_review",
  "message": "Duplicate review required"
}
```

**Processing complete:**
```json
{
  "type": "processing_complete",
  "runId": "uuid",
  "assetUid": "uuid",
  "totalDuration": 45000,
  "stepsCompleted": 6
}
```

---

## Response Formats

### Standard Success Response

```json
{
  "success": true,
  "data": {
    // Endpoint-specific data
  },
  "timestamp": "2025-12-10T...",
  "requestId": "req_abc123"
}
```

### Paginated Response

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 250,
    "pages": 5
  }
}
```

### List Response (Alternative)

```json
{
  "success": true,
  "data": {
    "items": [...],
    "count": 25
  }
}
```

---

## Error Handling

### Error Response Format

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "requestId": "req_abc123"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden |
| 404 | Not Found |
| 500 | Internal Server Error |

### Common Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Request body/params failed validation |
| `NOT_FOUND` | Resource not found |
| `UNAUTHORIZED` | Authentication required |
| `FORBIDDEN` | Insufficient permissions |
| `INTERNAL_ERROR` | Server error |
| `TIMEOUT` | Request timeout |

---

## Model Configuration

Environment variables controlling AI model selection:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_MODEL` | `gpt-5.1-chat-latest` | Primary chat/completion model |
| `OPENAI_SUMMARY_MODEL` | `gpt-4.1-mini` | Summarization model |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Anthropic model (where used) |
| `VISION_MODEL` | `gpt-4o` | Vision analysis model |
| `LLAMA_CLOUD_API_KEY` | — | LlamaParse API key (required for v5 ingest) |

---

## Quick Reference: Endpoint Counts

| Service | Public | Admin | Total |
|---------|--------|-------|-------|
| Node.js Main | ~40 | ~60 | ~100 |
| Python Sidecar | ~20 | 0 | ~20 |
| Maintenance Agent | ~10 | ~50 | ~60 |
| **Total** | **~70** | **~110** | **~180** |

---

*Document auto-generated from codebase analysis*

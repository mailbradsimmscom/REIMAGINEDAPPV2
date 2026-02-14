# Documents (v5 Ingestion Pipeline)

## Overview

Documents are technical manuals (PDFs) that provide the knowledge base for AI chat. The v5 pipeline uses LlamaParse for PDF parsing, GPT-4.1-mini for model detection, LlamaParse layout data for vision/figure extraction, and Anthropic Claude for DIP extraction. Documents are chunked with rich model-aware metadata and stored in Pinecone for semantic search.

**Who uses it:** Administrators
**Access:** Document Ingest (`/ingest`)

---

## User Flow

### Ingesting a Document (v5 Pipeline)

```
+-------------------------------------------------------------------+
|  1. Navigate to Document Ingest page                              |
|     (/public/document-ingest.html)                                |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|  2. Upload + Background Parse & Detect (v5.2)                     |
|     +-- POST /admin/api/documents/upload-and-parse                |
|     +-- Generate doc_id from SHA256 hash of file content          |
|     +-- Store at documents/manuals/{doc_id}/{filename}.pdf        |
|     +-- Create initial document row (with filename)               |
|     +-- Start background job (job_type='v5_parse_detect')         |
|     +-- Returns immediately: { doc_id, job_id, status_v2 }       |
|     +-- USER CAN NAVIGATE AWAY                                    |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|  3. Background Parse + Detect (server-side, browser-independent)  |
|     +-- Downloads PDF from Supabase Storage                       |
|     +-- Parse via LlamaParse (status_v2='parsing')                |
|     +-- Detect models via GPT-4.1-mini (status_v2='detecting')   |
|     +-- Stores detection_result JSONB on documents table          |
|     +-- Creates user todo: "Review model selection for {filename}"|
|     +-- status_v2='detection_complete' when done                  |
|     +-- Heartbeat every 30s (same as ingest runner)               |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|  4. Model Selection (via todo link or direct URL)                 |
|     +-- User clicks todo → /ingest?doc_id=xxx                    |
|     +-- Detection results loaded from documents.detection_result  |
|     +-- User selects installed primary models                     |
|     +-- User confirms/deselects referenced products               |
|     +-- POST /admin/api/documents (confirms selection)            |
|     +-- Creates system, instances, document_systems links         |
|     +-- Auto-completes detection todo                             |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|  6. Vision Analysis (automatic)                                   |
|     +-- POST /admin/api/documents/:docId/vision                   |
|     +-- Uses LlamaParse layout data to detect figures/tables      |
|     +-- Crops figures/diagrams from PDF pages                     |
|     +-- Uploads cropped images to Supabase Storage                |
|     +-- Upserts asset records to doc_assets table                 |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|  7. Indexing + DIP (concurrent via Promise.allSettled)             |
|                                                                   |
|     INDEXING (Chunking + Embedding):                              |
|     +-- POST /admin/api/documents/:docId/index                    |
|     +-- High-recall chunking: ~80-250 chunks per 70-page manual   |
|     +-- Chunks tagged with applies_to_models[], search_blob       |
|     +-- Embed with text-embedding-3-large (3072 dimensions)       |
|     +-- Upsert to Pinecone (namespace: REIMAGINEDDOCS)            |
|     +-- Colloquial keyword extraction (post-index)                |
|                                                                   |
|     DIP EXTRACTION (concurrent with indexing):                    |
|     +-- POST /admin/api/documents/:docId/dip/run (start)          |
|     +-- GET /admin/api/documents/dip/stream/:runId (SSE stream)   |
|     +-- 5 categories, all-parallel after specs warmup              |
|     +-- Anthropic Claude with prompt caching                      |
|     +-- Writes directly to production tables (no staging)         |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|  8. Document ready for search                                     |
|     +-- Status: completed                                         |
|     +-- Searchable in Pinecone with model-aware filtering         |
+-------------------------------------------------------------------+

### Background Parse+Detect Mode (v5.2)

Upload starts a **background parse+detect job** that runs LlamaParse and model detection server-side. The user can navigate away immediately after upload:

```
+-------------------------------------------------------------------+
|  Upload + Background Parse & Detect                               |
|     +-- POST /admin/api/documents/upload-and-parse                |
|     +-- Creates job with job_type='v5_parse_detect'               |
|     +-- Returns immediately with { doc_id, job_id, status_v2 }    |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|  Background Runner (server-side, browser-independent)             |
|     +-- Download PDF → LlamaParse → detect-models-v2              |
|     +-- Updates jobs.status_v2 at each stage transition           |
|     +-- Heartbeat every 30s (jobs.last_heartbeat)                 |
|     +-- Stores detection_result on documents table                |
|     +-- Creates user_tasks todo on completion or failure          |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|  User Returns via Todo or URL                                     |
|     +-- /ingest?doc_id=xxx → review detected models               |
|     +-- /ingest?doc_id=xxx&view=summary → see completed ingest    |
|     +-- /ingest?doc_id=xxx&view=retry → retry failed ingest       |
+-------------------------------------------------------------------+
```

**status_v2 values for v5_parse_detect jobs:**
```
queued → parsing → parse_complete → detecting → detection_complete | failed
```

**User Todos:**
- `detection_complete` → "Review model selection for {filename}" → links to `/ingest?doc_id=xxx`
- `failed` → "Parse/detect failed for {filename}" → links to `/ingest?doc_id=xxx&view=retry`

### Background Ingest Mode (v5.1)

The confirm step can start a **background job** that runs Vision, Indexing, and DIP on the server even if the browser disconnects:

```
+-------------------------------------------------------------------+
|  5. Model Selection + Background Job Start                        |
|     +-- POST /admin/api/documents (with start_background_run=true)|
|     +-- Creates job with job_type='v5_ingest'                     |
|     +-- Returns immediately with { job_id, doc_id, status_v2 }    |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|  6-7. Background Runner (server-side, browser-independent)        |
|     +-- Vision → Indexing → DIP (sequential)                      |
|     +-- Updates jobs.status_v2 at each stage transition           |
|     +-- Updates jobs.counters with per-stage metrics              |
|     +-- Heartbeat every 30s (jobs.last_heartbeat)                 |
|     +-- Browser can disconnect; job keeps running                 |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|  8. Frontend Polling                                              |
|     +-- GET /admin/api/documents/:docId/ingest-status (every 5s)  |
|     +-- UI updates based on status_v2 and counters                |
|     +-- On page reload: resume banner if job is running           |
|     +-- localStorage stores { doc_id, job_id } for resume         |
+-------------------------------------------------------------------+
```

**Status Flow (status_v2):**
```
queued → vision_running → vision_completed/vision_warning
       → indexing_running → indexing_completed/indexing_failed
       → dip_running → dip_partial → completed/failed
```

**Key Benefits:**
- Close browser mid-ingest without losing progress
- Reopen page to see current status or completed result
- Manual /vision, /index, /dip endpoints rejected if background job is active

### Heartbeat & Staleness Detection

The background runner updates `jobs.last_heartbeat` every 30 seconds. The `/ingest-status` endpoint checks this to detect stale jobs:

- **Stale threshold:** 5 minutes without heartbeat update
- **Response includes:** `is_stale: true` if job appears hung
- **Use case:** UI can warn user or offer manual intervention

### Counters Schema

The `jobs.counters` JSONB field tracks per-stage metrics:

```json
{
  "vision": {
    "pages_analyzed": 24,
    "figures_cropped": 8,
    "tables_cropped": 4,
    "assets_saved": 12,
    "duration_ms": 120000,
    "warning": null
  },
  "indexing": {
    "chunks_created": 180,
    "chunks_skipped": 0,
    "vectors_upserted": 180,
    "total_tokens": 45000,
    "duration_ms": 90000
  },
  "dip": {
    "modes_completed": ["specs", "troubleshooting", "procedures"],
    "modes_failed": [{"mode": "golden_rules", "error": "timeout"}],
    "modes_pending": [],
    "total_inserted": 145,
    "cache_tokens": {"creation": 50000, "read": 120000},
    "duration_ms": 300000
  },
  "error": null
}
```

### Manual Endpoint Behavior

When a background `v5_ingest` **or** `v5_parse_detect` job is active for a document, manual calls to these endpoints return **409 Conflict**:

- `POST /admin/api/documents/:docId/vision`
- `POST /admin/api/documents/:docId/index`
- `POST /admin/api/documents/:docId/dip`

Response includes `job_id` and `status_v2` of the active job so the UI can redirect to status polling.

**Parse-detect guard (v5.2):** Vision and index endpoints additionally check for active `v5_parse_detect` jobs and return 409 with code `ACTIVE_PARSE_DETECT_JOB` if parse/detect is still running.

### Resume on Page Reload

The frontend stores `{ doc_id, job_id, started_at }` in localStorage. On page load:

1. Check localStorage for saved state
2. Poll `/ingest-status` to verify job exists and is running
3. If running and not stale: show resume banner
4. If completed/failed: clear localStorage, show result
5. User can click "Resume" to watch progress or "Dismiss" to start fresh

---

## Key Concepts

| Term | Definition |
|------|------------|
| **Document** | Uploaded PDF file (technical manual) |
| **doc_id** | SHA256 hash of file content (deterministic, deduplicates uploads) |
| **Chunk** | Section of document with v5 metadata (applies_to_models, search_blob, etc.) |
| **Embedding** | 3072-dimensional vector (text-embedding-3-large) |
| **DIP** | Document Intelligence Processing - extracts structured data into 5 production tables |
| **LlamaParse** | Cloud PDF parsing API (replaces pdfplumber/OCR); returns Markdown + layout data |
| **Model Detection** | GPT-4.1-mini analysis of parsed Markdown to identify primary_models and referenced_products |
| **Model Selection** | Blocking UI step where user confirms which detected models are installed on their boat |
| **Vision Pipeline** | Figure/table detection and cropping using LlamaParse layout data |
| **Canonical Model Registry** | ref_canonical_models + ref_model_synonyms tables with normalize_model_key() function |
| **models_covered** | Array of all primary models the document covers (stored on documents row) |
| **selected_models** | Subset of models_covered that the user has installed on their boat |
| **asset_uid** | Equipment this document belongs to (FK to systems) |
| **Namespace** | Pinecone partition: `REIMAGINEDDOCS` |
| **search_blob** | Concatenated searchable text field on each chunk for high-recall retrieval |

---

## Architecture

```
+-------------------------------------------------------------------+
|  Document Ingest UI (document-ingest.html)                        |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|  Node.js Backend                                                  |
|  +-- document-ingest.route.js  (v5 orchestration routes)          |
|  +-- document-ingest.service.js (system creation, model lookup)   |
|  +-- vision-pipeline.service.js (Stage 6-7 orchestration)         |
|  +-- v5-index.service.js       (chunking + Pinecone upsert)       |
|  +-- v5-colloquial.service.js  (colloquial keyword extraction)    |
|  +-- v5-dip.service.js         (DIP extraction orchestration)     |
|  +-- dip-stream.service.js     (callback-based DIP for runner)    |
|  +-- v5-parse-detect-runner.js (background parse+detect runner)   |
|  +-- document.service.js       (legacy upload, storage, jobs)     |
+-------------------------------------------------------------------+
                              |
         +--------------------+--------------------+
         v                    v                    v
+-----------------+  +-----------------+  +-----------------+
|  Supabase       |  |  Python Sidecar |  |  Pinecone       |
|  Storage        |  |  (FastAPI)      |  |                 |
|                 |  |                 |  |  vectors with   |
|  manuals/       |  |  /v1/llamaparse |  |  v5 metadata:   |
|  {docId}/       |  |  /v1/detect-    |  |  - doc_id       |
|  {filename}     |  |    models       |  |  - asset_uid    |
|                 |  |  /v1/vision/    |  |  - applies_to_  |
|                 |  |    analyze-pages|  |    models[]     |
|                 |  |  /v1/vision/    |  |  - search_blob  |
|                 |  |    crop-figures |  |  - is_universal  |
|                 |  |  /v1/dip/run    |  |  - page         |
|                 |  |  /v1/index-     |  |                 |
|                 |  |    document     |  |                 |
+-----------------+  +-----------------+  +-----------------+
                              |
                              v
+-------------------------------------------------------------------+
|  Supabase Production Tables (DIP Output - 5 categories)           |
|  +-- spec_suggestions      (specifications)                       |
|  +-- playbook_hints        (procedures / maintenance)             |
|  +-- intent_router         (Q&A pairs for chat routing)           |
|  +-- golden_tests          (test cases for validation)            |
|  +-- troubleshooting       (troubleshooting guides) [NEW in v5]   |
+-------------------------------------------------------------------+
```

---

## Key Functions

### Document Ingest Route (document-ingest.route.js)

**POST /admin/api/documents/upload-storage** - Upload PDF to Supabase Storage before parsing:
```javascript
// src/routes/admin/document-ingest.route.js
// 1. Stream PDF via Busboy (100MB limit)
// 2. Generate doc_id from SHA256 hash of file content
// 3. Upload to Supabase Storage at manuals/{docId}/{filename}
// 4. Create initial document row (will be updated with full metadata later)
// Returns: { doc_id, storage_path, filename, file_size }
```

**POST /admin/api/documents** - Confirm document with model selection and create systems:
```javascript
// src/routes/admin/document-ingest.route.js
// Document-First Architecture:
// 1. Validate inputs (installed_primary required)
// 2. Look up reference table IDs (manufacturer, product_type, system, subsystem)
// 3. Create document record FIRST (other tables have FK to doc_id)
// 4. Create/find system for primary model
// 5. Create instance(s) (supports multiple serial numbers)
// 6. Create document_systems link (is_primary: true)
// 7. Save referenced systems to document_referenced_systems
// 8. Save detection results (debug data)
```

### Vision Pipeline Service (vision-pipeline.service.js)

**runVisionPipeline** - Orchestrates figure/table extraction:
```javascript
// src/services/vision-pipeline.service.js
// 1. Fetch document to get models_covered
// 2. Call sidecar /v1/vision/analyze-pages (Stage 6)
//    - Uses LlamaParse layout data to detect figures/tables
// 3. Call sidecar /v1/vision/crop-figures (Stage 7)
//    - Crops detected regions from PDF pages
//    - Uploads cropped images to Supabase Storage
// 4. Upsert assets to doc_assets table
// Returns: { pages_analyzed, figures_cropped, tables_cropped, assets_saved, manifest_path }
```

### v5 Index Service (v5-index.service.js)

**runV5Indexing** - Chunk document and store in Pinecone with model tags:
```javascript
// src/services/v5-index.service.js
// 1. Fetch document to get models_covered and filename
// 2. Call sidecar /v1/index-document with:
//    - doc_id, models_covered, selected_models, referenced_selections
// 3. High-recall chunking: ~80-250 chunks per 70-page manual
// 4. Each chunk gets v5 metadata:
//    - applies_to_models[], referenced_systems[], is_universal, search_blob
// 5. Embed with text-embedding-3-large, upsert to Pinecone
// Returns: { chunks_created, vectors_upserted, total_tokens, statistics }
```

### v5 DIP Service (v5-dip.service.js)

**runDipExtraction** - Extract structured data from document:
```javascript
// src/services/v5-dip.service.js
// 5 DIP modes: specs, troubleshooting, procedures, golden_rules, intent_router
// 1. Fetch document to get models_covered
// 2. Call sidecar /v1/dip/run with all params
// 3. Sidecar runs specs warmup then all remaining modes in parallel using Anthropic Claude
// 4. Prompt caching reduces cost for repeated document context
// 5. Writes directly to production tables (no staging/approval)
// Returns: { modes_completed, modes_failed, results, total_extracted, total_inserted }
```

### DIP Stream Service (dip-stream.service.js)

**Callback-based DIP execution for background runner:**
```javascript
// src/services/dip-stream.service.js
// runDipWithCallback(params, onProgress, signal) -> for background runner
//   - Consumes SSE events from sidecar /v1/dip/run internally
//   - Calls onProgress callback with events: mode_started, mode_completed,
//     mode_failed, run_completed, run_failed
//   - Returns: { success, modes_completed, modes_failed, total_inserted }
//   - 30-minute timeout
// Note: SSE infrastructure (storeDipRunParams, streamDipExtraction,
//   pendingRuns Map) removed in v5.2. DIP now runs only via background runner.
```

### v5 Parse+Detect Runner Service (v5-parse-detect-runner.service.js) [v5.2]

**Background orchestration for Parse → Detect → Todo:**
```javascript
// src/services/v5-parse-detect-runner.service.js

// startParseDetectRun({ docId, storagePath, filename })
// 1. Check for existing active parse-detect job (reject if found)
// 2. Create job record with job_type='v5_parse_detect', status_v2='queued'
// 3. Start background execution via setImmediate()
// 4. Return immediately with { job_id, doc_id, status_v2 }

// Background pipeline (runs in setImmediate):
// 1. Start heartbeat interval (30s)
// 2. Download PDF from Supabase Storage
// 3. Parse stage: status_v2='parsing' → LlamaParse → 'parse_complete'
// 4. Detect stage: status_v2='detecting' → detect-models-v2 → 'detection_complete'
// 5. Store detection_result JSONB on documents table (with reference_data snapshot)
// 6. Create user_tasks todo with actionUrl to /ingest?doc_id=xxx

// getParseDetectStatus(docId)
// - Returns latest v5_parse_detect job for document
// - Includes staleness check (is_stale: true if >5 min since heartbeat)
```

### v5 Ingest Runner Service (v5-ingest-runner.service.js) [v5.1]

**Background orchestration for Vision → Indexing → DIP:**
```javascript
// src/services/v5-ingest-runner.service.js

// startIngestRun({ docId, storagePath, selectedModels, ... })
// 1. Check for existing active job (reject if found)
// 2. Create job record with job_type='v5_ingest', status_v2='queued'
// 3. Start background execution via setImmediate()
// 4. Return immediately with { job_id, doc_id, status_v2 }

// Background pipeline (runs in setImmediate):
// 1. Start heartbeat interval (30s)
// 2. Vision stage: status_v2='vision_running' → 'vision_completed'/'vision_warning'
//    - Non-fatal: continues even if vision fails
// 3. Indexing stage: status_v2='indexing_running' → 'indexing_completed'
//    - Fatal: stops pipeline if indexing fails ('indexing_failed')
// 4. DIP stage: status_v2='dip_running' → 'dip_partial'/'completed'
//    - Uses runDipWithCallback() to consume SSE
//    - Partial success OK (some modes can fail)
// 5. Update final status and dip_success flag

// getIngestStatus(docId)
// - Returns latest v5_ingest job for document
// - Includes staleness check (is_stale: true if >5 min since heartbeat)
```

### v5 Colloquial Service (v5-colloquial.service.js)

**runV5ColloquialKeywords** - Extract colloquial keywords post-indexing:
```javascript
// src/services/v5-colloquial.service.js
// Runs AFTER v5 indexing (depends on Pinecone content)
// Updates systems.colloquial_keywords for the installed system
// Also sets systems.Manual_Local_Copy = true
// Non-fatal: document is still searchable if this fails
```

---

## Files & Locations

| Purpose | Path |
|---------|------|
| **Frontend** | |
| Document ingest page (v5) | `src/public/document-ingest.html` (served at `/ingest`) |
| Document library | `src/public/documents.html` |
| **Node.js Routes** | |
| v5 ingest routes | `src/routes/admin/document-ingest.route.js` |
| Legacy document routes | `src/routes/document/` |
| **Node.js Services** | |
| Document ingest service | `src/services/document-ingest.service.js` |
| Vision pipeline | `src/services/vision-pipeline.service.js` |
| v5 indexing (chunk + embed) | `src/services/v5-index.service.js` |
| v5 colloquial keywords | `src/services/v5-colloquial.service.js` |
| v5 DIP extraction | `src/services/v5-dip.service.js` |
| DIP callback runner | `src/services/dip-stream.service.js` |
| **Background ingest runner** | `src/services/v5-ingest-runner.service.js` |
| **Background parse+detect runner** | `src/services/v5-parse-detect-runner.service.js` |
| Legacy document service | `src/services/document.service.js` |
| Document deletion | `src/services/document-deletion.service.js` |
| DIP ingest to DB | `src/services/dip.ingest.service.js` |
| Anthropic extraction | `src/services/anthropic.extraction.service.js` |
| **Python Sidecar** | |
| Main app (all endpoints) | `python-sidecar/app/main.py` |
| Endpoints include: | `/v1/llamaparse`, `/v1/detect-models`, `/v1/vision/analyze-pages`, `/v1/vision/crop-figures`, `/v1/dip/run`, `/v1/index-document` |

---

## API Endpoints

### v5 Ingest Endpoints (document-ingest.route.js)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/api/documents/upload-and-parse` | **[v5.2]** Upload PDF, start background parse+detect, get doc_id + job_id |
| POST | `/admin/api/documents/upload-storage` | Upload PDF to storage only (legacy — use upload-and-parse) |
| POST | `/admin/api/documents` | Confirm document with model selection, create systems/instances |
| GET | `/admin/api/documents/:docId/detection-result` | **[v5.2]** Get stored detection result + doc metadata |
| GET | `/admin/api/documents/:docId/parse-detect-status` | **[v5.2]** Poll parse+detect job status |
| POST | `/admin/api/documents/:docId/vision` | Run vision pipeline (analyze pages, crop figures) |
| GET | `/admin/api/documents/:docId/assets` | Get all extracted assets for a document |
| GET | `/admin/api/documents/:docId/assets/summary` | Get asset count summary |
| POST | `/admin/api/documents/:docId/index` | v5 index: chunk + embed + optional DIP + colloquial |
| POST | `/admin/api/documents/:docId/dip` | v5 DIP extraction (non-streaming) |
| POST | `/admin/api/documents/:docId/timing` | Save ingest timing payload (Phase B) |
| GET | `/admin/api/documents/:docId/timing` | Get all timing runs for a document |
| GET | `/admin/api/documents/:docId/timing/:runId` | Get specific timing run |

### Background Ingest Endpoints (v5.1)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/documents/ingest/active` | List all active v5_ingest jobs |
| GET | `/admin/api/documents/:docId/ingest-status` | Get current ingest job status for a document |
| GET | `/admin/api/documents/:docId/ingest-history` | Get history of ingest jobs for a document |
| POST | `/admin/api/documents/:docId/ingest-retry` | Retry a failed ingest (creates new job) |

#### GET /admin/api/documents/ingest/active

Returns all currently running `v5_ingest` and `v5_parse_detect` jobs across all documents. Useful for admin dashboard or when localStorage is empty.

```json
{
  "success": true,
  "data": {
    "jobs": [
      {
        "job_id": "uuid",
        "doc_id": "abc123...",
        "status_v2": "indexing_running",
        "status": "running",
        "counters": {...},
        "created_at": "2024-01-15T10:00:00Z",
        "started_at": "2024-01-15T10:00:05Z",
        "last_heartbeat": "2024-01-15T10:05:00Z",
        "is_stale": false
      }
    ],
    "count": 1
  }
}
```

#### GET /admin/api/documents/:docId/ingest-status

Returns the latest `v5_ingest` job for the specified document. Primary endpoint for UI polling.

```json
{
  "success": true,
  "data": {
    "doc_id": "abc123...",
    "has_job": true,
    "job_id": "uuid",
    "status_v2": "dip_running",
    "status": "running",
    "counters": {
      "vision": { "pages_analyzed": 24, "assets_saved": 8, "duration_ms": 120000 },
      "indexing": { "chunks_created": 180, "vectors_upserted": 180, "duration_ms": 90000 },
      "dip": { "modes_completed": ["specs"], "modes_pending": ["procedures"], "total_inserted": 45 }
    },
    "error": null,
    "is_stale": false,
    "created_at": "2024-01-15T10:00:00Z",
    "started_at": "2024-01-15T10:00:05Z",
    "completed_at": null,
    "last_heartbeat": "2024-01-15T10:05:00Z"
  }
}
```

If no job exists: `{ "has_job": false, "message": "No ingest job found for this document" }`

#### GET /admin/api/documents/:docId/ingest-history

Returns past `v5_ingest` jobs for a document, ordered by `created_at` descending.

Query params: `?limit=10` (default 10)

```json
{
  "success": true,
  "data": {
    "doc_id": "abc123...",
    "jobs": [
      { "job_id": "uuid1", "status_v2": "completed", "created_at": "...", "completed_at": "..." },
      { "job_id": "uuid2", "status_v2": "failed", "error": {...}, "created_at": "..." }
    ],
    "count": 2
  }
}
```

#### POST /admin/api/documents/:docId/ingest-retry

Creates a new `v5_ingest` job for a document, rerunning Vision → Indexing → DIP. Fails if a job is already active.

```json
// Success
{
  "success": true,
  "data": {
    "job_id": "new-uuid",
    "doc_id": "abc123...",
    "status_v2": "queued",
    "message": "Retry job started"
  }
}

// Error: job already running
{
  "success": false,
  "error": {
    "code": "ACTIVE_JOB_EXISTS",
    "message": "A job is already running for this document",
    "job_id": "existing-uuid",
    "status_v2": "indexing_running"
  }
}
```

### Legacy Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/document/ingest` | Legacy upload endpoint |
| GET | `/document/list` | List documents |
| GET | `/document/:id` | Get document details |
| DELETE | `/document/:id` | Delete document |
| GET | `/document/:id/chunks` | Get document chunks |
| POST | `/admin/api/document-deletion/delete` | Delete with audit |

---

## Database Tables

### documents

| Column | Type | Description |
|--------|------|-------------|
| doc_id | text | **Primary key** (SHA256 hash of file content) |
| manufacturer | text | Raw manufacturer name |
| manufacturer_norm | text | Normalized for matching |
| model | text | Raw model number |
| model_norm | text | Normalized for matching |
| asset_uid | text | FK to systems (primary installed model) |
| system_norm | text | System category |
| subsystem_norm | text | Subsystem category |
| storage_path | text | Supabase Storage path |
| language | text | Document language (default: 'en') |
| last_ingest_version | text | Parser version |
| last_job_id | uuid | FK to jobs |
| **models_covered** | text[] | **[v5]** All primary models detected in the manual |
| **is_multi_model** | boolean | **[v5]** Whether manual covers multiple models |
| **is_oem_manual** | boolean | **[v5]** Whether this is an OEM manual |
| **oem_for_asset_uid** | text | **[v5]** FK to systems if OEM manual |
| **vision_processed** | boolean | **[v5]** Whether vision pipeline has run |
| **vision_processed_at** | timestamp | **[v5]** When vision pipeline completed |
| **page_count** | integer | **[v5]** Total pages in the PDF |
| **figure_count** | integer | **[v5]** Figures/tables extracted by vision |
| **filename** | text | **[v5.2]** Original uploaded filename |
| **detection_result** | jsonb | **[v5.2]** Stored model detection result (primary_models, referenced_products, reference_data snapshot) |
| created_at | timestamp | Upload time |
| updated_at | timestamp | Last update |

### jobs

Document processing job tracking.

| Column | Type | Description |
|--------|------|-------------|
| job_id | uuid | Primary key |
| doc_id | text | FK to documents |
| job_type | text | 'DIP', 'v5_ingest', 'v5_parse_detect', etc. |
| status | text | Legacy status field |
| **status_v2** | text | **[v5]** Stage status (see values below) |
| params | jsonb | Job parameters |
| counters | jsonb | Processing counters (vision, indexing, dip metrics) |
| error | jsonb | Error details if failed |
| **last_heartbeat** | timestamp | **[v5.1]** Updated every 30s by background runner |
| **models_detected** | text[] | **[v5]** Models found during detection stage |
| **selected_models** | text[] | **[v5]** Models user confirmed as installed |
| **is_multi_model** | boolean | **[v5]** Whether manual covers multiple models |
| created_at | timestamp | Job creation |
| started_at | timestamp | When processing started |
| completed_at | timestamp | When processing completed |
| updated_at | timestamp | Last update |

**status_v2 values for v5_ingest jobs:**
- `queued` - Job created, waiting to start
- `vision_running` - Vision pipeline executing
- `vision_completed` - Vision succeeded
- `vision_warning` - Vision completed with warnings
- `indexing_running` - Chunking and embedding in progress
- `indexing_completed` - Indexing succeeded
- `indexing_failed` - Indexing failed (pipeline stops)
- `dip_running` - DIP extraction in progress
- `dip_partial` - DIP completed with some modes failed
- `completed` - All stages completed
- `failed` - Pipeline failed

**status_v2 values for v5_parse_detect jobs:**
- `queued` - Job created, waiting to start
- `parsing` - LlamaParse running
- `parse_complete` - Parse succeeded, detect next
- `detecting` - Model detection running
- `detection_complete` - Detection succeeded, user todo created
- `failed` - Pipeline failed, failure todo created

### doc_assets [NEW in v5]

Figures, tables, and diagrams extracted by the vision pipeline.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| doc_id | text | FK to documents |
| asset_type | text | 'figure', 'table', 'diagram', etc. |
| page_number | integer | Source page in PDF |
| storage_path | text | Supabase Storage path to cropped image |
| caption | text | Extracted or generated caption |
| bounding_box | jsonb | Coordinates on the source page |
| metadata | jsonb | Additional extraction metadata |
| created_at | timestamp | Asset creation time |

### document_referenced_systems [NEW in v5]

Junction table linking documents to referenced products (non-primary models mentioned in the manual).

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| doc_id | text | FK to documents |
| model_norm | text | Normalized model name of referenced product |
| manufacturer_norm | text | Normalized manufacturer (if known) |
| asset_uid | text | FK to systems (if matched) |
| created_at | timestamp | Link creation time |

### Canonical Model Registry [NEW in v5]

#### ref_canonical_models

Canonical/normalized model entries for deduplication and matching.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| manufacturer_norm | text | Normalized manufacturer |
| model_norm | text | Canonical model name |
| product_type | text | Product type category |
| metadata | jsonb | Additional model info |

#### ref_model_synonyms

Maps alternate model names/spellings to canonical models.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| synonym | text | Alternate name/spelling |
| canonical_model_id | uuid | FK to ref_canonical_models |

**normalize_model_key()** - Database function that normalizes model strings for consistent matching across detection, selection, and indexing stages.

### DIP Production Tables

DIP (Document Intelligence Processing) extracts structured data from documents into 5 production tables. In v5, data writes **directly to production** -- there is no staging/approval workflow.

#### spec_suggestions

Extracted equipment specifications and parameters.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| doc_id | text | FK to documents |
| manufacturer_norm | text | Normalized manufacturer |
| model_norm | text | Normalized model |
| asset_uid | text | FK to systems |
| parameter | text | Spec parameter name |
| normalized_parameter | text | Standardized parameter |
| value | text | Raw value |
| converted_value | numeric | Parsed numeric value |
| units | text | Raw units |
| normalized_units | text | Standardized units |
| category | text | Spec category |

#### playbook_hints

Extracted procedures and maintenance steps.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| doc_id | text | FK to documents |
| manufacturer_norm | text | Normalized manufacturer |
| model_norm | text | Normalized model |
| asset_uid | text | FK to systems |
| title | text | Procedure title |
| steps | jsonb | Array of step strings |
| expected_outcome | text | What should happen |
| preconditions | jsonb | Required conditions |
| error_codes | jsonb | Related error codes |

#### intent_router

Extracted Q&A pairs for chat routing.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| doc_id | text | FK to documents |
| manufacturer_norm | text | Normalized manufacturer |
| model_norm | text | Normalized model |
| asset_uid | text | FK to systems |
| question | text | User question |
| question_variations | jsonb | Alternative phrasings |
| answer | text | Expected answer |
| question_type | text | Category of question |

#### golden_tests

Extracted test cases for validation.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| doc_id | text | FK to documents |
| manufacturer_norm | text | Normalized manufacturer |
| model_norm | text | Normalized model |
| asset_uid | text | FK to systems |
| query | text | Test query |
| expected | text | Expected response |
| test_method | text | How to verify |
| failure_indication | text | What failure looks like |

#### troubleshooting [NEW in v5]

Extracted troubleshooting guides -- symptom/cause/fix triads.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| doc_id | text | FK to documents |
| manufacturer_norm | text | Normalized manufacturer |
| model_norm | text | Normalized model |
| asset_uid | text | FK to systems |
| symptom | text | Problem description |
| cause | text | Root cause |
| fix | text | Resolution steps |
| severity | text | Severity level |

---

## Processing Pipeline Detail

### v5 Pipeline Stages (14 stages)

```
uploading -> verifying -> parsing -> model_detection -> model_selection
                                                             |
                          (pipeline pauses for user input)   |
                                                             v
              vision_analysis -> figure_cropping -> chunking -> embedding
                                                       |
                                                       v
                               indexing --------+---> colloquial -> storing -> completed
                                                |
                               dip_extraction --+
                               (runs concurrently via Promise.allSettled)
```

| Stage | Description | Service/Endpoint |
|-------|-------------|------------------|
| `uploading` | PDF uploaded to Supabase Storage | `upload-storage` route |
| `verifying` | File existence verified in Storage | document.service.js |
| `parsing` | PDF parsed via LlamaParse cloud API | `/v1/llamaparse` |
| `model_detection` | GPT-4.1-mini analyzes Markdown for models | `/v1/detect-models` |
| `model_selection` | **BLOCKING** - user selects installed models in UI | Frontend UI step |
| `vision_analysis` | LlamaParse layout data used to detect figures/tables | `/v1/vision/analyze-pages` |
| `figure_cropping` | Detected figures cropped from PDF pages | `/v1/vision/crop-figures` |
| `chunking` | Document split into ~80-250 high-recall chunks | `/v1/index-document` |
| `embedding` | Chunks embedded with text-embedding-3-large | `/v1/index-document` |
| `indexing` | Vectors upserted to Pinecone with v5 metadata | `/v1/index-document` |
| `colloquial` | Colloquial keywords extracted for system | v5-colloquial.service.js |
| `dip_extraction` | 5-category DIP: specs warmup then 4-way parallel | `/v1/dip/run` (callback) |
| `storing` | Final metadata updates to documents table | document repository |
| `completed` | Document ready for search | -- |

### v5 Chunk Metadata

Each chunk stored in Pinecone carries these v5 metadata fields:

| Field | Type | Description |
|-------|------|-------------|
| `doc_id` | string | Document identifier |
| `asset_uid` | string | Primary system FK |
| `applies_to_models` | string[] | Which models this chunk applies to |
| `referenced_systems` | string[] | Non-primary products mentioned |
| `is_universal` | boolean | True if chunk applies to all models in the manual |
| `search_blob` | string | Concatenated searchable text for high-recall |
| `page` | number | Source page number |
| `chunk_index` | number | Order within document |
| `chunk_type` | string | 'text', 'table', 'figure_caption', etc. |

### Storage Path Convention

```
documents (bucket)
+-- manuals/
    +-- {doc_id}/                  # SHA256 hash
        +-- {original_filename}.pdf
        +-- DIP/                   # DIP extraction outputs
        |   +-- {doc_id}_spec_suggestions_an.json
        |   +-- {doc_id}_playbook_hints_an.json
        |   +-- {doc_id}_intent_router_an.json
        |   +-- {doc_id}_golden_rules_an.json
        |   +-- {doc_id}_troubleshooting_an.json
        +-- vision/                # Vision pipeline outputs
            +-- manifest.json
            +-- figures/           # Cropped figure images
            +-- tables/            # Cropped table images
```

### Embedding Configuration

| Setting | Value |
|---------|-------|
| Model | `text-embedding-3-large` |
| Dimensions | 3072 |
| Namespace | `REIMAGINEDDOCS` |
| Index | `reimaginedsv` (from PINECONE_INDEX) |

### DIP Extraction Configuration

| Setting | Value |
|---------|-------|
| LLM | Anthropic Claude (with prompt caching) |
| Categories | 5: specs (warmup), troubleshooting, procedures, golden_rules, intent_router |
| Parallelism | Specs first (cache warmup), then all 4 remaining in parallel |
| Streaming | SSE via `/v1/dip/run` |
| Output | Direct to production tables (no staging) |
| Timeout | 30 minutes per streaming run |

### High-Recall Chunking Strategy

v5 uses a high-recall chunking approach:

- **~80-250 chunks per 70-page manual** (significantly more than v4)
- **Query-time filtering** replaces skip-heavy ingestion-time filtering
- Each chunk tagged with `applies_to_models[]` for model-specific retrieval
- `is_universal` flag marks chunks that apply to all models in a multi-model manual
- `search_blob` provides a concatenated searchable field for broad matching

### System Flag Updates

After successful Pinecone vector upsert, the linked system's manual flags are automatically updated:

```javascript
// document.repository.js:updateSystemManualFlag()
{
  manual: true,           // Generic "has manual" flag
  Manual_Local_Copy: true // "Has local uploaded copy" flag
}
```

---

## Batch Scripts

For bulk operations, use scripts in `scripts/bulk/`:

```bash
# Bulk upload PDFs with system lookup
node scripts/bulk/batch-upload-pdfs.js --dry-run

# Check for duplicate chunks
node scripts/bulk/check-duplicates.js

# Resync missing vectors
node scripts/bulk/resync-missing-vectors.js
```

See [Batch Scripts](../30-backend/batch-scripts.md)

---

## Testing

| Test File | What It Tests |
|-----------|---------------|
| `tests/integration/document.test.js` | Document API |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Documents stored in Pinecone" | **No.** Pinecone has vectors only. PDFs in Supabase Storage. |
| "One API call uploads and processes" | **No.** Upload is step 1, then parsing, detection, selection, vision, indexing, DIP are separate stages. |
| "DIP goes through staging/approval" | **No (v5).** DIP writes directly to production tables. The staging workflow was removed. |
| "Can edit uploaded PDFs" | **No.** Delete and re-upload to change. |
| "doc_id is UUID" | **No.** SHA256 hash of file content. |
| "Claude Vision analyzes figures" | **No (v5).** LlamaParse layout data is used for figure detection and cropping. |
| "pdfplumber/OCR parses PDFs" | **No (v5).** LlamaParse cloud API with extract_layout=True replaces pdfplumber/Tesseract OCR. |
| "Model detection is manual" | **No.** GPT-4.1-mini automatically detects primary_models and referenced_products from parsed Markdown. |
| "All chunks are equal" | **No (v5).** Chunks carry applies_to_models[], is_universal, search_blob for model-aware retrieval. |
| "DIP has 4 categories" | **No (v5).** DIP now has 5 categories: spec_suggestions, playbook_hints, intent_router, golden_tests, and troubleshooting (new). |

---

## Related Docs

- [Pinecone](./pinecone.md) - Vector storage
- [Systems](./systems.md) - Equipment linking
- [Batch Scripts](../30-backend/batch-scripts.md) - Bulk operations
- [Python Sidecar](../30-backend/python-sidecar.md) - Processing pipeline

# REIMAGINEDAPPV2 - Comprehensive Variable Reference

**Generated:** 2025-12-10
**Purpose:** Complete documentation of all domain variables, identifiers, and configuration used across the application.

---

## Table of Contents

1. [Primary Identifiers (IDs)](#1-primary-identifiers-ids)
2. [Chat & Conversation Variables](#2-chat--conversation-variables)
3. [Document & Ingestion Variables](#3-document--ingestion-variables)
4. [System & Equipment Variables](#4-system--equipment-variables)
5. [Telemetry & Device Variables](#5-telemetry--device-variables)
6. [Trip & Navigation Variables](#6-trip--navigation-variables)
7. [Supplies & Inventory Variables](#7-supplies--inventory-variables)
8. [Maintenance Task Variables](#8-maintenance-task-variables)
9. [Pinecone Vector Database Variables](#9-pinecone-vector-database-variables)
10. [Environment Configuration Variables](#10-environment-configuration-variables)
11. [Maintenance Agent Variables](#11-maintenance-agent-variables)
12. [API Request/Response Envelope Fields](#12-api-requestresponse-envelope-fields)
13. [Frontend State Variables](#13-frontend-state-variables)
14. [Python Sidecar Specific Variables](#14-python-sidecar-specific-variables)

---

## 1. Primary Identifiers (IDs)

These are the core identifiers used throughout the system.

| Variable | Format | Description |
|----------|--------|-------------|
| `thread_id` / `threadId` | UUID v4 | Unique identifier for a chat conversation thread |
| `session_id` / `sessionId` | UUID v4 | Container/group identifier for multiple chat threads |
| `message_id` / `messageId` | UUID v4 | Unique identifier for an individual chat message |
| `asset_uid` / `assetUid` | UUID v4 | Unique identifier for a boat system/equipment |
| `instance_uid` / `instanceUid` | UUID v4 | Specific instance of a system (e.g., "pump #2") |
| `doc_id` / `docId` | UUID or SHA-256 | Unique identifier for an ingested document |
| `chunk_id` / `chunkId` | String | Identifier for a document chunk (format: `{doc_id}-chunk-{page}`) |
| `job_id` / `jobId` | UUID v4 | Async processing job identifier |
| `request_id` / `requestId` | String (`req_*`) | Per-request correlation ID for logging/tracing |
| `metric_id` / `metricId` | UUID v4 | Telemetry metric identifier |
| `trip_id` / `tripId` | UUID v4 | Voyage/trip tracking identifier |
| `run_id` / `runId` | UUID v4 | Maintenance agent pipeline run identifier |

---

## 2. Chat & Conversation Variables

### Thread & Session

| Variable | Type | Description |
|----------|------|-------------|
| `thread_id` | UUID | Chat thread identifier - groups related messages |
| `session_id` | UUID | Chat session identifier - groups related threads |
| `name` | String | User-given name for thread/session |
| `summary` | String | AI-generated summary of the conversation |
| `message_count` | Integer | Total messages in thread |
| `max_sequence_number` | Integer | Highest message sequence in thread |

### Message

| Variable | Type | Description |
|----------|------|-------------|
| `message_id` | UUID | Unique message identifier |
| `role` | Enum | Message author: `'user'` | `'assistant'` | `'system'` |
| `content` | String | The message text content |
| `sequence_number` | Integer | Order within thread (auto-incrementing) |
| `metadata` | JSONB | Flexible storage for sources, scores, etc. |
| `created_at` | Timestamp | When message was created |

### Context & Memory

| Variable | Type | Description |
|----------|------|-------------|
| `equipment_context` | JSON Array | Equipment systems mentioned in conversation |
| `conversation_summary` | String | Summarized thread history for context |
| `accumulated_equipment` | Array | Equipment accumulated across conversation turns |
| `memory_context` | JSONB | Memory weights and exchange tracking |
| `systems_context` | Array | Current systems context passed to chat |

### Query Classification (Python)

| Variable | Type | Description |
|----------|------|-------------|
| `classification.primary` | String | Primary intent category of query |
| `classification.confidence` | Float (0-1) | Confidence in classification |
| `classification.table_types` | Array | Relevant DIP table types |
| `classification.equipment_context` | Object | Detected equipment in query |

---

## 3. Document & Ingestion Variables

### Document

| Variable | Type | Description |
|----------|------|-------------|
| `doc_id` | String | Document identifier (UUID or SHA-256 hash) |
| `manufacturer` | String | Equipment manufacturer name |
| `model` | String | Equipment model number |
| `revision_date` | String | Document revision/version date |
| `language` | String | Document language code |
| `brand_family` | String | Brand family grouping |
| `source_url` | String | Original document URL |
| `pages_total` | Integer | Total pages in document |
| `chunk_count` | Integer | Number of chunks created |
| `table_count` | Integer | Tables extracted from document |
| `models_covered` | text[] | Models this document covers (e.g. ["4JH45","4JH57"]) |
| `is_multi_model` | boolean | Document covers multiple product models |
| `is_oem_manual` | boolean | Document is for OEM component |
| `vision_processed` | boolean | Vision/layout analysis completed |
| `page_count` | integer | Total pages in document |
| `figure_count` | integer | Extracted figures/tables count |

### Chunk

| Variable | Type | Description |
|----------|------|-------------|
| `chunk_id` | String | Unique chunk identifier |
| `document_id` | String | Parent document reference |
| `content` | String | Chunk text content |
| `page_start` | Integer | Starting page number |
| `page_end` | Integer | Ending page number |
| `chunk_index` | Integer | Position within document |
| `content_type` | String | Type: `'text'` | `'table'` | `'figure'` |
| `checksum` | String | SHA-256 hash of content |

### Chunk Metadata (Semantic Chunking v2)

| Variable | Type | Description |
|----------|------|-------------|
| `section_hierarchy` | Array | Breadcrumb path of headers |
| `section_title` | String | Immediate parent section name |
| `section_level` | Integer | Header level (1-6) |
| `parent_chunk_id` | String | Parent chunk reference |
| `previous_chunk_id` | String | Previous sequential chunk |
| `next_chunk_id` | String | Next sequential chunk |
| `token_count` | Integer | Token count for LLM context |
| `has_tables` | Boolean | Contains table content |
| `has_lists` | Boolean | Contains list content |
| `keywords` | Array | Extracted keywords |
| `linked_asset_uid` | String | Linked equipment system |

### Chunk Metadata (v5)

| Variable | Type | Description |
|----------|------|-------------|
| `applies_to_models` | text[] | Models this chunk applies to |
| `referenced_systems` | text[] | Other systems mentioned in chunk |
| `is_universal` | boolean | Applies to all models in manual |
| `search_blob` | text | Vocabulary-aware text for matching |

### Job (Processing)

| Variable | Type | Description |
|----------|------|-------------|
| `job_id` | UUID | Job identifier |
| `job_type` | String | Type of processing job |
| `status` | Enum | `'queued'` | `'started'` | `'completed'` | `'failed'` |
| `storage_path` | String | Path to stored file |
| `params` | JSONB | Job parameters |
| `counters` | JSONB | Progress tracking counters |
| `error` | JSONB | Error details if failed |
| `dip_success` | Boolean | Document Intelligence Packet success |
| `models_detected` | text[] | Models detected in document |
| `selected_models` | text[] | User-selected models |
| `is_multi_model` | boolean | Multi-model document flag |
| `status_v2` | text | 14-stage pipeline status |
| `started_at` | Timestamp | When processing started |
| `completed_at` | Timestamp | When processing completed |

---

## 4. System & Equipment Variables

### System

| Variable | Type | Description |
|----------|------|-------------|
| `asset_uid` | UUID | Primary system identifier |
| `name` | String | System display name |
| `description` | String | System description |
| `category` | String | System category |
| `manufacturer` | String | Equipment manufacturer |
| `manufacturer_norm` | String | Normalized manufacturer (for search) |
| `model` | String | Equipment model |
| `model_norm` | String | Normalized model (for search) |
| `canonical_model_id` | String | Standardized model identifier |
| `subsystem_normalized` | String | Normalized subsystem category |
| `manufacturer_id` | UUID | FK to ref_manufacturers |
| `product_type_id` | UUID | FK to ref_product_types |
| `system_category_id` | UUID | FK to ref_system_categories |
| `subsystem_category_id` | UUID | FK to ref_subsystem_categories |
| `oem_manufacturer_id` | UUID | FK to ref_manufacturers (OEM) |
| `oem_model` | text | OEM model identifier |
| `serial_number` | text | Serial number (single-instance) |
| `model_synonyms` | text[] | Model name variants |
| `colloquial_keywords` | text[] | Common names from doc extraction |

### Instance

| Variable | Type | Description |
|----------|------|-------------|
| `instance_uid` | UUID | Specific instance identifier |
| `asset_uid` | UUID | Parent system reference |
| `serial_number` | String | Physical serial number |
| `location` | String | Location on boat |
| `instance_index` | Integer | Instance number (e.g., "pump #2") |

---

## 4b. Reference Table Variables (v5)

### ref_manufacturers

| Variable | Type | Description |
|----------|------|-------------|
| `id` | UUID | Manufacturer identifier |
| `name` | text | Canonical name (e.g. "Yanmar") |
| `synonyms` | text[] | Alternative names |
| `is_oem` | boolean | Primarily an OEM supplier |

### ref_product_types

| Variable | Type | Description |
|----------|------|-------------|
| `id` | UUID | Product type identifier |
| `name` | text | Canonical type (e.g. "Engine") |
| `synonyms` | text[] | Alternative names |

### ref_system_categories

| Variable | Type | Description |
|----------|------|-------------|
| `id` | UUID | Category identifier |
| `name` | text | Category (e.g. "Propulsion") |
| `synonyms` | text[] | Alternative names |

### centroids

| Variable | Type | Description |
|----------|------|-------------|
| `id` | UUID | Centroid identifier |
| `name` | text | Operational grouping name |
| `synonyms` | text[] | Query matching aliases |

---

## 5. Telemetry & Device Variables

### Device

| Variable | Type | Description |
|----------|------|-------------|
| `source_device_id` | String | Unique device identifier from Victron/telemetry |
| `display_name` | String | Human-readable device name |
| `product_name` | String | Equipment model name |
| `category` | String | Device category: `'battery'` | `'tank'` | `'solarcharger'` |

### Metric

| Variable | Type | Description |
|----------|------|-------------|
| `metric_id` | UUID | Metric identifier |
| `metric_name` | String | Metric name (e.g., `"Soc"`, `"Dc/0/Voltage"`) |
| `unit` | String | Unit of measurement (e.g., `"V"`, `"%"`) |
| `is_primary` | Boolean | Primary display metric |

### Current State

| Variable | Type | Description |
|----------|------|-------------|
| `last_ts` | Timestamp | Last reading timestamp |
| `numeric_value` | Float | Numeric measurement value |
| `bool_value` | Boolean | Boolean state value |
| `string_value` | String | String state value |

### Aggregated Data

| Variable | Type | Description |
|----------|------|-------------|
| `recorded_at` | Timestamp | Aggregation period timestamp |
| `avg_value` | Float | Average value in period |
| `min_value` | Float | Minimum value in period |
| `max_value` | Float | Maximum value in period |

---

## 6. Trip & Navigation Variables

### Trip

| Variable | Type | Description |
|----------|------|-------------|
| `trip_id` / `id` | UUID | Trip identifier |
| `title` | String | User-given trip name |
| `status` | Enum | `'active'` | `'completed'` |
| `started_at` | Timestamp | Trip start time |
| `ended_at` | Timestamp | Trip end time |
| `duration_minutes` | Integer | Total trip duration |
| `distance_nm` | Float | Distance in nautical miles |

### GPS Position

| Variable | Type | Description |
|----------|------|-------------|
| `latitude` | Float | GPS latitude coordinate |
| `longitude` | Float | GPS longitude coordinate |
| `recorded_at` | Timestamp | Position timestamp |

### Sail Configuration

| Variable | Type | Description |
|----------|------|-------------|
| `main_sail` | Enum | `'full'` | `'1reef'` | `'2reef'` | `'3reef'` | `null` |
| `jib` | Boolean | Jib sail deployed |
| `code_zero` | Boolean | Code zero sail deployed |
| `asym_spinnaker` | Boolean | Asymmetric spinnaker deployed |

### Trip Stats

| Variable | Type | Description |
|----------|------|-------------|
| `avg_sog` | Float | Average speed over ground (knots) |
| `max_sog` | Float | Maximum speed over ground |

---

## 7. Supplies & Inventory Variables

### Supply Item

| Variable | Type | Description |
|----------|------|-------------|
| `id` | UUID | Supply item identifier |
| `item_name` | String | Item display name |
| `item_type` | Enum | `'supply'` | `'tool'` | `'item'` |
| `category_id` | UUID | Category reference |
| `location` | String | Storage location |
| `system_asset_uid` | UUID | Linked boat system |
| `quantity` | Numeric | Current quantity |
| `unit_id` | UUID | Unit of measurement reference |
| `reorder_quantity` | Numeric | Low-stock threshold |
| `auto_reorder` | Boolean | Auto-reorder enabled |

### Category

| Variable | Type | Description |
|----------|------|-------------|
| `category_id` | UUID | Category identifier |
| `name` | String | Category name |
| `displayOrder` | Integer | Sort order |

### Unit

| Variable | Type | Description |
|----------|------|-------------|
| `unit_id` | UUID | Unit identifier |
| `unit_name` | String | Full unit name |
| `abbreviation` | String | Short unit abbreviation |

---

## 8. Maintenance Task Variables

### Task

| Variable | Type | Description |
|----------|------|-------------|
| `task_id` / `id` | UUID | Task identifier |
| `system_name` | String | Related system name |
| `description` | String | Task description |
| `criticality` | Enum | `'routine'` | `'warning'` | `'critical'` |
| `confidence` | Float (0-1) | AI confidence score |
| `frequency_type` | Enum | `'hours'` | `'days'` | `'months'` | `'condition_based'` |
| `frequency_value` | Integer | Frequency interval value |
| `estimated_duration_hours` | Float | Estimated labor hours |
| `parts_required` | Array | Required parts list |
| `source` | String | Task source (e.g., `'manual'`) |
| `status` | Enum | `'pending'` | `'approved'` | `'rejected'` |
| `reviewed_by` | String | Reviewer identifier |
| `reviewed_at` | Timestamp | Review timestamp |
| `review_notes` | String | Review feedback |

### Playbook

| Variable | Type | Description |
|----------|------|-------------|
| `playbook_id` | UUID | Playbook identifier |
| `doc_id` | String | Source document ID |
| `test_name` | String | Procedure/test name |
| `test_type` | String | Type classification |
| `description` | String | Procedure description |
| `steps` | Array | Array of step objects |
| `expected_result` | String | Expected outcome |
| `page` | Integer | Source document page |
| `confidence` | Float (0-1) | Extraction confidence |
| `system_norm` | String | Normalized system name |
| `subsystem_norm` | String | Normalized subsystem |

### Playbook Step

| Variable | Type | Description |
|----------|------|-------------|
| `step_number` | Integer | Sequential step number |
| `instruction` | String | Action instruction text |
| `source_hint_id` | String | Reference to source hint |

---

## 9. Pinecone Vector Database Variables

### Index Configuration

| Variable | Type | Description |
|----------|------|-------------|
| `namespace` | String | Vector namespace (default: `REIMAGINEDDOCS`) |
| `vector_id` | String | Vector identifier (matches `chunk_id`) |
| `values` | Array[Float] | Vector embedding values (3072 dimensions) |

### Query Parameters

| Variable | Type | Description |
|----------|------|-------------|
| `topK` / `top_k` | Integer | Number of results to return |
| `includeMetadata` | Boolean | Include metadata in results |
| `includeValues` | Boolean | Include vector values in results |
| `filter` | Object | Metadata filter criteria |

### Vector Metadata

| Variable | Type | Description |
|----------|------|-------------|
| `doc_id` | String | Source document ID |
| `manufacturer` | String | Equipment manufacturer |
| `model` | String | Equipment model |
| `page_number` | Integer | Source page |
| `chunk_index` | Integer | Chunk position |
| `content` | String | Chunk text content |
| `chunk_type` | String | Content type |
| `applies_to_models` | text[] | Models this vector applies to |
| `referenced_systems` | text[] | Other systems mentioned |
| `is_universal` | boolean | Universal content flag |
| `search_blob` | text | Vocabulary-aware search text |

### Namespaces

| Namespace | Description |
|-----------|-------------|
| `REIMAGINEDDOCS` | Default namespace for document chunks |
| `MAINTENANCE_TASKS` | Maintenance task vectors |

---

## 10. Environment Configuration Variables

### Core Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment: `development` | `test` | `production` |
| `PORT` | `3000` | HTTP server port |
| `APP_VERSION` | - | Application version string |

### External Service Keys

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API authentication key |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `COHERE_API_KEY` | Cohere API key for rerank-v3.5 (chunk ranking) |
| `PINECONE_API_KEY` | Pinecone vector database API key |
| `SUPABASE_URL` | Supabase PostgreSQL instance URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `SUPABASE_ANON_KEY` | Supabase anonymous key |

### Model Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_MODEL` | `gpt-5.1-chat-latest` | Default OpenAI model |
| `OPENAI_SUMMARY_MODEL` | `gpt-4.1-mini` | Model for summaries/detection |
| `ANTHROPIC_MODEL` | `claude-3-5-sonnet-latest` | Default Anthropic model |
| `ANTHROPIC_MAX_TOKENS` | `8000` | Max tokens for Anthropic |
| `ANTHROPIC_TEMPERATURE` | `0` | Temperature setting |
| `CHAT_MODEL` | `ANTHROPIC` | Chat provider selection |
| `LLAMA_CLOUD_API_KEY` | - | LlamaParse cloud API key |
| `VISION_MODEL` | `gpt-4o` | Vision analysis model |

### Pinecone Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PINECONE_INDEX` | `reimaginedsv` | Pinecone index name |
| `PINECONE_NAMESPACE` | `REIMAGINEDDOCS` | Default namespace |
| `PINECONE_ENVIRONMENT` | - | Pinecone environment |
| `DEFAULT_NAMESPACE` | - | Fallback namespace |

### Service URLs

| Variable | Default | Description |
|----------|---------|-------------|
| `PYTHON_SIDECAR_URL` | `http://localhost:8000` | Python sidecar URL |
| `MAINTENANCE_SERVICE_URL` | `http://localhost:3001` | Maintenance agent URL |
| `MAINTENANCE_BASE_URL` | `http://localhost:3001` | Maintenance agent page URLs (for action links in todo list) |
| `MAIN_APP_BASE_URL` | `http://localhost:3000` | Main app page URLs (for action links in todo list) |

### Timeouts & Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `PYTHON_CHAT_TIMEOUT_MS` | - | Chat request timeout |
| `CHAT_CONTEXT_SIZE` | `5` | Messages for context |
| `CONTEXT_LOADING_TIMEOUT_MS` | `1800` | Context loading timeout |
| `SYSTEM_SEARCH_TIMEOUT_MS` | `1200` | System search timeout |
| `ANTHROPIC_API_DELAY` | `1.2` | Rate limit delay (seconds) |

### Security

| Variable | Description |
|----------|-------------|
| `ADMIN_TOKEN` | Admin API authentication token |
| `ADMIN_PIN` | Admin PIN code |

### Document Processing

| Variable | Default | Description |
|----------|---------|-------------|
| `DOC_CHUNKS_TABLE` | `document_chunks` | Chunks table name |
| `DOC_CHUNKS_PAGE_COL` | `page_start` | Page column name |
| `DOC_CHUNKS_TEXT_COL` | `content` | Content column name |
| `DIP_LLM_DEBUG` | - | Debug flag for DIP extraction |
| `DIP_ENVIRONMENT` | `staging` | DIP data source |

### Feature Flags

| Variable | Default | Description |
|----------|---------|-------------|
| `CHAT_MODULE_ENABLED` | `false` | Enable chat module |
| `USE_SEMANTIC_CHUNKING` | `false` | Enable semantic chunking v2 |
| `RESPONSE_VALIDATE` | - | Enable response validation |

### Service Disable Flags (Testing)

| Variable | Description |
|----------|-------------|
| `PINECONE_DISABLED` | Disable Pinecone connections |
| `SIDECAR_DISABLED` | Disable Python sidecar |
| `SUPABASE_DISABLED` | Disable Supabase connections |
| `OPENAI_DISABLED` | Disable OpenAI calls |

### Anchor Watch

| Variable | Default | Description |
|----------|---------|-------------|
| `ANCHOR_WATCH_SAFE_RATIO` | `0.7` | Safe zone ratio |
| `ANCHOR_WATCH_WARNING_RATIO` | `0.9` | Warning zone ratio |
| `ANCHOR_WATCH_CENTROID_SAMPLES` | `20` | Centroid calculation samples |
| `ANCHOR_WATCH_STALE_THRESHOLD_SEC` | `300` | Stale data threshold |

### Notifications

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot API token |
| `TELEGRAM_CHAT_ID` | Telegram chat/channel ID |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio sender number |
| `TWILIO_SMS_TO` | SMS recipient number |

---

## 11. Maintenance Agent Variables

### Pipeline Orchestrator

| Variable | Type | Description |
|----------|------|-------------|
| `orchestrator` | Singleton | Main event-emitting orchestrator for 6-step pipeline |
| `activeRuns` | Map | Currently executing pipeline runs by `runId` |
| `rateLimiter` | Service | API call rate limiting manager |

### Scheduler Job

| Variable | Type | Description |
|----------|------|-------------|
| `schedulerJob` | Singleton | Manages cron job scheduling |
| `scheduledTasks` | Array | Registered cron tasks |

### Pipeline Events

| Event | Description |
|-------|-------------|
| `processing_started` | Processing of a system begins |
| `step_started` | Individual pipeline step begins |
| `progress` | Progress update within a step |
| `step_completed` | Step completed successfully |
| `step_failed` | Step failed with error |
| `manual_review_required` | Deduplication review needed |
| `processing_complete` | All steps completed |
| `processing_failed` | Processing failed |
| `processing_cancelled` | Processing was cancelled |
| `final_review_required` | Final task approval needed |

### Pipeline Steps Status

| Variable | Type | Description |
|----------|------|-------------|
| `step1_extract_status` | Enum | Step 1 status |
| `step1_started_at` | Timestamp | When step 1 started |
| `step1_completed_at` | Timestamp | When step 1 completed |
| `step1_tasks_extracted` | Integer | Tasks found in step 1 |
| `overall_status` | Enum | `'not_started'` | `'processing'` | `'failed'` | `'completed'` |

### Agent Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_RUN_INTERVAL_MINUTES` | `60` | Cron job frequency |
| `AGENT_BATCH_SIZE` | `5` | Systems per processing batch |
| `AGENT_CONFIDENCE_THRESHOLD` | `0.7` | Min confidence for approval |
| `AGENT_SYSTEM_CHECK_ENABLED` | `true` | Set to `'false'` to disable the system-check cron (e.g. while debugging agent memory upsert issues) |
| `APPROVAL_AUTO_APPROVE_CONFIDENCE` | `0.95` | Auto-approve threshold |
| `APPROVAL_REVIEW_REQUIRED_CONFIDENCE` | `0.70` | Manual review threshold |
| `OPENAI_MAX_CONCURRENT_CALLS` | `3` | Concurrent API calls |
| `OPENAI_RATE_LIMIT_RPM` | `60` | Rate limit (requests/minute) |

### Forecast Email Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GMAIL_CLIENT_ID` | - | Google OAuth client ID for Gmail API access |
| `GMAIL_CLIENT_SECRET` | - | Google OAuth client secret |
| `GMAIL_REFRESH_TOKEN` | - | Gmail OAuth refresh token (from `gmail-oauth-setup.mjs`) |
| `FORECAST_SENDER_EMAIL` | `support@mwxc.com` | Email address of forecast sender to search for |
| `FORECAST_EMAIL_ENABLED` | `false` | Enable forecast email ingestion (`'true'` to enable) |
| `FORECAST_RETENTION_DAYS` | `10` | Days to retain forecast emails before cleanup |
| `FORECAST_GMAIL_SEARCH_DAYS` | `4` | Gmail search window in days (`newer_than:Xd`) |

### Forecast Email Parse Status State Machine

| Status | Description |
|--------|-------------|
| `queued` | Email ingested, waiting for parse |
| `parsing` | Parse in progress (job lock held) |
| `parsed` | All steps completed successfully |
| `partial` | Step 1 OK but Step 3 failed — structured data saved, prose missing |
| `failed` | Step 1 failed |

### WebSocket Client

| Variable | Type | Description |
|----------|------|-------------|
| `wsClients` | Map | Active WebSocket connections |
| `clientId` | UUID | Client connection identifier |
| `subscriptions` | Set | `runId`s client is subscribed to |
| `isAlive` | Boolean | Heartbeat status |

---

## 12. API Request/Response Envelope Fields

### Standard Response Envelope

```javascript
{
  success: Boolean,        // Operation success status
  data: Object,            // Domain-specific response data
  timestamp: String,       // ISO 8601 timestamp
  requestId: String        // Correlation ID (optional)
}
```

### Chat Response Data

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | UUID | Session identifier |
| `threadId` | UUID | Thread identifier |
| `userMessage` | Object | `{ id, content, role, createdAt }` |
| `assistantMessage` | Object | `{ id, content, role, createdAt, sources }` |
| `systemsContext` | Array | Equipment context (optional) |
| `enhancedQuery` | String | Query with context (optional) |
| `sources` | Array | Source references (optional) |

### Response Score

| Field | Type | Description |
|-------|------|-------------|
| `total_score` | Integer (0-100) | Overall response quality |
| `confidence` | Enum | `'high'` | `'medium'` | `'low'` | `'very_low'` |
| `breakdown` | Object | Score component breakdown |
| `confidence_emoji` | String | Visual indicator |
| `reasoning` | String | Score explanation |

### Source Object

| Field | Type | Description |
|-------|------|-------------|
| `type` | String | `'pinecone'` | `'procedure'` | `'spec'` | `'troubleshooting'` |
| `id` | String | Source identifier |
| `data` | Array | Chunk data array |
| `equipment` | Object | `{ names, manufacturer, model }` |
| `count` | Integer | Number of matches |
| `pages` | Array | Page references |
| `score` | Float | Relevance score |

---

## 13. Frontend State Variables

### Chat State

| Variable | Location | Description |
|----------|----------|-------------|
| `currentThreadId` | app.js | Currently active chat thread |
| `currentMessageSequence` | app.js | Message ordering counter |

### Trip State

| Variable | Location | Description |
|----------|----------|-------------|
| `activeTrip` | trips.js | Currently active trip |
| `selectedTrip` | trips.js | Trip selected for options |
| `resumeTrip` | trips.js | Trip eligible for resuming |
| `tripToDelete` | trips.js | Trip marked for deletion |
| `currentSailConfig` | trips.js | Current sail configuration |

### Admin State

| Variable | Location | Description |
|----------|----------|-------------|
| `AdminState.ADMIN_TOKEN` | boot.js | Admin authentication token |
| `AdminState.currentJob` | boot.js | Currently processing job |
| `AdminState.currentChunks` | boot.js | Active chunk list |
| `AdminState.refreshInterval` | boot.js | Polling interval ID |

### Playbook State

| Variable | Location | Description |
|----------|----------|-------------|
| `currentPlaybook` | playbooks.js | Currently selected playbook |

### Maintenance Review State

| Variable | Location | Description |
|----------|----------|-------------|
| `currentTaskForReject` | maintenance-review.js | Task pending rejection |

---

## 14. Python Sidecar Specific Variables

### DIP (Document Intelligence Packet)

| Variable | Type | Description |
|----------|------|-------------|
| `entity_type` | Enum | `manufacturer` | `model` | `specification` | `warning` | `procedure` |
| `hint_type` | Enum | `pressure` | `temperature` | `voltage` | `flow_rate` | `dimension` |
| `test_type` | Enum | `procedure` | `checklist` | `measurement` | `validation` |

### DIP Tables

| Table | Table Type | Description |
|-------|------------|-------------|
| `spec_suggestions` | `spec` | Specifications and parameters |
| `playbook_hints` | `procedure` | Procedures and operational guides |
| `golden_tests` | `troubleshooting` | Troubleshooting information |
| `troubleshooting` | `troubleshooting` | Symptom -> cause -> resolution (NEW in v5) |
| `intent_router` | `routing` | Q&A pairs for intent routing |

### Embedding

| Variable | Type | Description |
|----------|------|-------------|
| `dense_vector` | Array[Float] | OpenAI embedding (3072 dimensions) |
| `sparse_vector` | Dict | BM25 keyword scores |
| `embedding_id` | UUID | Generated embedding identifier |

### Chunking Strategy

| Variable | Value | Description |
|----------|-------|-------------|
| `chunk_strategy_version` | `semantic_v2` | Current chunking version |
| `chunk_strategy_version` | `legacy_page_based` | Legacy chunking version |

---

## Naming Conventions

### Case Conventions

| Context | Convention | Example |
|---------|------------|---------|
| JavaScript variables | camelCase | `threadId`, `assetUid` |
| Database columns | snake_case | `thread_id`, `asset_uid` |
| API request bodies | snake_case | `thread_id`, `systems_context` |
| API response data | camelCase | `threadId`, `requestId` |
| Environment variables | SCREAMING_SNAKE | `OPENAI_API_KEY` |

### ID Format Conventions

| ID Type | Format |
|---------|--------|
| Most identifiers | UUID v4 |
| Document IDs | UUID or SHA-256 hash |
| Chunk IDs | `{doc_id}-chunk-{page}` |
| Request IDs | `req_*` prefix |
| Task vectors | `task-{identifier}` prefix |

---

## Quick Reference: Critical IDs

These are the most frequently used identifiers across the system:

1. **`thread_id`** - Chat conversation tracking
2. **`asset_uid`** - Equipment/system identification
3. **`doc_id`** - Document tracking
4. **`job_id`** - Async job tracking
5. **`request_id`** - Request correlation/logging
6. **`run_id`** - Maintenance pipeline tracking

---

*Document auto-generated from codebase analysis*

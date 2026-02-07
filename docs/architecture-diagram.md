# Document Processing Pipeline Architecture

**Last Updated:** 2026-02-06 (v5 migration)

## Overview

This diagram shows the complete v5 document processing pipeline from upload through DIP extraction to chat consumption.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Two Extraction Systems (Both read from same document vectors)  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. DIP Pipeline (Python Sidecar)                               │
│     → Extracts: specs, procedures, troubleshooting,             │
│                 golden_rules, intent_router                     │
│     → Writes: directly to production tables (no staging)        │
│     → Runs: SSE streaming, 2-at-a-time parallelism              │
│     → Uses: Anthropic Claude with prompt caching                │
│     → Used by: Chat AI (production_dip_retriever.py)            │
│                                                                 │
│  2. Maintenance Agent (separate service, port 3001)             │
│     → Extracts: maintenance tasks with scheduling               │
│     → Stores: Pinecone MAINTENANCE_TASKS + Supabase index       │
│     → Used by: Maintenance UI, todo list                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## v5 Document Ingestion Flow (14 Stages)

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Admin UI      │    │   Node.js API    │    │ Python Sidecar  │
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │ document-   │ │───▶│ │ /admin/api/  │ │───▶│ │ /v1/        │ │
│ │ ingest.html │ │    │ │ documents    │ │    │ │ llamaparse  │ │
│ └─────────────┘ │    │ └──────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └──────────────────┘    └─────────────────┘

Pipeline Stages:
 1. uploading          → PDF to Supabase Storage (/manuals/{doc_id}/)
 2. verifying          → File exists in storage
 3. parsing            → LlamaParse (cloud, with extract_layout=True)
 4. model_detection    → gpt-4.1-mini analyzes full parsed markdown
 5. model_selection    → Blocking: user confirms which model(s) apply
 6. vision_analysis    → LlamaParse layout extraction → figure/table detection
 7. figure_cropping    → Crop figures from page images → doc_assets
 8. chunking           → Semantic chunking with v5 model tags
 9. embedding          → text-embedding-3-large (3072 dims)
10. indexing           → Upsert to Pinecone with v5 metadata
11. colloquial         → Extract colloquial keywords for search
12. dip_extraction     → Anthropic Claude → 5 production tables (SSE streaming)
13. storing            → Final metadata updates
14. completed          → Done
```

## v5 Pipeline Detail

```
┌─────────────────────────────────────────────────────────────────┐
│  Stage 3: Parsing (LlamaParse)                                   │
│                                                                 │
│  Input: PDF file buffer                                          │
│  Output: Markdown text + layout data (bounding boxes)            │
│  Note: extract_layout=True provides figure/table positions       │
│  Cost: ~$0.003/page via LlamaParse cloud API                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 4: Model Detection (gpt-4.1-mini)                         │
│                                                                 │
│  Input: Full parsed markdown (~100K tokens)                      │
│  Output: primary_models[], referenced_products[], is_multi_model │
│  Cost: ~$0.015 per document                                      │
│  Example: Yanmar manual → ["3JH40","4JH45","4JH57","4JH80"]     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 5: Model Selection (Blocking UI)                          │
│                                                                 │
│  If is_multi_model: pause pipeline, show checkboxes in UI        │
│  User selects which model(s) are installed on their boat         │
│  Stores: documents.models_covered[], jobs.selected_models[]      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stages 6-7: Vision Analysis + Figure Cropping                   │
│                                                                 │
│  Uses LlamaParse extract_layout=True (NOT Claude Vision)         │
│  Detects: figures, diagrams, tables with bounding boxes          │
│  Crops figures from page images                                  │
│  Stores: doc_assets table with applies_to_models[] tags          │
│  Tags: model attribution per asset (which model does this apply  │
│         to, or is_universal for generic content)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 8: Chunking (v5 metadata)                                 │
│                                                                 │
│  Semantic chunking with v5 tags:                                 │
│  - applies_to_models[]   (which models this chunk is about)      │
│  - referenced_systems[]  (other systems mentioned)               │
│  - is_universal          (applies to all models in manual)       │
│  - search_blob           (vocabulary-aware text for matching)    │
│                                                                 │
│  High-recall approach: ~80-250 chunks per 70-page manual         │
│  Query-time filtering rather than skip-heavy indexing             │
└─────────────────────────────────────────────────────────────────┘
                              │
               ┌──────────────┼──────────────┐
               ↓              ↓              ↓
      ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
      │  Pinecone   │ │  Supabase   │ │  DIP (SSE)  │
      │             │ │  Database   │ │             │
      │ REIMAGINED- │ │             │ │ Anthropic   │
      │ DOCS        │ │ document_   │ │ Claude with │
      │ namespace   │ │ chunks      │ │ prompt      │
      │             │ │ doc_assets  │ │ caching     │
      │ v5 metadata │ │             │ │             │
      └─────────────┘ └─────────────┘ └─────────────┘
```

## DIP Pipeline Detail (v5)

```
┌─────────────────────────────────────────────────────────────────┐
│  Python Sidecar: POST /v1/dip/run (SSE streaming)                │
│                                                                 │
│  Input: doc_id, models_covered[], selected_models[]              │
│  Process: Read chunks → Anthropic Claude extraction              │
│  Parallelism: 2 modes at a time (Semaphore)                     │
│  Caching: Prompt prefix cached across modes (~80% cache hit)     │
│  Output: 5 categories of extracted data                          │
│                                                                 │
│  SSE Events:                                                     │
│  - warmup_complete (intent_router warms cache)                   │
│  - mode_started / mode_completed (per extraction mode)           │
│  - dip_complete (all modes done)                                 │
│  - error (on failure)                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Production Tables (written directly, no staging workflow)        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ spec_suggestions        │ Equipment specifications       │   │
│  │                         │ + applies_to_models[]          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ playbook_hints          │ Step-by-step procedures        │   │
│  │                         │ + applies_to_models[]          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ intent_router           │ Q&A pairs for chat routing     │   │
│  │                         │ + applies_to_models[]          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ golden_tests            │ Validation test cases          │   │
│  │                         │ + applies_to_models[]          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ troubleshooting         │ Symptom → cause → resolution   │   │
│  │ (NEW in v5)             │ + cross-system references      │   │
│  │                         │ + applies_to_models[]          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Chat AI (production_dip_retriever.py)                            │
│                                                                 │
│  Query Type → Production Table:                                  │
│  ├── "spec"            → spec_suggestions                        │
│  ├── "procedure"       → playbook_hints                          │
│  ├── "troubleshooting" → troubleshooting (+ golden_tests)        │
│  ├── "routing"         → intent_router                           │
│  └── "visual"          → doc_assets (figures/tables)             │
│                                                                 │
│  Scoping: model-specific filtering via applies_to_models[]       │
│  Assets: doc_assets retrieved via 2-stage LLM selector           │
└─────────────────────────────────────────────────────────────────┘
```

## Full Document Lifecycle (v5)

```
Reference Tables (foundation)
├── ref_manufacturers (51)
├── ref_product_types (45)
├── ref_system_categories (9)
├── ref_subsystem_categories (54)
├── ref_canonical_models (54)
├── ref_model_synonyms (17)
└── centroids (15)
    │
    ▼
Systems (v5 with FK columns)
├── manufacturer_id → ref_manufacturers
├── product_type_id → ref_product_types
├── system_category_id → ref_system_categories
├── subsystem_category_id → ref_subsystem_categories
├── oem_manufacturer_id → ref_manufacturers (OEM tracking)
├── serial_number (single-instance)
└── model_synonyms[] (variant names)
    │
    ├── instances (multiple of same system, e.g. twin engines)
    │   └── serial_number, location, instance_index
    │
    ├── system_relationships (approved inter-system links)
    │   └── source → target with relationship_type
    │
    └── centroid_members (operational groupings)
        └── system ↔ centroid junction
    │
    ▼
Documents uploaded (PDFs)
├── models_covered[] (e.g. ["4JH45","4JH57","4JH80"])
├── is_multi_model (boolean)
├── vision_processed (boolean)
├── page_count, figure_count
└── document_referenced_systems (junction table)
    │
    ▼
v5 Pipeline (14 stages)
    │
    ├──────────────────────────────────────────────┐
    ▼                                              ▼
Pinecone Vectors                            DIP Production Tables
(REIMAGINEDDOCS namespace)                  (5 categories, direct write)
├── v5 chunk metadata:                      ├── spec_suggestions
│   applies_to_models[]                     ├── playbook_hints
│   referenced_systems[]                    ├── intent_router
│   is_universal                            ├── golden_tests
│   search_blob                             └── troubleshooting (NEW)
│                                                  │
├── doc_assets                                     │
│   (figures, diagrams, tables                     │
│    with model attribution)                       │
│                                                  │
├──────────────────────────────────────────────────┤
│                                                  │
▼                                                  ▼
Maintenance Agent                           Chat AI
(6-step pipeline)                           ├── production_dip_retriever.py
    │                                       ├── doc_assets_retriever.py (v5)
    ▼                                       └── Pinecone search with
Pinecone MAINTENANCE_TASKS                       model-scoped filtering
    │
    ▼
Maintenance UI / Todo List
```

## Canonical Naming & Synonym System (v5)

```
┌─────────────────────────────────────────────────────────────────┐
│  3-Layer Matching Architecture                                   │
│                                                                 │
│  Layer 1: Normalize (deterministic)                              │
│  ├── Uppercase, strip spaces/hyphens                             │
│  ├── Python: normalize_model_key()                               │
│  └── Node: normalizeModelKey()                                   │
│                                                                 │
│  Layer 2: Alias Expansion (bounded)                              │
│  ├── ref_model_synonyms (17 rows)                                │
│  ├── ref_manufacturers.synonyms[] (per-manufacturer aliases)     │
│  ├── ref_product_types.synonyms[] (per-type aliases)             │
│  ├── systems.colloquial_keywords (from doc extraction)           │
│  └── Wired into search_systems RPC at chat time                  │
│                                                                 │
│  Layer 3: (Deferred) Typo resolution via LLM                     │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Summary (v5)

### 1. Document Upload
- Admin navigates to /ingest (document-ingest.html)
- Selects system from dropdown (with v5 reference table lookups)
- Uploads PDF → stored in Supabase Storage `/manuals/{doc_id}/`

### 2. Parsing & Model Detection
- LlamaParse processes PDF → markdown + layout data
- gpt-4.1-mini analyzes full markdown for model detection
- If multi-model manual: pipeline pauses for user model selection
- User confirms which model(s) are on their boat

### 3. Vision & Figure Extraction
- LlamaParse layout data identifies figures, diagrams, tables
- Figures cropped and stored as doc_assets with model attribution
- Each asset tagged with applies_to_models[]

### 4. Chunking & Indexing
- Semantic chunking with v5 metadata tags
- High-recall approach: keep most content, filter at query time
- Vectors upserted to Pinecone with model-scoped metadata

### 5. DIP Extraction (Streaming)
- Anthropic Claude extracts structured data via SSE streaming
- 5 categories run 2-at-a-time with prompt caching
- Writes directly to production tables (no staging/approval workflow)
- Each record tagged with applies_to_models[]

### 6. Chat Consumption
- Chat queries use production_dip_retriever.py
- Model-scoped filtering via applies_to_models[]
- doc_assets retrieved via 2-stage LLM selector
- Figures/tables shown inline when LLM recommends

## Key Components

### Node.js API
- **Express.js** server with modular routing
- **Admin ingest orchestration** (document-ingest flow)
- **Vision pipeline service** (vision-pipeline.service.js)
- **Funnel statistics** (funnel.service.js)
- **Admin authentication** via headers

### Python Sidecar
- **FastAPI** application
- **LlamaParse** integration (replaces pdfplumber)
- **Model detection** via gpt-4.1-mini
- **DIP extraction** via Anthropic Claude with SSE streaming + prompt caching
- **Vision analysis** via LlamaParse layout extraction
- **Document indexing** with v5 chunk metadata

### Data Storage
- **Supabase Database**:
  - Reference tables: `ref_manufacturers`, `ref_product_types`, `ref_system_categories`, `ref_subsystem_categories`
  - Canonical models: `ref_canonical_models`, `ref_model_synonyms`
  - System graph: `system_relationships`, `centroids`, `centroid_members`
  - Documents: `documents`, `document_chunks`, `doc_assets`, `document_referenced_systems`
  - DIP production: `spec_suggestions`, `playbook_hints`, `intent_router`, `golden_tests`, `troubleshooting`
  - Training data: `agent_training_decisions`, `agent_config` (preserved across purge)
- **Supabase Storage**: PDF files (`/manuals/`), supply photos, anchorage photos
- **Pinecone**:
  - `REIMAGINEDDOCS` - Document chunk vectors with v5 metadata
  - `MAINTENANCE_TASKS` - Maintenance agent output

## Environment Variables

### Node.js
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `PINECONE_API_KEY`, `PINECONE_INDEX`
- `OPENAI_API_KEY`
- `PYTHON_SIDECAR_URL`

### Python Sidecar
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `PINECONE_API_KEY`, `PINECONE_INDEX`
- `OPENAI_API_KEY`, `OPENAI_SUMMARY_MODEL` (gpt-4.1-mini)
- `ANTHROPIC_API_KEY` (for DIP extraction)
- `LLAMA_CLOUD_API_KEY` (for LlamaParse)

## Related Documentation

- [Documents](./20-admin-tools/documents.md) - Document upload and DIP details
- [Systems](./20-admin-tools/systems.md) - Equipment inventory and reference tables
- [Maintenance](./10-user-features/maintenance.md) - Maintenance agent pipeline
- [Python Sidecar](./30-backend/python-sidecar.md) - Sidecar endpoints and architecture
- [Chat](./10-user-features/chat.md) - Chat retrieval and doc_assets
- [Environments](./00-foundations/environments.md) - Service deployment

# Document Processing Pipeline Architecture

## Overview

This diagram shows the complete document processing pipeline from upload through DIP extraction to chat consumption.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Two Extraction Systems (Both read from same document vectors)  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. DIP Pipeline (Python Sidecar)                               │
│     → Extracts: specs, procedures, troubleshooting, routing     │
│     → Stores: Supabase staging_* tables                         │
│     → Used by: Chat AI (production_dip_retriever.py)            │
│                                                                 │
│  2. Maintenance Agent (separate service, port 3001)             │
│     → Extracts: maintenance tasks with scheduling               │
│     → Stores: Pinecone MAINTENANCE_TASKS + Supabase index       │
│     → Used by: Maintenance UI, todo list                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Document Ingestion Flow

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Admin UI      │    │   Node.js API    │    │ Python Sidecar  │
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │ Upload Form │ │───▶│ │ /document/   │ │───▶│ │ /v1/process │ │
│ │             │ │    │ │ ingest       │ │    │ │ -document   │ │
│ └─────────────┘ │    │ └──────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │   Jobs Table     │    │   PDF Parser    │
                       │                  │    │                 │
                       │ ┌──────────────┐ │    │ ┌─────────────┐ │
                       │ │ status:      │ │    │ │ Text Extract│ │
                       │ │ queued →     │ │    │ └─────────────┘ │
                       │ │ processing → │ │    └─────────────────┘
                       │ │ completed    │ │             │
                       │ └──────────────┘ │             ▼
                       └──────────────────┘    ┌─────────────────┐
                                               │   Chunking      │
                                               │                 │
                                               │ ┌─────────────┐ │
                                               │ │ Page Chunks │ │
                                               │ └─────────────┘ │
                                               └─────────────────┘
                                                        │
                       ┌────────────────────────────────┼────────────────────────────────┐
                       ↓                                ↓                                ↓
              ┌─────────────────┐             ┌─────────────────┐             ┌─────────────────┐
              │   Embedding     │             │   Supabase      │             │   DIP Service   │
              │                 │             │   Database      │             │   (/v1/dip)     │
              │ ┌─────────────┐ │             │                 │             │                 │
              │ │ OpenAI API  │ │             │ ┌─────────────┐ │             │ ┌─────────────┐ │
              │ │ text-embed- │ │             │ │ document_   │ │             │ │ LLM Extract │ │
              │ │ ding-3-small│ │             │ │ chunks      │ │             │ │ (gpt-4o)    │ │
              │ └─────────────┘ │             │ └─────────────┘ │             │ └─────────────┘ │
              └─────────────────┘             └─────────────────┘             └─────────────────┘
                       │                                                              │
                       ▼                                                              ▼
              ┌─────────────────┐                                            ┌─────────────────┐
              │   Pinecone      │                                            │   DIP Staging   │
              │                 │                                            │   Tables        │
              │ ┌─────────────┐ │                                            │                 │
              │ │ REIMAGINED- │ │                                            │ staging_spec_   │
              │ │ DOCS        │ │                                            │   suggestions   │
              │ │ namespace   │ │                                            │ staging_play-   │
              │ │             │ │                                            │   book_hints    │
              │ │ (2,794      │ │                                            │ staging_intent_ │
              │ │  vectors)   │ │                                            │   router        │
              │ └─────────────┘ │                                            │ staging_golden_ │
              └─────────────────┘                                            │   tests         │
                                                                             └─────────────────┘
```

## DIP Pipeline Detail

```
┌─────────────────────────────────────────────────────────────────┐
│  Python Sidecar: /v1/dip/extract                                │
│                                                                 │
│  Input: asset_uid                                               │
│  Process: Read chunks from document_chunks → LLM extraction     │
│  Output: 4 types of extracted data                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Staging Tables (status: pending → approved/declined)           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ staging_spec_suggestions     │ Equipment specifications  │   │
│  │ (1,953 rows)                 │ Part numbers, ratings     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ staging_playbook_hints       │ Step-by-step procedures   │   │
│  │ (1,132 rows)                 │ How-to instructions       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ staging_intent_router        │ Query classification      │   │
│  │ (2,230 rows)                 │ Intent → handler mapping  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ staging_golden_tests         │ Troubleshooting Q&A       │   │
│  │ (1,745 rows)                 │ Diagnostic questions      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Total: 7,060 items across 76 systems                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (Admin approval)
┌─────────────────────────────────────────────────────────────────┐
│  Production Tables (approved items only)                        │
│                                                                 │
│  ├── spec_suggestions   (12 rows)                               │
│  ├── playbook_hints     (29 rows)                               │
│  ├── intent_router      (15 rows)                               │
│  └── golden_tests       (15 rows)                               │
│                                                                 │
│  Total: 71 approved items                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Chat AI (production_dip_retriever.py)                          │
│                                                                 │
│  Query Type → Production Table:                                 │
│  ├── "spec"            → spec_suggestions                       │
│  ├── "procedure"       → playbook_hints                         │
│  ├── "troubleshooting" → golden_tests                           │
│  └── "routing"         → intent_router                          │
└─────────────────────────────────────────────────────────────────┘
```

## DIP Status Workflow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   pending   │───▶│  approved   │───▶│ Production  │
│             │    │             │    │   Table     │
│ (initial)   │    │ (reviewed)  │    │   (copy)    │
└─────────────┘    └─────────────┘    └─────────────┘
       │
       ▼
┌─────────────┐
│  declined   │
│             │
│ (rejected)  │
│ NOT copied  │
└─────────────┘

Note: Staging records are UPDATED (not deleted) when approved/declined.
Staging tables serve as audit trail.
```

## Full Document Lifecycle

```
Systems (119 total)
    │
    ▼
Documents uploaded (81 PDFs for 76 systems)
    │
    ▼
Supabase Storage (81 files)
    │
    ▼
Jobs table (24 processed: 18 completed, 2 failed, 4 queued)
    │
    ├─────────────────────────────────────────────┐
    ▼                                             ▼
Pinecone Vectors                           DIP Staging
(2,794 chunks for 76 systems)              (7,060 items for 76 systems)
├── REIMAGINEDDOCS (2,377)                 ├── staging_spec_suggestions
└── MAINTENANCE (417)                      ├── staging_playbook_hints
    │                                      ├── staging_intent_router
    │                                      └── staging_golden_tests
    │                                             │
    │                                             ▼
    │                                      Human Review
    │                                      (pending → approved/declined)
    │                                             │
    │                                             ▼
    │                                      Production Tables (71 items)
    │                                      ├── spec_suggestions (12)
    │                                      ├── playbook_hints (29)
    │                                      ├── intent_router (15)
    │                                      └── golden_tests (15)
    │                                             │
    ├─────────────────────────────────────────────┤
    │                                             │
    ▼                                             ▼
Maintenance Agent                          Chat AI
(6-step pipeline)                          (production_dip_retriever.py)
    │
    ▼
Pinecone MAINTENANCE_TASKS
    │
    ▼
Maintenance UI / Todo List
```

## Data Flow Summary

### 1. Document Upload
- User uploads PDF via Admin UI
- Node.js API receives file and metadata
- Job created in `jobs` table (status: queued)

### 2. Document Processing
- Python sidecar processes PDF
- Extracts text and creates page chunks
- Generates embeddings via OpenAI API

### 3. Data Persistence
- Chunks stored in Supabase database (`document_chunks` table)
- Vectors stored in Pinecone REIMAGINEDDOCS namespace
- Job status updated to completed

### 4. DIP Generation
- Node.js calls Python sidecar `/v1/dip/extract` endpoint
- Python reads chunks from Supabase database
- LLM extracts entities, specs, procedures, troubleshooting
- Stores in 4 staging tables (status: pending)

### 5. Human Review
- Admin reviews staging items via admin UI
- Approves or declines each item
- Approved items copied to production tables

### 6. Chat Consumption
- Chat queries use `production_dip_retriever.py`
- Retrieves from production tables based on query type
- Only approved items are returned

## Key Components

### Node.js API
- **Express.js** server with modular routing
- **Job queue** for async processing (jobs table)
- **Admin authentication** via headers
- **Error handling** and logging

### Python Sidecar
- **FastAPI** application
- **PDF parsing** and text extraction
- **OpenAI integration** for embeddings + DIP extraction
- **Supabase integration** for persistence

### Data Storage
- **Supabase Database**:
  - `documents` - Document metadata
  - `document_chunks` - Chunked text with metadata
  - `jobs` - Processing job status
  - `staging_*` - DIP extraction staging
  - Production tables for approved DIP items
- **Supabase Storage**: PDF files
- **Pinecone**:
  - `REIMAGINEDDOCS` - Document chunk vectors
  - `MAINTENANCE` - Legacy vectors
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
- `OPENAI_API_KEY`

## Error Handling

- **Graceful degradation**: Pinecone failures don't block chunk persistence
- **Retry logic**: Failed jobs can be retried
- **Logging**: Comprehensive logging at each step
- **Monitoring**: Health checks and status endpoints

## Related Documentation

- [Documents](./20-admin-tools/documents.md) - Document upload and DIP details
- [Maintenance](./10-user-features/maintenance.md) - Maintenance agent pipeline
- [Environments](./00-foundations/environments.md) - Service deployment

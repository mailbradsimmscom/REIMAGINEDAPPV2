# Document Processing Pipeline Architecture

## Overview

This diagram shows the complete document processing pipeline from upload to DIP generation.

## Architecture Flow

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
                       │   Job Queue      │    │   PDF Parser    │
                       │                  │    │                 │
                       │ ┌──────────────┐ │    │ ┌─────────────┐ │
                       │ │ Job Processor│ │    │ │ Text Extract│ │
                       │ └──────────────┘ │    │ └─────────────┘ │
                       └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │   DIP Service    │    │   Chunking      │
                       │                  │    │                 │
                       │ ┌──────────────┐ │    │ ┌─────────────┐ │
                       │ │ /v1/dip      │ │    │ │ Page Chunks │ │
                       │ └──────────────┘ │    │ └─────────────┘ │
                       └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │   DIP Processor  │    │   Embedding     │
                       │                  │    │                 │
                       │ ┌──────────────┐ │    │ ┌─────────────┐ │
                       │ │ Entity Extract│ │    │ │ OpenAI API  │ │
                       │ │ Spec Hints   │ │    │ └─────────────┘ │
                       │ │ Golden Tests │ │    └─────────────────┘
                       │ └──────────────┘ │             │
                       └──────────────────┘             ▼
                                │              ┌─────────────────┐
                                ▼              │   Pinecone      │
                       ┌──────────────────┐    │                 │
                       │   DIP Storage    │    │ ┌─────────────┐ │
                       │                  │    │ │ Vector Store│ │
                       │ ┌──────────────┐ │    │ └─────────────┘ │
                       │ │ dip.json     │ │    └─────────────────┘
                       │ │ suggestions  │ │             │
                       │ └──────────────┘ │             ▼
                       └──────────────────┘    ┌─────────────────┐
                                │              │   Supabase      │
                                ▼              │                 │
                       ┌──────────────────┐    │ ┌─────────────┐ │
                       │   Supabase       │    │ │ DB Chunks   │ │
                       │   Storage        │    │ │ Storage     │ │
                       │                  │    │ │ Files       │ │
                       │ ┌──────────────┐ │    │ └─────────────┘ │
                       │ │ DIP Files    │ │    └─────────────────┘
                       │ │ Text Files   │ │
                       │ └──────────────┘ │
                       └──────────────────┘
```

## Data Flow

### 1. Document Upload
- User uploads PDF via Admin UI
- Node.js API receives file and metadata
- Job created in queue for processing

### 2. Document Processing
- Python sidecar processes PDF
- Extracts text and creates page chunks
- Generates embeddings via OpenAI API

### 3. Data Persistence
- Chunks stored in Supabase database (`document_chunks` table)
- Text files stored in Supabase storage (`manuals/{doc_id}/text/page-*.txt`)
- Vectors stored in Pinecone for search

### 4. DIP Generation
- Node.js calls Python sidecar `/v1/dip` endpoint
- Python reads chunks from Supabase database
- Generates Document Intelligence Packet (entities, hints, tests)
- Stores DIP files in Supabase storage

### 5. Completion
- Job marked as completed
- Admin UI shows processing results
- All artifacts available for retrieval

## Key Components

### Node.js API
- **Express.js** server with modular routing
- **Job queue** for async processing
- **Admin authentication** via headers
- **Error handling** and logging

### Python Sidecar
- **FastAPI** application
- **PDF parsing** and text extraction
- **OpenAI integration** for embeddings
- **Supabase integration** for persistence

### Data Storage
- **Supabase Database**: Document metadata and chunks
- **Supabase Storage**: PDF files, text files, DIP artifacts
- **Pinecone**: Vector embeddings for search

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

# API Documentation

## Overview

This document describes the current API behavior for the Express.js application. All endpoints follow a consistent response envelope pattern unless otherwise noted.

## Base URL
```
http://localhost:3000
```

## Authentication

### Admin Authentication
All `/admin/*` endpoints require authentication via the `x-admin-token` header:
```
x-admin-token: admin-secret-key
```

## Response Format

### Success Response Envelope
```json
{
  "success": true,
  "data": {
    // Endpoint-specific data
  }
}
```

### Error Response Envelope
```json
{
  "success": false,
  "error": "Error message description"
}
```

## Endpoints

### Health Check

#### GET /health
Returns basic health status.

**Response:**
```json
{
  "status": "ok",
  "uptimeSeconds": 12345
}
```

**Notes:**
- This endpoint does NOT use the standard success envelope
- Returns direct status object

### Systems

#### GET /systems
Returns paginated list of systems.

**Query Parameters:**
- `cursor` (optional): Pagination cursor
- `limit` (optional): Number of items per page (default: 20)

**Response:**
```json
{
  "success": true,
  "data": {
    "systems": [
      {
        "asset_uid": "uuid",
        "system_norm": "string",
        "subsystem_norm": "string",
        "manufacturer_norm": "string",
        "model_norm": "string",
        "canonical_model_id": "string",
        "description": "string",
        "manual_url": "string|null",
        "oem_page": "string|null",
        "spec_keywords": "string|null",
        "synonyms_fts": "string",
        "synonyms_human": "string",
        "search": "string"
      }
    ],
    "nextCursor": "string|null"
  }
}
```

#### GET /systems/search
Search systems by query.

**Query Parameters:**
- `q` (required): Search query (minimum 2 characters)
- `limit` (optional): Number of results (default: 20)

**Success Response:**
```json
{
  "success": true,
  "data": {
    "systems": [...],
    "nextCursor": "string|null"
  }
}
```

**Error Responses:**
- `400`: Missing query parameter
- `400`: Query too short (less than 2 characters)
- `500`: Internal server error (for invalid limit values)

#### GET /systems/:assetUid
Get specific system by UUID.

**Path Parameters:**
- `assetUid`: Valid UUID format

**Success Response:**
```json
{
  "success": true,
  "data": {
    // System object
  }
}
```

**Error Responses:**
- `400`: Invalid UUID format
- `404`: System not found

### Chat Enhanced

#### POST /chat/enhanced/process
Process a chat message.

**Request Body:**
```json
{
  "message": "string",
  "sessionId": "string|undefined",
  "threadId": "string|undefined"
}
```

**Success Response:**
```json
{
  "success": true,
  "data": {
    "assistantMessage": {
      "content": "string",
      "role": "assistant"
    },
    "sessionId": "string",
    "threadId": "string"
  }
}
```

**Error Responses:**
- `400`: Missing or empty message
- `400`: Invalid request data

#### GET /chat/enhanced/list
List chat sessions.

**Response:**
```json
{
  "success": true,
  "data": {
    "chats": [
      {
        "id": "uuid",
        "name": "string",
        "description": "string",
        "createdAt": "ISO date",
        "updatedAt": "ISO date",
        "latestThread": {
          "id": "uuid",
          "name": "string",
          "createdAt": "ISO date",
          "updatedAt": "ISO date",
          "metadata": {
            "systemsContext": [],
            "pineconeResults": 0
          }
        }
      }
    ]
  }
}
```

#### GET /chat/enhanced/history
Get chat history for a thread.

**Query Parameters:**
- `threadId` (required): Valid UUID

**Success Response:**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "uuid",
        "content": "string",
        "role": "user|assistant",
        "createdAt": "ISO date"
      }
    ]
  }
}
```

**Error Responses:**
- `400`: Missing threadId
- `500`: Internal server error (when threadId is invalid)

#### GET /chat/enhanced/context
Get chat context for a thread.

**Query Parameters:**
- `threadId` (required): Valid UUID

**Success Response:**
```json
{
  "success": true,
  "data": {
    "context": {
      "systemsContext": [],
      "pineconeResults": []
    }
  }
}
```

**Error Responses:**
- `400`: Missing threadId

#### DELETE /chat/enhanced/:sessionId
Delete a chat session.

**Path Parameters:**
- `sessionId`: Valid UUID

**Success Response:**
```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

### Admin

#### GET /admin/health
Get admin health status.

**Headers Required:**
```
x-admin-token: admin-secret-key
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "ISO date",
    "uptime": 12345,
    "memory": {...},
    "environment": "development|production",
    "version": "string"
  }
}
```

**Error Responses:**
- `401`: Missing or invalid admin token

#### GET /admin/systems
Get system statistics.

**Headers Required:**
```
x-admin-token: admin-secret-key
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalSystems": 0,
    "documentsCount": 0,
    "jobsCount": 0
  }
}
```

#### GET /admin/logs
Get application logs.

**Headers Required:**
```
x-admin-token: admin-secret-key
```

**Response:**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "timestamp": "ISO date",
        "level": "info|error|warn",
        "message": "string",
        "metadata": {}
      }
    ]
  }
}
```

#### GET /admin/manufacturers
Get manufacturer statistics.

**Headers Required:**
```
x-admin-token: admin-secret-key
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 0,
    "top": [
      {
        "manufacturer": "string",
        "count": 0
      }
    ],
    "lastUpdated": "ISO date"
  }
}
```

#### GET /admin/models
Get model statistics.

**Headers Required:**
```
x-admin-token: admin-secret-key
```

**Response:**
```json
{
  "success": true,
  "data": {
    "models": [
      {
        "model": "string",
        "count": 0
      }
    ]
  }
}
```

#### GET /admin/pinecone
Get Pinecone statistics.

**Headers Required:**
```
x-admin-token: admin-secret-key
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalVectors": 0,
    "indexName": "string",
    "dimension": 0
  }
}
```

### Documents

#### POST /admin/docs/ingest
Ingest a document.

**Headers Required:**
```
x-admin-token: admin-secret-key
Content-Type: multipart/form-data
```

**Request Body:**
- `file`: PDF file
- `metadata` (optional): JSON string

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "uuid",
    "status": "processing"
  }
}
```

#### GET /admin/docs/jobs
List document processing jobs.

**Headers Required:**
```
x-admin-token: admin-secret-key
```

**Response:**
```json
{
  "success": true,
  "data": {
    "jobs": [
      {
        "id": "uuid",
        "status": "pending|processing|completed|failed",
        "filename": "string",
        "createdAt": "ISO date",
        "updatedAt": "ISO date"
      }
    ]
  }
}
```

#### GET /admin/docs/jobs/:jobId
Get job status.

**Headers Required:**
```
x-admin-token: admin-secret-key
```

**Response:**
```json
{
  "success": true,
  "data": {
    "job": {
      "id": "uuid",
      "status": "string",
      "progress": 0,
      "result": {}
    }
  }
}
```

#### GET /admin/docs/documents
List processed documents.

**Headers Required:**
```
x-admin-token: admin-secret-key
```

**Response:**
```json
{
  "success": true,
  "data": {
    "documents": [
      {
        "id": "uuid",
        "filename": "string",
        "status": "string",
        "createdAt": "ISO date"
      }
    ]
  }
}
```

#### GET /admin/docs/documents/:documentId
Get document details.

**Headers Required:**
```
x-admin-token: admin-secret-key
```

**Response:**
```json
{
  "success": true,
  "data": {
    "document": {
      "id": "uuid",
      "filename": "string",
      "content": "string",
      "metadata": {}
    }
  }
}
```

### Pinecone

#### GET /pinecone/stats
Get Pinecone index statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalVectorCount": 0,
    "indexDimension": 0,
    "indexMetric": "cosine|euclidean|dotproduct"
  }
}
```

#### POST /pinecone/search
Search vectors.

**Request Body:**
```json
{
  "query": "string",
  "topK": 10,
  "filter": {}
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "matches": [
      {
        "id": "string",
        "score": 0.95,
        "metadata": {}
      }
    ]
  }
}
```

**Error Responses:**
- `400`: Missing query
- `400`: Empty query

#### POST /pinecone/query
Query vectors.

**Request Body:**
```json
{
  "query": "string",
  "topK": 10,
  "includeMetadata": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "string",
        "score": 0.95,
        "metadata": {}
      }
    ]
  }
}
```

**Error Responses:**
- `400`: Missing query
- `400`: Non-string query

#### GET /pinecone/documents/:documentId/chunks
Get document chunks.

**Path Parameters:**
- `documentId`: Valid UUID

**Response:**
```json
{
  "success": true,
  "data": {
    "chunks": [
      {
        "id": "string",
        "content": "string",
        "metadata": {}
      }
    ]
  }
}
```

**Error Responses:**
- `500`: Internal server error (when documentId is invalid)

## Error Codes

### Common Error Messages

| Status | Message | Description |
|--------|---------|-------------|
| 400 | "Invalid request data" | Generic validation error |
| 400 | "Query parameter is required and must be at least 2 characters" | Search query validation |
| 400 | "Failed to get system: invalid input syntax for type uuid: \"invalid-id\"" | UUID validation error |
| 401 | "Unauthorized - Admin access required" | Missing or invalid admin token |
| 404 | "Not Found" | Route not found |
| 500 | "Internal Server Error" | Server-side error |

### Error Handling Notes

- Most validation errors return `400` status
- Database UUID errors return `400` with descriptive message
- Missing admin authentication returns `401`
- Non-existent routes return `404`
- Service/database errors return `500`

## Testing

### Test Coverage
- **96% success rate** (51/53 tests passing)
- All major endpoints tested
- Happy path and failure path coverage
- Authentication testing
- Error handling validation

### Known Issues
- Chat history endpoint returns 500 for some threadIds (service-level issue)
- Some validation endpoints return 500 instead of 400 (service-level issue)

## Version Information

- **Framework**: Express.js 5.1.0
- **Node.js**: 20.19.4
- **Test Runner**: Node.js native test runner
- **Database**: Supabase
- **Vector Database**: Pinecone

## Security

- Admin endpoints require `x-admin-token` header
- CORS configured for admin origin
- Security headers enabled (Helmet equivalent)
- Request size limits: 2MB for JSON/URL-encoded
- File upload limits: Configured per endpoint

## Python Sidecar API

The Python sidecar runs on `http://localhost:8000` and provides document processing capabilities.

### Base URL
```
http://localhost:8000
```

### Document Processing

#### POST /v1/process-document
Processes a PDF document for Pinecone embedding and chunk persistence.

**Request:**
- Content-Type: `multipart/form-data`
- Fields:
  - `file`: PDF file (required)
  - `doc_metadata`: JSON string with document metadata (required)
  - `extract_tables`: boolean (default: true)
  - `ocr_enabled`: boolean (default: true)

**Response:**
```json
{
  "success": true,
  "doc_id": "document_id",
  "chunks_processed": 22,
  "vectors_upserted": 22,
  "chunks_written_db": 22,
  "chunks_written_storage": 22,
  "namespace": "REIMAGINEDDOCS"
}
```

#### POST /v1/dip
Generates Document Intelligence Packet from existing document chunks.

**Request:**
- Content-Type: `application/json`
- Body:
```json
{
  "doc_id": "document_id"
}
```

**Response:**
```json
{
  "success": true,
  "doc_id": "document_id",
  "pages": 22,
  "entities_count": 113,
  "hints_count": 54,
  "tests_count": 12,
  "artifacts": {
    "dip": "documents/manuals/doc_id/dip.json",
    "suggestions": "documents/manuals/doc_id/suggestions.json"
  }
}
```

### Health Check

#### GET /health
Returns sidecar health status.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-10T00:00:00Z"
}
```

### Pinecone Statistics

#### GET /v1/pinecone/stats
Returns Pinecone index statistics.

**Response:**
```json
{
  "total_vectors": 75,
  "namespace": "REIMAGINEDDOCS"
}
```

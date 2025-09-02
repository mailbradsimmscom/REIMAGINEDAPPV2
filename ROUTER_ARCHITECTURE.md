# Express Router Architecture

## Overview
This application uses a modular Express router architecture with proper middleware integration, security headers, and error handling.

## Router Structure

### 1. Health Router (`/health`)
- **File:** `src/routes/health.router.js`
- **Purpose:** System health monitoring
- **Routes:**
  - `GET /health` - Health check endpoint

### 2. Systems Router (`/systems`)
- **File:** `src/routes/systems.router.js`
- **Purpose:** System management and search
- **Routes:**
  - `GET /systems` - List all systems
  - `GET /systems/search` - Search systems with query parameters
  - `GET /systems/:assetUid` - Get specific system by ID

### 3. Chat Router (`/chat/enhanced`)
- **File:** `src/routes/chat.router.js`
- **Purpose:** Enhanced chat functionality
- **Routes:**
  - `POST /chat/enhanced/process` - Process chat messages
  - `GET /chat/enhanced/list` - List chat sessions
  - `GET /chat/enhanced/history` - Get chat history
  - `GET /chat/enhanced/context` - Get chat context
  - `DELETE /chat/enhanced/delete` - Delete chat session (body)
  - `DELETE /chat/enhanced/:sessionId` - Delete chat session (path)

### 4. Admin Router (`/admin`)
- **File:** `src/routes/admin.router.js`
- **Purpose:** Administrative functions
- **Middleware:** `adminGate` applied to all routes
- **Routes:**
  - `GET /admin` - Admin dashboard page
  - `GET /admin/health` - System health status
  - `GET /admin/logs` - Log file access
  - `GET /admin/systems` - Systems statistics
  - `GET /admin/manufacturers` - Manufacturer statistics
  - `GET /admin/models` - Model statistics
  - `GET /admin/pinecone` - Pinecone statistics

### 5. Document Router (`/admin/docs`)
- **File:** `src/routes/document.router.js`
- **Purpose:** Document management
- **Middleware:** `adminGate` applied to all routes
- **Routes:**
  - `POST /admin/docs/ingest` - Document ingestion
  - `GET /admin/docs/jobs` - List document jobs
  - `GET /admin/docs/jobs/:id` - Get job status
  - `GET /admin/docs/documents` - List documents
  - `GET /admin/docs/documents/:id` - Get document details

### 6. Pinecone Router (`/pinecone`)
- **File:** `src/routes/pinecone.router.js`
- **Purpose:** Vector database operations
- **Routes:**
  - `GET /pinecone/stats` - Get index statistics
  - `POST /pinecone/search` - Search vectors
  - `POST /pinecone/query` - Query vectors
  - `GET /pinecone/documents/:docId/chunks` - Get document chunks

## Middleware Stack

### Global Middleware (Applied to All Routes)
1. **Security Headers** (`securityHeaders`) - Essential security headers
2. **Rate Limiting** (`basicRateLimit`) - Request rate limiting
3. **CORS** (`cors`) - Cross-origin resource sharing
4. **Body Parsing** (`express.json`, `express.urlencoded`) - Request body parsing
5. **Logging** - Request logging
6. **Static Files** (`express.static`) - Serve static assets

### Route-Specific Middleware
- **Admin Routes:** `adminGate` middleware for authentication
- **Validation:** `validate(schema, target)` middleware for request validation

## Route Precedence

Routes are mounted in order of specificity:
1. `/admin/docs` - Most specific admin route
2. `/admin` - General admin route
3. `/chat/enhanced` - Chat functionality
4. `/systems` - System management
5. `/pinecone` - Vector operations
6. `/health` - Health monitoring

## Error Handling

### Global Error Middleware
- **404 Handler** (`notFoundHandler`) - Handle unmatched routes
- **Error Handler** (`errorHandler`) - Centralized error processing

### Error Response Format
```json
{
  "success": false,
  "code": "ERROR_CODE",
  "message": "Error description",
  "details": "Additional error details (optional)"
}
```

## Security Features

### Headers Applied
- Content Security Policy (CSP)
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- X-XSS-Protection: 1; mode=block
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()

### Authentication
- Admin routes require `x-admin-token` header
- Rate limiting: 100 requests per 15 minutes per IP
- Request size limits: 2MB for JSON and URL-encoded data

## CORS Configuration

### Allowed Origins
- `http://localhost:3000`
- `http://localhost:3001`
- `http://127.0.0.1:3000`
- `http://127.0.0.1:3001`

### Allowed Methods
- GET, POST, PUT, DELETE, OPTIONS

### Allowed Headers
- Content-Type, Authorization, x-admin-token

## Testing

All routers are covered by comprehensive integration tests:
- **59 total tests** covering all endpoints
- **Happy path tests** for successful operations
- **Failure path tests** for error conditions
- **Security tests** for headers and authentication
- **Validation tests** for request/response schemas

## Best Practices

1. **Modular Design:** Each router handles a specific domain
2. **Middleware Composition:** Reusable middleware for cross-cutting concerns
3. **Error Handling:** Centralized error processing with consistent format
4. **Security First:** Security headers and authentication applied globally
5. **Validation:** Zod schemas for request/response validation
6. **Testing:** Comprehensive test coverage for all endpoints

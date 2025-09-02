# Express Router Architecture

## Overview
This application uses a modular Express router architecture with proper middleware integration, security headers, and error handling. The router structure has been optimized for maintainability by splitting large routers into individual endpoint-specific files.

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
- **Directory:** `src/routes/chat/`
- **Purpose:** Enhanced chat functionality
- **Structure:** Split into individual endpoint files for maintainability
- **Files:**
  - `index.js` - Barrel export combining all chat routes
  - `process.route.js` - Message processing (`POST /process`)
  - `history.route.js` - Chat history (`GET /history`)
  - `list.route.js` - Chat listing (`GET /list`)
  - `context.route.js` - Chat context (`GET /context`)
  - `delete.route.js` - Body-based deletion (`DELETE /delete`)
  - `session-delete.route.js` - Path-based deletion (`DELETE /:sessionId`)

### 4. Admin Router (`/admin`)
- **Directory:** `src/routes/admin/`
- **Purpose:** Administrative functions
- **Middleware:** `adminGate` applied to all routes
- **Structure:** Split into individual endpoint files for maintainability
- **Files:**
  - `index.js` - Barrel export combining all admin routes
  - `dashboard.route.js` - Admin dashboard page (`GET /`)
  - `health.route.js` - System health status (`GET /health`)
  - `logs.route.js` - Log file access (`GET /logs`)
  - `systems.route.js` - Systems statistics (`GET /systems`)
  - `manufacturers.route.js` - Manufacturer statistics (`GET /manufacturers`)
  - `models.route.js` - Model statistics (`GET /models`)
  - `pinecone.route.js` - Pinecone statistics (`GET /pinecone`)

### 5. Document Router (`/admin/docs`)
- **Directory:** `src/routes/document/`
- **Purpose:** Document management
- **Middleware:** `adminGate` applied to all routes
- **Structure:** Split into individual endpoint files for maintainability
- **Files:**
  - `index.js` - Barrel export combining all document routes
  - `ingest.route.js` - Document ingestion (`POST /ingest`)
  - `jobs.route.js` - Job listing (`GET /jobs`)
  - `job-status.route.js` - Individual job status (`GET /jobs/:jobId`)
  - `documents.route.js` - Document listing (`GET /documents`)
  - `get-one.route.js` - Single document details (`GET /documents/:docId`)

### 6. Pinecone Router (`/pinecone`)
- **File:** `src/routes/pinecone.router.js`
- **Purpose:** Vector database operations
- **Routes:**
  - `GET /pinecone/stats` - Get index statistics
  - `POST /pinecone/search` - Search vectors
  - `POST /pinecone/query` - Query vectors
  - `GET /pinecone/documents/:docId/chunks` - Get document chunks

## Split Router Benefits

### File Size Optimization
- **Before:** Large routers (219-291 lines each)
- **After:** Individual files (≤117 lines each)
- **Result:** Improved maintainability and Cursor rules compliance

### Team Collaboration
- **Reduced Merge Conflicts:** Each endpoint has its own file
- **Clearer Ownership:** Developers can work on specific endpoints
- **Easier Code Reviews:** Smaller, focused changes

### Maintainability
- **Single Responsibility:** Each file handles one endpoint type
- **Easy Navigation:** Find specific functionality quickly
- **Isolated Changes:** Modifications don't affect other endpoints

## Barrel Export Pattern

Each split router uses a barrel export pattern:
```javascript
// src/routes/admin/index.js
import express from 'express';
import dashboardRouter from './dashboard.route.js';
import healthRouter from './health.route.js';
// ... other imports

const router = express.Router();
router.use('/', dashboardRouter);
router.use('/health', healthRouter);
// ... other routes

export default router;
```

This maintains the same import interface while providing better internal organization.

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
- **Document Routes:** `adminGate` middleware for authentication
- **Validation:** `validate(schema, target)` middleware for request validation
- **Response Validation:** `validateResponse(schema, routeName)` for response validation

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
- **66 total tests** covering all endpoints
- **Happy path tests** for successful operations
- **Failure path tests** for error conditions
- **Security tests** for headers and authentication
- **Validation tests** for request/response schemas

## Best Practices

1. **Modular Design:** Each router handles a specific domain
2. **Split Architecture:** Large routers split into endpoint-specific files
3. **Barrel Exports:** Maintain clean import interfaces
4. **Middleware Composition:** Reusable middleware for cross-cutting concerns
5. **Error Handling:** Centralized error processing with consistent format
6. **Security First:** Security headers and authentication applied globally
7. **Validation:** Zod schemas for request/response validation
8. **Testing:** Comprehensive test coverage for all endpoints

## File Organization Guidelines

### When to Split Routers
- **File Size:** When a router exceeds ~200 lines
- **Endpoint Count:** When a router has 5+ endpoints
- **Complexity:** When endpoints have different concerns
- **Team Size:** When multiple developers work on the same router

### Naming Conventions
- **Route Files:** `{endpoint-name}.route.js`
- **Barrel Exports:** `index.js`
- **Directories:** `{router-name}/`

### Import Patterns
```javascript
// Main application
import adminRouter from './routes/admin/index.js';
import chatRouter from './routes/chat/index.js';
import documentRouter from './routes/document/index.js';

// Individual route files
import dashboardRouter from './dashboard.route.js';
import healthRouter from './health.route.js';
```

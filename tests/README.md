# API Test Documentation
# This document describes the current API behavior and test coverage

## Test Coverage Summary

### ✅ Health Endpoints
- `GET /health` - Basic health check
- `GET /admin/health` - Detailed system health
- Error handling for invalid methods

### ✅ Systems Endpoints  
- `GET /systems` - List all systems
- `GET /systems/search` - Search with query parameter
- `GET /systems/:id` - Get specific system
- Empty query handling

### ✅ Pinecone Endpoints
- `GET /pinecone/stats` - Get vector database statistics
- `POST /pinecone/search` - Search vectors with query
- `GET /pinecone/document/:id/chunks` - Get document chunks
- Namespace handling

### ✅ Admin Endpoints
- `GET /admin` - Admin dashboard HTML
- `GET /admin/logs` - System logs
- `GET /admin/systems` - Systems overview
- `GET /admin/pinecone` - Pinecone status
- `GET /admin/systems/manufacturers` - Manufacturers list
- `GET /admin/systems/models` - Models by manufacturer

### ✅ Document Processing Endpoints
- `GET /admin/docs/jobs` - List processing jobs
- `GET /admin/docs/documents` - List documents
- `GET /admin/docs/ingest/:id` - Get job status
- 404 handling for non-existent jobs

### ✅ Chat Endpoints
- `POST /chat/enhanced/process` - Process user message
- `GET /chat/enhanced/history/:threadId` - Get chat history
- `GET /chat/enhanced/list` - List chat sessions
- `GET /chat/enhanced/context/:threadId` - Get chat context
- Invalid message validation

### ✅ Static Files
- `GET /` - Main page HTML
- `GET /styles.css` - CSS styles
- `GET /app.js` - JavaScript application

### ✅ Error Handling
- 404 for non-existent routes
- Method not allowed handling
- Invalid JSON parsing
- Empty/invalid input validation

## Response Format Standards

### Success Response Format
```json
{
  "success": true,
  "data": {
    // Endpoint-specific data
  },
  "timestamp": "2025-09-02T..."
}
```

### Error Response Format
```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional details"
}
```

### Health Response Format
```json
{
  "status": "ok",
  "uptimeSeconds": 12345
}
```

## Test Execution

### Run Baseline Tests
```bash
./tests/run-baseline.sh
```

### Run Individual Test Groups
```bash
node --test tests/baseline.test.js --grep "Health Endpoints"
node --test tests/baseline.test.js --grep "Chat Endpoints"
```

### Test Configuration
- Base URL: `http://localhost:3000`
- Timeout: 10 seconds per test
- Environment: Uses `env.js` configuration

## Pre-Zod Validation Notes

### Current Validation
- Basic type checking (`typeof message === 'string'`)
- Empty string validation
- JSON parsing error handling
- Method validation

### Areas for Zod Enhancement
- Request body schema validation
- Query parameter validation
- Response format validation
- Error message standardization

## Integration Points

### Database Dependencies
- Supabase connection required
- Systems data must be available
- Document processing jobs table

### External Services
- Pinecone vector database
- Python sidecar (port 8000)
- OpenAI API (for chat responses)

### File System
- Static files in `src/public/`
- Log files in `logs/` directory
- Upload file handling

## Performance Expectations

### Response Times
- Health checks: < 100ms
- Static files: < 50ms
- Database queries: < 500ms
- Chat processing: < 2000ms
- Document processing: < 5000ms

### Error Rates
- 404 errors: < 1%
- 500 errors: < 0.1%
- Timeout errors: < 0.01%

## Maintenance Notes

### Adding New Tests
1. Add test case to appropriate group in `baseline.test.js`
2. Follow existing naming conventions
3. Include both success and error cases
4. Update this documentation

### Test Data
- Use non-destructive test data
- Clean up any test artifacts
- Avoid modifying production data
- Use predictable test IDs

### Continuous Integration
- Tests should run in CI/CD pipeline
- Baseline tests must pass before deployment
- Monitor test execution time
- Alert on test failures

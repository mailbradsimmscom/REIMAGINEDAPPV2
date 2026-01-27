# Testing Tools & Test Matrix

## Overview

Testing tools provide interfaces for validating system behavior, running golden tests, and debugging DIP extraction. This document also contains a comprehensive **test matrix** documenting all automated tests.

**Who uses it:** Developers, QA
**Access:** `/public/testing.html`, `/public/testing-golden-tests.html`

---

## Test Architecture

```
tests/
├── integration/           # API endpoint tests
│   ├── health.test.js
│   ├── systems.test.js
│   ├── pinecone.test.js
│   ├── admin.test.js
│   ├── admin-auth.test.js
│   ├── chat.test.js
│   ├── document.test.js
│   ├── security.test.js
│   └── monitoring.test.js
├── unit/                  # Unit tests
│   ├── middleware/
│   │   ├── admin.test.js
│   │   └── serviceGuards.test.js
│   └── repositories/
│       └── guards.test.js
├── smoke/                 # Quick validation tests
├── nightly/               # Long-running tests
└── test-config.js         # Test helpers
```

---

## Test Matrix

### Health Endpoint Tests

**File:** `tests/integration/health.test.js`

| Name | Description | Route | Method | Payload | Expected Response | Variables |
|------|-------------|-------|--------|---------|-------------------|-----------|
| Basic Health Check | Verify service is running and healthy | `/health` | GET | none | `{ success: true, data: { status: 'healthy', timestamp: string, uptime: number } }` | none |
| Method Not Allowed (POST) | Verify POST method rejected | `/health` | POST | none | `{ success: false, error: { code: 'METHOD_NOT_ALLOWED' } }` - 405 | none |
| Method Not Allowed (PUT) | Verify PUT method rejected | `/health` | PUT | none | `{ success: false, error: { code: 'METHOD_NOT_ALLOWED' } }` - 405 | none |
| Method Not Allowed (DELETE) | Verify DELETE method rejected | `/health` | DELETE | none | `{ success: false, error: { code: 'METHOD_NOT_ALLOWED' } }` - 405 | none |
| Not Found | Verify 404 for invalid subpath | `/health/404` | GET | none | `{ success: false }` - 404 | none |

```javascript
// tests/integration/health.test.js:9-20
test('Health Route - Happy Path', async (t) => {
  await t.test('GET /health returns 200 with correct structure', async () => {
    const response = await publicRequest('get', '/health');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.data.status, 'healthy');
    assert.strictEqual(typeof response.body.data.timestamp, 'string');
    assert.strictEqual(typeof response.body.data.uptime, 'number');
  });
});
```

---

### Systems Endpoint Tests

**File:** `tests/integration/systems.test.js`

| Name | Description | Route | Method | Payload | Expected Response | Variables |
|------|-------------|-------|--------|---------|-------------------|-----------|
| List Systems | Get all systems | `/systems` | GET | none | `{ success: true, data: { systems: [] } }` - 200 | none |
| Search Systems | Search with valid query | `/systems/search?q=test` | GET | query: `q=test` | `{ success: true, data: { systems: [] } }` - 200 | none |
| Search with Limit | Search with limit param | `/systems/search?q=test&limit=5` | GET | query: `q=test&limit=5` | `{ success: true, data: { systems: [] } }` - 200 | none |
| Missing Query | Search without q param | `/systems/search` | GET | none | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | none |
| Empty Query | Search with empty q | `/systems/search?q=` | GET | query: `q=` | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | none |
| Short Query | Query too short (1 char) | `/systems/search?q=a` | GET | query: `q=a` | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | none |
| Invalid Limit | Non-numeric limit | `/systems/search?q=test&limit=invalid` | GET | query: `q=test&limit=invalid` | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | none |
| Invalid System ID | Get system by invalid ID | `/systems/invalid-id` | GET | none | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | none |

```javascript
// tests/integration/systems.test.js:33-56
test('Systems Routes - Failure Path', async (t) => {
  await t.test('GET /systems/search without query returns 400', async () => {
    const response = await publicRequest('get', '/systems/search');

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });
});
```

---

### Pinecone Endpoint Tests

**File:** `tests/integration/pinecone.test.js`

| Name | Description | Route | Method | Payload | Expected Response | Variables |
|------|-------------|-------|--------|---------|-------------------|-----------|
| Search Vectors | Search with valid query | `/pinecone/search` | POST | `{ query: "test", context: "test" }` | `{ success: true/false, data/error }` - 200/503 | `PYTHON_SIDECAR_URL` |
| Get Stats | Get index statistics | `/pinecone/stats` | GET | none | `{ success: true/false, data/error }` - 200/503 | `PYTHON_SIDECAR_URL` |
| Get Document Chunks | Get chunks by doc ID | `/pinecone/documents/:docId/chunks` | GET | none | `{ success: true/false, data/error }` - 200/503 | `PYTHON_SIDECAR_URL` |
| Query Vectors | Query with filter | `/pinecone/query` | POST | `{ query: "test", context: "test" }` | `{ success: true/false, data/error }` - 200/503 | `PYTHON_SIDECAR_URL` |
| Missing Query (search) | POST without query | `/pinecone/search` | POST | `{}` | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | none |
| Empty Query (search) | POST with empty query | `/pinecone/search` | POST | `{ query: "", context: "test" }` | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | none |
| Missing Query (query) | POST without query | `/pinecone/query` | POST | `{}` | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | none |
| Empty Query (query) | POST with empty query | `/pinecone/query` | POST | `{ query: "", context: "test" }` | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | none |
| Wrong Method (search GET) | GET on POST-only route | `/pinecone/search` | GET | none | `{ success: false, error: { code: 'METHOD_NOT_ALLOWED' } }` - 405 | none |
| Wrong Method (search PUT) | PUT on POST-only route | `/pinecone/search` | PUT | none | `{ success: false, error: { code: 'METHOD_NOT_ALLOWED' } }` - 405 | none |
| Wrong Method (search DELETE) | DELETE on POST-only route | `/pinecone/search` | DELETE | none | `{ success: false, error: { code: 'METHOD_NOT_ALLOWED' } }` - 405 | none |
| Wrong Method (query GET) | GET on POST-only route | `/pinecone/query` | GET | none | `{ success: false, error: { code: 'METHOD_NOT_ALLOWED' } }` - 405 | none |
| Invalid Route | Unknown Pinecone route | `/pinecone/invalid-route` | GET | none | `{ success: false }` - 404 | none |

```javascript
// tests/integration/pinecone.test.js:77-92
test('Pinecone Routes - Failure Path', async (t) => {
  await t.test('POST /pinecone/search without query returns 400', async () => {
    const response = await postRequest('/pinecone/search', {});

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });
});
```

---

### Admin Endpoint Tests

**File:** `tests/integration/admin.test.js`

| Name | Description | Route | Method | Payload | Expected Response | Variables |
|------|-------------|-------|--------|---------|-------------------|-----------|
| Admin Health | Get admin health status | `/admin/api/health` | GET | none | `{ success: true, data: { status: 'healthy' } }` - 200 | `ADMIN_TOKEN` |
| Admin Systems | Get system statistics | `/admin/api/systems` | GET | none | `{ success: true, data: { totalSystems, documentsCount, jobsCount } }` - 200 | `ADMIN_TOKEN` |
| Admin Logs | Get system logs | `/admin/api/logs` | GET | none | `{ success: true, data: { logs: [] } }` - 200 | `ADMIN_TOKEN` |
| Admin Manufacturers | List manufacturers | `/admin/api/manufacturers` | GET | none | `{ success: true/false }` - 200/500 | `ADMIN_TOKEN`, `SUPABASE_URL` |
| Admin Models | List models | `/admin/api/models` | GET | none | `{ success: true/false }` - 200/400 | `ADMIN_TOKEN`, `SUPABASE_URL` |
| Admin Pinecone | Get Pinecone status | `/admin/api/pinecone` | GET | none | `{ success: true/false }` - 200/500 | `ADMIN_TOKEN`, `PYTHON_SIDECAR_URL` |
| Invalid Route | Unknown admin route | `/admin/api/invalid-route` | GET | none | `{ success: false }` - 404 | `ADMIN_TOKEN` |
| Wrong Method (health) | POST on GET-only route | `/admin/api/health` | POST | none | `{ success: false }` - 405 | `ADMIN_TOKEN` |

```javascript
// tests/integration/admin.test.js:9-24
test('Admin Routes - Happy Path', async (t) => {
  await t.test('GET /admin/health returns 200 with health status', async () => {
    const response = await adminRequest('get', '/admin/api/health');

    assertSuccess(response, 200);
    assert.strictEqual(response.body.data.status, 'healthy');
  });

  await t.test('GET /admin/systems returns 200 with system stats', async () => {
    const response = await adminRequest('get', '/admin/api/systems');

    assertSuccess(response, 200);
    assert.strictEqual(typeof response.body.data.totalSystems, 'number');
  });
});
```

---

### Admin Authentication Tests

**File:** `tests/integration/admin-auth.test.js`, `tests/unit/middleware/admin.test.js`

| Name | Description | Route | Method | Payload | Expected Response | Variables |
|------|-------------|-------|--------|---------|-------------------|-----------|
| Valid Token (header) | Access with x-admin-token | `/admin/api/health` | GET | header: `x-admin-token` | `{ success: true }` - 200 | `ADMIN_TOKEN` |
| Valid Token (Bearer) | Access with Authorization header | `/admin/api/health` | GET | header: `Authorization: Bearer <token>` | `{ success: true }` - 200 | `ADMIN_TOKEN` |
| Missing Token | No authentication provided | `/admin/api/health` | GET | none | `{ success: false, error: { code: 'UNAUTHORIZED' } }` - 401 | none |
| Invalid Token | Wrong token value | `/admin/api/health` | GET | header: `x-admin-token: wrong-token` | `{ success: false, error: { code: 'FORBIDDEN' } }` - 403 | none |
| Invalid Bearer | Wrong Bearer token | `/admin/api/health` | GET | header: `Authorization: Bearer wrong-token` | `{ success: false, error: { code: 'FORBIDDEN' } }` - 403 | none |
| Protected Docs Jobs | Docs endpoint requires auth | `/admin/docs/jobs` | GET | none | `{ success: false, error: { code: 'UNAUTHORIZED' } }` - 401 | none |

```javascript
// tests/unit/middleware/admin.test.js:9-27
test('Admin authentication - missing token returns 401', async () => {
  const response = await request(app)
    .get(ADMIN_HEALTH_ROUTE)
    .expect(401);

  assert.strictEqual(response.body.success, false);
  assert.strictEqual(response.body.error.code, 'UNAUTHORIZED');
});

test('Admin authentication - wrong token returns 403', async () => {
  const response = await request(app)
    .get(ADMIN_HEALTH_ROUTE)
    .set('x-admin-token', 'wrong-token')
    .expect(403);

  assert.strictEqual(response.body.success, false);
  assert.strictEqual(response.body.error.code, 'FORBIDDEN');
});
```

---

### Chat Endpoint Tests

**File:** `tests/integration/chat.test.js`

| Name | Description | Route | Method | Payload | Expected Response | Variables |
|------|-------------|-------|--------|---------|-------------------|-----------|
| Process Message | Send chat message | `/chat/enhanced/process` | POST | `{ message: "test" }` | `{ success: true, data: { assistantMessage: { content } } }` - 200 | `PYTHON_SIDECAR_URL`, `OPENAI_API_KEY` |
| List Chats | Get chat sessions | `/chat/enhanced/list` | GET | none | `{ success: true, data: { chats: [] } }` - 200 | `SUPABASE_URL` |
| Get History | Get chat history by thread | `/chat/enhanced/history?threadId=<uuid>` | GET | query: `threadId=<uuid>` | `{ success: true, data: { messages: [] } }` - 200 | `SUPABASE_URL` |
| Missing Message | POST without message | `/chat/enhanced/process` | POST | `{}` | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | none |
| Empty Message | POST with empty message | `/chat/enhanced/process` | POST | `{ message: "" }` | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | none |
| Invalid Payload | POST with wrong fields | `/chat/enhanced/process` | POST | `{ invalid: "data" }` | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | none |
| Missing Thread ID | Get history without threadId | `/chat/enhanced/history` | GET | none | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | none |
| Missing Context Thread | Get context without threadId | `/chat/enhanced/context` | GET | none | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | none |

```javascript
// tests/integration/chat.test.js:36-62
test('Chat Routes - Failure Path', async (t) => {
  await t.test('POST /chat/enhanced/process without message returns 400', async () => {
    const response = await postRequest('/chat/enhanced/process', {});

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('POST /chat/enhanced/process with empty message returns 400', async () => {
    const response = await postRequest('/chat/enhanced/process', { message: '' });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });
});
```

---

### Document Endpoint Tests

**File:** `tests/integration/document.test.js`

| Name | Description | Route | Method | Payload | Expected Response | Variables |
|------|-------------|-------|--------|---------|-------------------|-----------|
| List Documents | Get all documents | `/admin/docs/documents` | GET | none | `{ success: true, data: { documents: [], count, limit, offset } }` - 200/503 | `ADMIN_TOKEN`, `SUPABASE_URL` |
| List with Params | Get filtered documents | `/admin/docs/documents?limit=10&offset=0&status=completed` | GET | query params | `{ success: true, data: { documents: [] } }` - 200/503 | `ADMIN_TOKEN`, `SUPABASE_URL` |
| List Jobs | Get ingest jobs | `/admin/docs/jobs` | GET | none | `{ success: true, data: { jobs: [], count, limit, offset } }` - 200/503 | `ADMIN_TOKEN`, `SUPABASE_URL` |
| List Jobs with Params | Get filtered jobs | `/admin/docs/jobs?limit=5&status=pending` | GET | query params | `{ success: true, data: { jobs: [] } }` - 200/503 | `ADMIN_TOKEN`, `SUPABASE_URL` |
| Get Job by ID | Get specific job | `/admin/docs/jobs/:jobId` | GET | none | `{ success: true }` - 200/404/503 | `ADMIN_TOKEN`, `SUPABASE_URL` |
| Get Document by ID | Get specific document | `/admin/docs/documents/:docId` | GET | none | `{ success: true }` - 200/404/503 | `ADMIN_TOKEN`, `SUPABASE_URL` |
| Invalid Limit (docs) | Non-numeric limit | `/admin/docs/documents?limit=invalid` | GET | query: `limit=invalid` | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | `ADMIN_TOKEN` |
| Invalid Offset (docs) | Non-numeric offset | `/admin/docs/documents?offset=invalid` | GET | query: `offset=invalid` | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | `ADMIN_TOKEN` |
| Invalid Limit (jobs) | Non-numeric limit | `/admin/docs/jobs?limit=invalid` | GET | query: `limit=invalid` | `{ success: false, error: { code: 'BAD_REQUEST' } }` - 400 | `ADMIN_TOKEN` |
| Wrong Method (POST docs) | POST on GET-only route | `/admin/docs/documents` | POST | none | `{ success: false, error: { code: 'METHOD_NOT_ALLOWED' } }` - 405 | `ADMIN_TOKEN` |
| Wrong Method (PUT docs) | PUT on GET-only route | `/admin/docs/documents` | PUT | none | `{ success: false, error: { code: 'METHOD_NOT_ALLOWED' } }` - 405 | `ADMIN_TOKEN` |
| Wrong Method (DELETE docs) | DELETE on GET-only route | `/admin/docs/documents` | DELETE | none | `{ success: false, error: { code: 'METHOD_NOT_ALLOWED' } }` - 405 | `ADMIN_TOKEN` |
| Unauthorized (docs) | Access without token | `/admin/docs/documents` | GET | none | `{ success: false, error: { code: 'UNAUTHORIZED' } }` - 401 | none |
| Unauthorized (jobs) | Access without token | `/admin/docs/jobs` | GET | none | `{ success: false, error: { code: 'UNAUTHORIZED' } }` - 401 | none |

```javascript
// tests/integration/document.test.js:83-98
test('Document Routes - Failure Path', async (t) => {
  await t.test('GET /admin/docs/documents with invalid limit returns 400', async () => {
    const response = await adminRequest('get', '/admin/docs/documents?limit=invalid');

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });
});
```

---

### Service Guard Tests (Unit)

**File:** `tests/unit/middleware/serviceGuards.test.js`

| Name | Description | Middleware | Test Environment | Expected Behavior |
|------|-------------|------------|------------------|-------------------|
| Supabase Configured | Verify pass when configured | `requireSupabase()` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` set | `next()` called, no error |
| Supabase Not Configured | Verify fail when missing | `requireSupabase()` | No Supabase env vars | `next(error)` with `code: 'SUPABASE_DISABLED'` |
| OpenAI Configured | Verify pass when configured | `requireOpenAI()` | `OPENAI_API_KEY` set | `next()` called, no error |
| OpenAI Not Configured | Verify fail when missing | `requireOpenAI()` | No `OPENAI_API_KEY` | `next(error)` with `code: 'OPENAI_DISABLED'` |
| Pinecone Configured | Verify pass when configured | `requirePinecone()` | `PYTHON_SIDECAR_URL` set | `next()` called, no error |
| Pinecone Not Configured | Verify fail when missing | `requirePinecone()` | No `PYTHON_SIDECAR_URL` | `next(error)` with `code: 'PINECONE_DISABLED'` |
| Sidecar Configured | Verify pass when configured | `requireSidecar()` | `PYTHON_SIDECAR_URL` set | `next()` called, no error |
| Sidecar Not Configured | Verify fail when missing | `requireSidecar()` | No `PYTHON_SIDECAR_URL` | `next(error)` with `code: 'SIDECAR_DISABLED'` |
| All Services Configured | Verify pass when all set | `requireServices(['supabase', 'openai', 'sidecar'])` | All env vars set | `next()` called, no error |
| Some Services Missing | Verify fail listing missing | `requireServices(['supabase', 'openai', 'sidecar'])` | Only Supabase set | `next(error)` with `disabledServices: ['OPENAI_DISABLED', 'SIDECAR_DISABLED']` |

```javascript
// tests/unit/middleware/serviceGuards.test.js:44-70
await t.test('requireSupabase - calls next(error) when Supabase is not configured', () => {
  setTestEnv({
    SUPABASE_URL: undefined,
    SUPABASE_SERVICE_KEY: undefined
  });

  const req = {};
  const res = {};
  let nextError = null;

  const next = (error) => { nextError = error; };

  const middleware = requireSupabase();
  middleware(req, res, next);

  assert.strictEqual(nextError.code, 'SUPABASE_DISABLED');
  assert.strictEqual(nextError.message, 'Supabase not configured');
});
```

---

### Repository Guard Tests (Unit)

**File:** `tests/unit/repositories/guards.test.js`

| Name | Description | Repository | Test Environment | Expected Behavior |
|------|-------------|------------|------------------|-------------------|
| Document Repo Disabled | Throws when Supabase missing | `documentRepository.getDocument()` | No Supabase env vars | Throws `{ code: 'SUPABASE_DISABLED' }` |
| Chat Repo Disabled | Throws when Supabase missing | `chatRepository.getChatSession()` | No Supabase env vars | Throws `{ code: 'SUPABASE_DISABLED' }` |
| Systems Repo Disabled | Throws when Supabase missing | `systemsRepository.getSystemByAssetUid()` | No Supabase env vars | Throws `{ code: 'SUPABASE_DISABLED' }` |
| Document Repo Works | Succeeds when configured | `documentRepository.getDocument()` | Supabase configured | Does not throw `SUPABASE_DISABLED` |
| Chat Repo Works | Succeeds when configured | `chatRepository.getChatSession()` | Supabase configured | Does not throw `SUPABASE_DISABLED` |
| Systems Repo Works | Succeeds when configured | `systemsRepository.getSystemByAssetUid()` | Supabase configured | Does not throw `SUPABASE_DISABLED` |

```javascript
// tests/unit/repositories/guards.test.js:19-30
await t.test('Document Repository - throws SUPABASE_DISABLED when Supabase not configured', async () => {
  setTestEnv({}); // Empty env - no Supabase configured

  try {
    await documentRepository.getDocument('test-doc-id');
    assert.fail('Should have thrown an error');
  } catch (error) {
    assert.strictEqual(error.code, 'SUPABASE_DISABLED');
    assert.strictEqual(error.message, 'Supabase not configured');
  }
});
```

---

### Security Tests

**File:** `tests/integration/security.test.js`

| Name | Description | Route | Method | Expected Behavior |
|------|-------------|-------|--------|-------------------|
| CSP Header | Content-Security-Policy present | `/health` | GET | Header includes `default-src` |
| X-Frame-Options | Clickjacking protection | `/health` | GET | Header = `DENY` |
| X-Content-Type-Options | MIME sniffing protection | `/health` | GET | Header = `nosniff` |
| X-XSS-Protection | XSS protection header | `/health` | GET | Header present |
| Referrer-Policy | Referrer control | `/health` | GET | Header = `strict-origin-when-cross-origin` |
| Permissions-Policy | Feature permissions | `/health` | GET | Header present |
| X-Powered-By Removed | Server fingerprint hidden | `/health` | GET | Header undefined |
| CORS Localhost | Allow localhost:3000 | `/health` | GET | `access-control-allow-origin: http://localhost:3000` |
| CORS No Origin | Allow requests without origin | `/health` | GET | Returns 200 |
| Rate Limit Headers | Rate limiting active | `/health` | GET | `x-ratelimit-limit: 1000` |
| Large Payload Rejected | Reject >10MB payloads | `/chat/enhanced/process` | POST | 400 or 413 status |
| Normal Payload Accepted | Accept normal payloads | `/chat/enhanced/process` | POST | 200 status |

```javascript
// tests/integration/security.test.js:12-38
test('Security Headers - Verify essential security headers are present', async (t) => {
  const app = getAppSync();
  const response = await request(app)
    .get('/health')
    .expect(200);

  assert.ok(response.headers['content-security-policy'], 'CSP header should be present');
  assert.strictEqual(response.headers['x-frame-options'], 'DENY');
  assert.strictEqual(response.headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(response.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.strictEqual(response.headers['x-powered-by'], undefined);
});
```

---

### Monitoring Tests

**File:** `tests/integration/monitoring.test.js`

| Name | Description | Route | Method | Expected Response |
|------|-------------|-------|--------|-------------------|
| Get Monitoring Data | Retrieve monitoring status | `/health/monitoring` | GET | `{ success: true, data: { monitoring: { checks, criticalErrors, warnings, info }, summary, status } }` |
| All Checks Present | Verify check categories | `/health/monitoring` | GET | Includes: `doubleSendErrors`, `validationErrors`, `methodGuardViolations`, `adminAuthFailures`, `serviceDisabledErrors`, `errorRate` |
| Check Structure | Each check has required fields | `/health/monitoring` | GET | Each check has: `count`, `status`, `recent[]` |
| Status Reflects Issues | Status matches actual errors | `/health/monitoring` | GET | `critical` if criticalErrors > 0, `warning` if warnings > 0, else `healthy` |

```javascript
// tests/integration/monitoring.test.js:11-38
test('Runtime Monitoring Endpoint', async (t) => {
  await t.test('GET /health/monitoring returns monitoring data', async () => {
    const response = await get('/health/monitoring');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.ok(response.body.data.monitoring, 'Should have monitoring object');
    assert.ok(response.body.data.summary, 'Should have summary object');

    const monitoring = response.body.data.monitoring;
    assert.ok(monitoring.checks, 'Should have checks object');
    assert.ok(typeof monitoring.criticalErrors === 'number');
  });
});
```

---

## Environment Variables for Testing

| Variable | Required For | Default | Description |
|----------|--------------|---------|-------------|
| `ADMIN_TOKEN` | Admin tests | `test-admin-token` | Admin authentication token |
| `SUPABASE_URL` | DB tests | - | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | DB tests | - | Supabase service role key |
| `OPENAI_API_KEY` | Chat tests | - | OpenAI API key |
| `PYTHON_SIDECAR_URL` | Sidecar tests | `http://localhost:8000` | Python sidecar URL |
| `PINECONE_API_KEY` | Pinecone tests | - | Pinecone API key |

---

## Running Tests

### All Tests

```bash
npm test
```

### Specific Test File

```bash
node --test tests/integration/health.test.js
```

### With Coverage

```bash
npm run test:coverage
```

### CI Mode

```bash
npm run test:ci
```

---

## Available Testing UIs

| Page | URL | Purpose |
|------|-----|---------|
| DIP Testing | `/public/testing.html` | Test DIP extraction |
| Golden Tests | `/public/testing-golden-tests.html` | Run golden test suite |
| Intent Router | `/public/testing-intent-router.html` | Test query classification |
| Playbook Testing | `/public/testing-playbook.html` | Test playbook responses |
| Specifications | `/public/testing-specifications.html` | Test spec extraction |

---

## Golden Tests

### What Are Golden Tests?

Pre-defined question/answer pairs that validate AI responses:

```json
{
  "id": "oil-filter-change",
  "question": "How do I change the oil filter on the Yanmar?",
  "expected_keywords": ["oil filter", "250 hours", "drain"],
  "expected_equipment": "Yanmar 4JH57",
  "category": "maintenance"
}
```

### Running Golden Tests

1. Navigate to Golden Tests page
2. Select test category or run all
3. Click "Run Tests"
4. View results: pass/fail for each test

---

## Test Categories Summary

| Category | Test Count | File |
|----------|------------|------|
| Health | 5 | `health.test.js` |
| Systems | 8 | `systems.test.js` |
| Pinecone | 14 | `pinecone.test.js` |
| Admin | 8 | `admin.test.js` |
| Admin Auth | 6 | `admin-auth.test.js`, `admin.test.js` |
| Chat | 8 | `chat.test.js` |
| Documents | 14 | `document.test.js` |
| Service Guards | 10 | `serviceGuards.test.js` |
| Repository Guards | 6 | `guards.test.js` |
| Security | 12 | `security.test.js` |
| Monitoring | 4 | `monitoring.test.js` |
| **Total** | **~95** | |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Tests hit production" | **No.** Tests use test env or mocks |
| "Tests modify data" | **No.** Read-only or rollback after |
| "All tests need live services" | **No.** Many work with mocked services |
| "Skip tests if service down" | **Partial.** Uses `skipIfNoServices()` helper |

---

## Related Docs

- [CI Testing](../00-foundations/ci-testing.md) - CI/CD test configuration
- [Chat](../10-user-features/chat.md) - Chat system being tested
- [Documents](./documents.md) - Document pipeline testing
- [Pinecone](./pinecone.md) - Vector search testing

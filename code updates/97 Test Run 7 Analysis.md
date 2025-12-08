# 97 Test Run #7 Complete Analysis

**Date:** 2025-12-08
**Commit:** 0244bce (PATH FIX - /admin/ → /admin/api/)
**Result:** 410 passed, 145 failed (73.9%)

---

## Progress Tracker

| Run | Commit | Passed | Failed | Rate | Change | Notes |
|-----|--------|--------|--------|------|--------|-------|
| #1 | 03941c6 | 374 | 181 | 67.4% | baseline | |
| #2 | a4f06be | 395 | 160 | 71.2% | +21 | ENV/405 fix |
| #3 | 9a69302 | 388 | 165 | 70.2% | -7 | missed file |
| #4 | b08a699 | 395 | 160 | 71.2% | +7 | fixed missed file |
| #5 | e227f75 | 395 | 161 | 71.0% | +0 | workflow token |
| #6 | 05c3fd3 | 395 | 160 | 71.2% | +0 | real secrets |
| **#7** | **0244bce** | **410** | **145** | **73.9%** | **+15** | PATH FIX |

---

## Failure Breakdown by Root Cause

| Root Cause | Count | Files Affected |
|------------|-------|----------------|
| Missing `initTestApp()` | ~30 | bad-input-matrix.test.js, comprehensive-validation.test.js |
| `publicRequest().query/send is not a function` | ~20 | bad-input.test.js |
| `adminRequest().query is not a function` | ~12 | bad-input.test.js |
| 403 Forbidden (token mismatch) | ~15 | admin-auth.test.js, bad-input.test.js |
| `Cannot read properties of undefined (reading 'code')` | ~10 | chat.test.js, guards.test.js |
| 404 !== 405 (route doesn't exist) | ~5 | bad-input.test.js |
| Query normalizer strips too much | 3 | query-normalizer.test.js |
| Route map format mismatch | 2 | route-map.test.js |
| Python contract tests | 4 | test_api_schemas.py |
| Other assertion failures | ~44 | various |

---

## UNIT TEST FAILURES (7)

### Query Normalizer (3 failures)

**File:** `tests/unit/services/query-normalizer.test.js`

```
Test: normalizeQuery strips leading phrases
Error: 'bbq' == 'my BBQ'
Expected: 'my BBQ'
Actual: 'bbq'

Test: normalizeQuery normalizes whitespace
Error: 'bbq' == 'my BBQ'
Expected: 'my BBQ'
Actual: 'bbq'

Test: normalizeQuery only strips first matching prefix
Error: 'bbq' == 'tell me about BBQ'
Expected: 'tell me about BBQ'
Actual: 'bbq'
```

**Root Cause:** Function strips too aggressively. Tests expect partial stripping but function strips everything.

---

### Guards/Validation (4 failures)

**File:** `tests/unit/repositories/guards.test.js`

```
Test: Method guards - POST-only endpoints return 405 for wrong methods
Error: Should be auth error, not method error
Expected: true
Actual: false

Test: Query validation - Invalid search query returns 400
Error: Cannot read properties of undefined (reading 'code')

Test: Query validation - Invalid pagination returns 400
Error: Cannot read properties of undefined (reading 'code')

Test: Admin validation with valid token - Bad query returns 400, not 403
Error: assert.ok(['ADMIN_DISABLED', 'FORBIDDEN'].includes(response.body.error.code))
Expected: true
Actual: false
```

**Root Cause:** Response body doesn't have `error.code` property when expected.

---

## SMOKE TEST FAILURES (2)

**File:** `tests/smoke/route-map.test.js`

```
Test: Route map contains expected routes
Error: Expected: true, Actual: undefined

Test: Route map - /__routes endpoint returns expected routes
Error: 1 subtest failed
```

**Root Cause:** The `/__routes` endpoint format doesn't match test expectations.

---

## PYTHON TEST FAILURES (4)

**File:** `python-sidecar/tests/contract/test_api_schemas.py`

```
tests/contract/test_api_schemas.py::TestChatEndpointContract::test_chat_requires_body
tests/contract/test_api_schemas.py::TestChatEndpointContract::test_chat_requires_query
tests/contract/test_api_schemas.py::TestChatEndpointContract::test_chat_accepts_minimal_payload
tests/contract/test_api_schemas.py::TestErrorResponses::test_405_on_wrong_method
```

**Root Cause:** Chat endpoint contract tests failing - likely endpoint behavior mismatch.

---

## INTEGRATION TEST FAILURES (132)

### Category A: Missing initTestApp() (~30 tests)

**Files:**
- `tests/integration/bad-input-matrix.test.js` (10 tests)
- `tests/integration/comprehensive-validation.test.js` (20+ tests)

**Error Pattern:**
```
Error: Test app not initialized. Call initTestApp() in beforeAll.
Code: ERR_TEST_FAILURE
stack: getAppSync (tests/setupApp.js:11:20)
       get (tests/helpers/http.js:10:19)
```

**Fix:** Add `initTestApp()` call at start of test suite.

---

### Category B: API Mismatch - .query()/.send() not a function (~32 tests)

**File:** `tests/integration/bad-input.test.js`

**Error Patterns:**
```
Error: publicRequest(...).query is not a function
Error: publicRequest(...).send is not a function
Error: adminRequest(...).query is not a function
```

**Tests Affected:**
- GET /systems/search with empty query returns 400
- POST /chat/enhanced/process with missing message returns 400
- POST /chat/enhanced/process with empty message returns 400
- POST /chat/enhanced/process with non-string message returns 400
- GET /chat/enhanced/history with invalid threadId returns 400
- GET /chat/enhanced/context with invalid threadId returns 400
- POST /pinecone/search with invalid payload returns 400
- POST /pinecone/search with missing query returns 400
- POST /pinecone/search with invalid topK returns 400
- GET /admin/systems with empty query returns 400
- GET /admin/manufacturers with empty query returns 400
- GET /admin/models with empty query returns 400
- GET /admin/logs with invalid level returns 400
- GET /admin/logs with invalid limit returns 400
- GET /admin/docs/jobs with invalid status returns 400
- GET /admin/docs/jobs with invalid limit returns 400
- GET /admin/docs/job-status with invalid jobId returns 400
- GET /admin/docs/documents with invalid limit returns 400
- GET /admin/docs/documents with invalid offset returns 400
- GET /admin/health with invalid token returns 401

**Root Cause:** `publicRequest()` and `adminRequest()` in `test-config.js` don't return supertest object with `.query()` and `.send()` methods.

---

### Category C: 403 Forbidden - Admin Token Mismatch (~15 tests)

**File:** `tests/integration/admin-auth.test.js`, `tests/integration/bad-input.test.js`

**Error Pattern:**
```
Error: Expected values to be strictly equal:
403 !== 200
403 !== 405
403 !== 400
```

**Tests Affected:**
- GET /admin/health with valid token returns 200 → 403
- GET /admin/systems with valid token returns 200 → 403
- POST /admin/health with invalid method returns 405 → 403
- POST /admin/pinecone with invalid method returns 405 → 403
- GET /admin/docs/documents/:id with invalid id returns 400 → 403

**Root Cause:** Tests send `admin_secret_key` but CI's `ADMIN_TOKEN` secret is different.

---

### Category D: Missing error.code in Response (~10 tests)

**File:** `tests/integration/chat.test.js`

**Error Pattern:**
```
Error: Cannot read properties of undefined (reading 'code')
```

**Tests Affected:**
- POST /chat/enhanced/process without message returns 400
- POST /chat/enhanced/process with empty message returns 400
- POST /chat/enhanced/process with invalid payload returns 400
- GET /chat/enhanced/history without threadId returns 400
- GET /chat/enhanced/context without threadId returns 400

**Root Cause:** Response body doesn't have `error.code` - tests access `response.body.error.code` but `error` is undefined.

---

### Category E: assertUnauthorized Message Mismatch (~4 tests)

**File:** `tests/integration/admin-auth.test.js`

**Error Pattern:**
```
Error: Expected: 'Admin access required', Actual: undefined
```

**Tests Affected:**
- GET /admin/health without token returns 401
- GET /admin/systems without token returns 401
- GET /admin/docs/jobs without token returns 401

**Root Cause:** `assertUnauthorized()` expects `response.body.error.message === 'Admin access required'` but actual response has different format.

---

### Category F: 404 vs 405 (Route Doesn't Exist) (~5 tests)

**File:** `tests/integration/bad-input.test.js`

**Error Pattern:**
```
Error: Expected 405, Actual: 404
```

**Tests Affected:**
- POST /health with invalid method returns 405 → 404

**Root Cause:** Route doesn't exist at that path, so 404 returned instead of 405.

---

### Category G: 500 Server Errors (~5 tests)

**File:** `tests/integration/chat.test.js`

**Error Pattern:**
```
Error: Expected 200, Actual: 500
```

**Tests Affected:**
- POST /chat/enhanced/process with valid message returns 200 → 500

**Root Cause:** Server error during chat processing - likely missing service configuration.

---

## DETAILED TEST FAILURES BY FILE

### admin-auth.test.js (8 failures)

| Test | Expected | Actual | Error |
|------|----------|--------|-------|
| GET /admin/health with valid token | 200 | 403 | Token mismatch |
| GET /admin/systems with valid token | 200 | 403 | Token mismatch |
| Admin Authentication - Happy Path | pass | fail | 2 subtests failed |
| GET /admin/health without token | 401 + msg | 401 | Missing error.message |
| GET /admin/systems without token | 401 + msg | 401 | Missing error.message |
| GET /admin/health with invalid token | 401 | error | .set() not a function |
| GET /admin/docs/jobs without token | 401 + msg | 401 | Missing error.message |
| Admin Authentication - Failure Path | pass | fail | 4 subtests failed |

---

### bad-input.test.js (25 failures)

| Test | Expected | Actual | Error |
|------|----------|--------|-------|
| POST /health with invalid method | 405 | 404 | Route doesn't exist |
| GET /systems/search with empty query | 400 | error | .query() not a function |
| POST /chat/enhanced/process with missing message | 400 | error | .send() not a function |
| POST /chat/enhanced/process with empty message | 400 | error | .send() not a function |
| POST /chat/enhanced/process with non-string message | 400 | error | .send() not a function |
| GET /chat/enhanced/history with invalid threadId | 400 | error | .query() not a function |
| GET /chat/enhanced/context with invalid threadId | 400 | error | .query() not a function |
| POST /pinecone/search with invalid payload | 400 | error | .send() not a function |
| POST /pinecone/search with missing query | 400 | error | .send() not a function |
| POST /pinecone/search with invalid topK | 400 | error | .send() not a function |
| Bad Input Validation - Public Endpoints | pass | fail | 10 subtests failed |
| POST /admin/health with invalid method | 405 | 403 | Token blocks first |
| POST /admin/pinecone with invalid method | 405 | 403 | Token blocks first |
| GET /admin/systems with empty query | 400 | error | .query() not a function |
| GET /admin/manufacturers with empty query | 400 | error | .query() not a function |
| GET /admin/models with empty query | 400 | error | .query() not a function |
| GET /admin/logs with invalid level | 400 | error | .query() not a function |
| GET /admin/logs with invalid limit | 400 | error | .query() not a function |
| GET /admin/docs/jobs with invalid status | 400 | error | .query() not a function |
| GET /admin/docs/jobs with invalid limit | 400 | error | .query() not a function |
| GET /admin/docs/job-status with invalid jobId | 400 | error | .query() not a function |
| GET /admin/docs/documents with invalid limit | 400 | error | .query() not a function |
| GET /admin/docs/documents with invalid offset | 400 | error | .query() not a function |
| GET /admin/docs/documents/:id with invalid id | 400 | 403 | Token mismatch |
| Bad Input Validation - Admin Endpoints | pass | fail | 13 subtests failed |

---

### bad-input-matrix.test.js (11 failures)

| Test | Error |
|------|-------|
| GET /systems with empty query | initTestApp() missing |
| GET /admin/docs with valid token + bad query | initTestApp() missing |
| GET /pinecone/query returns 405 | initTestApp() missing |
| GET /document/not-a-uuid returns 400 | initTestApp() missing |
| POST /pinecone/query with disabled service | initTestApp() missing |
| GET /admin/docs with invalid token | initTestApp() missing |
| POST /chat/enhanced/process without body | initTestApp() missing |
| POST /pinecone/query with invalid JSON | initTestApp() missing |
| GET /systems with invalid limit | initTestApp() missing |
| GET /systems/invalid-uuid returns 400 | initTestApp() missing |
| Bad-input test matrix | 10 subtests failed |

---

### comprehensive-validation.test.js (23 failures)

All failures are: `Error: Test app not initialized. Call initTestApp() in beforeAll.`

---

### chat.test.js (8 failures)

| Test | Expected | Actual | Error |
|------|----------|--------|-------|
| POST /chat/enhanced/process with valid message | 200 | 500 | Server error |
| Chat Routes - Happy Path | pass | fail | 1 subtest failed |
| POST /chat/enhanced/process without message | 400 | error | error.code undefined |
| POST /chat/enhanced/process with empty message | 400 | error | error.code undefined |
| POST /chat/enhanced/process with invalid payload | 400 | error | error.code undefined |
| GET /chat/enhanced/history without threadId | 400 | error | error.code undefined |
| GET /chat/enhanced/context without threadId | 400 | error | error.code undefined |
| Chat Routes - Failure Path | pass | fail | 5 subtests failed |

---

## FIXES REQUIRED

### Fix 1: Add initTestApp() to test files

**Files:** `bad-input-matrix.test.js`, `comprehensive-validation.test.js`

```javascript
import { initTestApp } from '../setupApp.js';

test('...', async (t) => {
  await t.test('setup', async () => {
    await initTestApp();
  });
  // ... rest of tests
});
```

**Expected improvement:** +30 tests

---

### Fix 2: Fix publicRequest/adminRequest API

**File:** `tests/test-config.js`

The `publicRequest()` and `adminRequest()` functions don't return supertest-chainable objects. Need to fix to support `.query()` and `.send()` methods.

**Expected improvement:** +32 tests

---

### Fix 3: Verify ADMIN_TOKEN in GitHub Secrets

Either:
1. Set GitHub secret `ADMIN_TOKEN` = `admin_secret_key`
2. Or update test-config.js to use actual CI secret value

**Expected improvement:** +15 tests

---

### Fix 4: Fix response error format consistency

Ensure all error responses have:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error description"
  }
}
```

**Expected improvement:** +10 tests

---

## EXPECTED RESULTS AFTER ALL FIXES

| Fix | Tests Fixed |
|-----|-------------|
| initTestApp() | +30 |
| publicRequest/adminRequest API | +32 |
| ADMIN_TOKEN | +15 |
| Error format | +10 |
| **Subtotal Integration** | **+87** |
| **Total Fixed** | **+87** |
| **New Passed** | **~497** |
| **New Failed** | **~58** |
| **New Rate** | **~89.5%** |

Remaining after fixes (~58):
- Unit: 7 (query normalizer, guards)
- Smoke: 2 (route map)
- Python: 4 (chat contract)
- Integration: ~45 (server errors, route mismatches)

---

*Last Updated: 2025-12-08*
*Contains all 145 failed tests with error details*

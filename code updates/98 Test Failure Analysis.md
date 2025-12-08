# 98 Test Failure Analysis

**Date:** 2025-12-08
**Run:** #25 (Full Test Suite)
**Total:** 555 tests | 374 passed (67%) | 181 failed | 90 skipped

---

## Executive Summary

The full test suite is now running in CI. This document catalogs all failures with root causes and recommended fixes, organized by priority.

---

## Failure Summary by Category

| Category | Passed | Failed | Skipped | Priority |
|----------|--------|--------|---------|----------|
| Unit Tests | 52 | 19 | 7 | HIGH |
| Python Tests | 64 | 4 | 0 | MEDIUM |
| Smoke Tests | 7 | 2 | 0 | LOW |
| Integration Tests | varies | many | 0 | HIGH |
| Playwright (Nightly) | ~200 | ~150 | 83 | MEDIUM |

---

## UNIT TEST FAILURES (19 failures)

### Category 1: ENV Caching Issues (10 failures)

**Root Cause:** Repositories and services import `ENV` constant at module load time. When tests call `setTestEnv()`, it doesn't affect these cached values.

**Affected Tests:**
```
repositories/guards.test.js:
- Document Repository - throws SUPABASE_DISABLED when Supabase not configured
- Chat Repository - throws SUPABASE_DISABLED when Supabase not configured
- Systems Repository - throws SUPABASE_DISABLED when Supabase not configured

services/service-guards.test.js:
- Document Service - throws SUPABASE_DISABLED when Supabase not configured
- Document Service - throws SIDECAR_DISABLED when sidecar not configured
- Enhanced Chat Service - throws service errors when services not configured
- Enhanced Chat Service - throws SUPABASE_DISABLED for individual functions
- Systems Service - throws SUPABASE_DISABLED when Supabase not configured
- Document Service - guards work correctly
- Enhanced Chat Service - guards work correctly
```

**Recommended Fix:**
Refactor repositories and services to use `getEnv()` instead of `ENV`:

```javascript
// BEFORE (broken for tests)
import { ENV } from '../config/env.js';
const url = ENV.SUPABASE_URL;

// AFTER (testable)
import { getEnv } from '../config/env.js';
const env = getEnv();
const url = env.SUPABASE_URL;
```

**Files to modify:**
- `src/repositories/document.repository.js`
- `src/repositories/chat.repository.js`
- `src/repositories/systems.repository.js`
- `src/services/document.service.js`
- `src/services/enhanced-chat.service.js`
- `src/services/systems.service.js`

**Effort:** MEDIUM (2-3 hours)

---

### Category 2: Query Normalizer Issues (3 failures)

**Root Cause:** The `normalizeQuery` function strips too aggressively, converting "tell me about my BBQ" to just "bbq" instead of "my BBQ".

**Affected Tests:**
```
services/query-normalizer.test.js:
- normalizeQuery strips leading phrases (expected "my BBQ", got "bbq")
- normalizeQuery normalizes whitespace (expected "my BBQ", got "bbq")
- normalizeQuery only strips first matching prefix (expected "tell me about BBQ", got "bbq")
```

**Analysis Options:**
1. **Test expectations are wrong** - The normalizer is working as designed
2. **Normalizer is too aggressive** - Should preserve more of the query

**Recommended Fix:**
Review `src/services/query-normalizer.service.js` to understand intended behavior. Either:
- Fix the normalizer to be less aggressive
- Update test expectations to match actual behavior

**Effort:** LOW (1 hour investigation)

---

### Category 3: Method Guard Issues (4 failures)

**Root Cause:** Tests expect specific HTTP status codes (405 Method Not Allowed) but routes return 200 or different error formats.

**Affected Tests:**
```
validation/method-guards.test.js:
- Method guards - POST-only endpoints return 405 for wrong methods (got 200)
- Query validation - Invalid search query returns 400
- Query validation - Invalid pagination returns 400
- Admin validation with valid token - Bad query returns 400, not 403
```

**Analysis:**
- `/pinecone/search` GET returns 200 instead of 405 - route may accept GET
- Error response format may not include `.error.code` field

**Recommended Fix:**
1. Verify route definitions - do they have proper method restrictions?
2. Update tests to match actual route behavior
3. Or add method restrictions to routes

**Effort:** MEDIUM (2 hours)

---

### Category 4: Skipped Tests (7 skipped)

**Root Cause:** Tests marked with `test.skip()` - placeholders awaiting DI refactoring.

**Affected Tests:**
```
services/chat-proxy.service.test.js:
- calls Python sidecar with correct parameters
- falls back to existing equipment context when search returns empty
- deduplicates equipment from keyword and LLM sources
- returns clarification response when equipment extracted but not found
- updates equipment context blob after successful processing
- throws error with context when Python sidecar fails
- logs error with full context on failure
```

**Recommended Fix:**
No immediate action - these are planned tests awaiting service refactoring for dependency injection.

**Effort:** NONE (intentional skips)

---

## PYTHON TEST FAILURES (4 failures)

**Root Cause:** Tests expect `/v1/chat/process` endpoint but it returns 404.

**Affected Tests:**
```
tests/contract/test_api_schemas.py:
- TestChatEndpointContract::test_chat_requires_body
- TestChatEndpointContract::test_chat_requires_query
- TestChatEndpointContract::test_chat_accepts_minimal_payload
- TestErrorResponses::test_405_on_wrong_method
```

**Analysis:**
The Python sidecar tests expect a `/v1/chat/process` route. Either:
- Route path is different in the actual app
- Route is not mounted in the test app fixture

**Recommended Fix:**
1. Check actual route path: `grep -r "chat/process" python-sidecar/`
2. Update test to use correct path, or
3. Fix test fixture to mount chat routes

**Effort:** LOW (1 hour)

---

## SMOKE TEST FAILURES (2 failures)

**Root Cause:** Route map endpoint behavior differs from test expectations.

**Affected Tests:**
```
smoke/route-map.test.js:
- Route map contains expected routes
- Route map - /__routes endpoint returns expected routes
```

**Analysis:**
Tests may expect a `/__routes` debug endpoint that doesn't exist or returns different format.

**Recommended Fix:**
1. Check if `/__routes` endpoint exists
2. Update tests to match actual endpoint behavior
3. Or remove these tests if endpoint was removed

**Effort:** LOW (30 minutes)

---

## INTEGRATION TEST FAILURES (Many failures)

**Root Cause Categories:**

### A. Admin Token Mismatch
Tests use hardcoded `ADMIN_TOKEN: 'admin-secret-key'` in `test-config.js`, but CI uses different token from secrets.

**Affected:** All admin route tests

**Fix:** Update `test-config.js` to use `process.env.ADMIN_TOKEN` or match CI secret.

### B. Route Expectations
Tests expect specific response formats/status codes that don't match actual implementation.

**Affected:** Many validation tests

**Fix:** Audit each test against actual route behavior.

### C. Service Initialization
App imports initialize services (Pinecone, Supabase) at module load time, causing errors even for unrelated tests.

**Affected:** All integration tests that import the app

**Fix:** Already partially addressed by adding env vars. May need lazy initialization.

**Effort:** HIGH (4-8 hours to audit and fix all)

---

## PLAYWRIGHT SKIPPED (83 skipped)

**Root Cause:** Maintenance agent pages skipped because service not deployed in CI.

**Affected Tests:**
All tests in `tests/nightly/ui-all.spec.js` for maintenance agent URLs (20 pages x ~4 tests each).

**Recommended Fix:**
1. Deploy maintenance agent to Render
2. Add `MAINTENANCE_URL` to workflow env vars
3. Or mark these as intentionally skipped for CI

**Effort:** MEDIUM (depends on deployment decision)

---

## PLAYWRIGHT FAILURES (~150 failures)

**Root Cause Categories:**

### A. Timeout/Network Issues
Pages may load slowly causing timeouts.

### B. Element Selectors
Page structure may have changed, selectors no longer match.

### C. API Dependencies
Some pages depend on API calls that fail or timeout.

**Recommended Fix:**
Review Playwright test artifacts (screenshots, traces) to identify specific failures.

**Effort:** HIGH (requires individual investigation)

---

## Priority Fix Order

### Phase 1: Quick Wins (1-2 hours)
1. Python test route path fix (4 tests)
2. Smoke test route map fix (2 tests)
3. Query normalizer investigation (3 tests)

### Phase 2: ENV Caching (2-3 hours)
1. Refactor repositories to use `getEnv()`
2. Refactor services to use `getEnv()`
3. Re-run unit tests (10 tests)

### Phase 3: Integration Tests (4-8 hours)
1. Fix admin token in test-config.js
2. Audit route expectations
3. Add proper mocking

### Phase 4: Playwright (ongoing)
1. Review failure artifacts
2. Fix selectors and timeouts
3. Decision on maintenance agent deployment

---

## Test Results Location

Results are stored in Supabase `test_results` table with:
- `run_id`: Unique run identifier
- `passed`, `failed`, `skipped`: Counts
- `results`: JSON object with per-category breakdown
- `failures`: Detailed failure information
- `git_commit`: Associated commit hash

Query example:
```javascript
const { data } = await supabase
  .from('test_results')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(1);
```

---

## Appendix: All Failing Test Names

### Unit Tests (19)
1. Document Repository - throws SUPABASE_DISABLED when Supabase not configured
2. Chat Repository - throws SUPABASE_DISABLED when Supabase not configured
3. Systems Repository - throws SUPABASE_DISABLED when Supabase not configured
4. Repository Guards (parent)
5. normalizeQuery strips leading phrases
6. normalizeQuery normalizes whitespace
7. normalizeQuery only strips first matching prefix
8. Document Service - throws SUPABASE_DISABLED when Supabase not configured
9. Document Service - throws SIDECAR_DISABLED when sidecar not configured
10. Enhanced Chat Service - throws service errors when services not configured
11. Enhanced Chat Service - throws SUPABASE_DISABLED for individual functions
12. Systems Service - throws SUPABASE_DISABLED when Supabase not configured
13. Document Service - guards work correctly
14. Enhanced Chat Service - guards work correctly
15. Service Guards (parent)
16. Method guards - POST-only endpoints return 405 for wrong methods
17. Query validation - Invalid search query returns 400
18. Query validation - Invalid pagination returns 400
19. Admin validation with valid token - Bad query returns 400, not 403

### Python Tests (4)
1. test_chat_requires_body
2. test_chat_requires_query
3. test_chat_accepts_minimal_payload
4. test_405_on_wrong_method

### Smoke Tests (2)
1. Route map contains expected routes
2. Route map - /__routes endpoint returns expected routes

---

*Generated: 2025-12-08*
*Next Review: After Phase 1 fixes*

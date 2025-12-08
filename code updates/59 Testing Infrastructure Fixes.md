# 59 Testing Infrastructure Fixes

**Date:** 2025-12-08
**Status:** In Progress - Run #18 pending (25 unit tests + Python)
**Goal:** Fix nightly sweep workflow to properly run and capture all tests

---

## Quick Recovery After Compact

**To continue after `/compact`, say:**
> "Continue fixing the testing infrastructure. Read `code updates/59 Testing Infrastructure Fixes.md` for context. We're on Run #18 with 25 unit tests + 68 Python tests."

---

## Current State (as of Run #18)

### What's Working
- Nightly sweep workflow runs without hanging
- Python tests: 68 tests (64 pass, 4 fail)
- Unit tests: 25 tests (25 pass) - serviceGuards (12) + guards (13)
- TAP parser fixed to correctly count nested subtests
- Guards use `getEnv()` for testable env control

### Test Counts Expected

| Test Type | Tests | Status |
|-----------|-------|--------|
| Python | 68 | 64 pass, 4 fail |
| Unit (serviceGuards) | 12 | 12 pass |
| Unit (guards) | 13 | 13 pass |
| **Total** | **93** | 89 pass, 4 fail |

### Key Fix: ENV Caching Problem

**Problem:** Tests couldn't control env vars because guards used cached `ENV` constant.

**Solution:**
1. Guards now use `getEnv()` (dynamic) instead of `ENV` (cached at import)
2. Tests use `resetEnvMemo()` + `setTestEnv()` to control env state
3. Works in CI even with real env vars set

**Files changed:**
- `src/services/guards/*.js` - Use `getEnv()` instead of `ENV`
- `src/config/env.js` - Already had `resetEnvMemo()` and `setTestEnv()`
- `tests/unit/*/guards*.test.js` - Use env helpers instead of `process.env`

---

## Unit Tests Status

| File | Tests | Status | Notes |
|------|-------|--------|-------|
| `middleware/serviceGuards.test.js` | 12 | ✅ In CI | Uses setTestEnv |
| `services/guards.test.js` | 13 | ✅ In CI | Uses setTestEnv |
| `services/service-guards.test.js` | 10 | ❌ Needs refactor | Services use cached ENV |
| `services/chat-proxy.service.test.js` | 9 | Pending | |
| `repositories/guards.test.js` | 8 | Pending | |
| `validation/method-guards.test.js` | 5 | Pending | |
| `services/query-normalizer.test.js` | 5 | Pending | |
| `middleware/admin.test.js` | 4 | Pending | |
| `fixture-validation.test.js` | 3 | Pending | |
| `config/env.test.js` | 1 | Pending | |
| `validation/debug.test.js` | 1 | Pending | |

### service-guards.test.js Blocker

This test file tests actual services (documentService, enhancedChatService, systemsService).
These services import `ENV` at module load time, so `setTestEnv()` doesn't affect them.

**To fix:** Refactor those services to use `getEnv()` instead of `ENV`.

---

## Python Test Failures (4 tests)

All failures are related to `/v1/chat/process` returning 404:

```
tests/contract/test_api_schemas.py::TestChatEndpointContract::test_chat_requires_body
tests/contract/test_api_schemas.py::TestChatEndpointContract::test_chat_requires_query
tests/contract/test_api_schemas.py::TestChatEndpointContract::test_chat_accepts_minimal_payload
tests/contract/test_api_schemas.py::TestErrorResponses::test_405_on_wrong_method
```

**Cause:** Tests expect `/v1/chat/process` route but it returns 404. Either:
- Route is at different path
- Chat routes not mounted in test app fixture

---

## Run History

| Run | Changes | Result |
|-----|---------|--------|
| #14 | All test steps removed | Success - workflow works |
| #15 | Python tests with env vars | 68 tests: 64 pass, 4 fail |
| #16 | + serviceGuards.test.js | 6/12 fail (ENV caching issue) |
| #17 | Fix guards to use getEnv() | 12/12 pass, TAP parser fix |
| #18 | + guards.test.js | Expected: 25 pass unit + 64 pass Python |

---

## Files Modified This Session

```
src/services/guards/index.js         # Use getEnv() instead of ENV
src/services/guards/supabase.guard.js
src/services/guards/openai.guard.js
src/services/guards/pinecone.guard.js
src/services/guards/sidecar.guard.js
tests/unit/middleware/serviceGuards.test.js  # Use setTestEnv()
tests/unit/services/guards.test.js           # Use setTestEnv()
scripts/upload-test-results.js               # Fix TAP parser for nested subtests
.github/workflows/nightly-sweep.yml          # Add guards.test.js
```

---

## Next Steps

1. **Verify Run #18** - Should show 25 unit + 68 Python tests
2. **Fix Python 404 failures** - Check chat route path in test fixture
3. **Refactor services to use getEnv()** - Unblock service-guards.test.js
4. **Add more unit test files** - One at a time
5. **Add integration tests back**
6. **Add Playwright tests back**

---

## Commands Reference

```bash
# Run both guard test files locally
node --test --test-force-exit \
  tests/unit/middleware/serviceGuards.test.js \
  tests/unit/services/guards.test.js

# Check which unit test files exist
find tests/unit -name "*.test.js"

# Query Supabase for test results
# (use the check-skipped.mjs pattern from session)

# Trigger nightly sweep manually
# GitHub Actions UI → nightly-sweep.yml → Run workflow
```

---

## Lessons Learned (Updated)

1. **ENV caching breaks tests** - Use `getEnv()` for code that needs test control
2. **setTestEnv() only works for dynamic getEnv()** - Static imports cache at load time
3. **TAP parser must handle nested subtests** - Node test runner indents subtests
4. **Summary lines are authoritative** - Parse `# pass N` instead of counting `ok` lines
5. **Add tests incrementally** - Easier to debug failures
6. **Services need refactoring** - Can't test "not configured" if service imports cached ENV

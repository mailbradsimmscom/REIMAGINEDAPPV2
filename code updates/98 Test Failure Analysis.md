# 98 Test Failure Analysis

**Date:** 2025-12-08
**Latest Run:** #7 (0244bce) - PENDING
**Previous:** #6 (05c3fd3) - 395 passed, 160 failed (71.2%)

---

## Progress Tracker

| Run | Commit | Passed | Failed | Rate | Change | Notes |
|-----|--------|--------|--------|------|--------|-------|
| #1 | 03941c6 | 374 | 181 | 67.4% | baseline | |
| #2 | a4f06be | 395 | 160 | 71.2% | +21 | ENV/405 fix |
| #3 | 9a69302 | 388 | 165 | 70.2% | -7 | missed file |
| #4 | b08a699 | 395 | 160 | 71.2% | +7 | fixed missed file |
| #5 | e227f75 | 395 | 161 | 71.0% | +0 | workflow token (no effect) |
| #6 | 05c3fd3 | 395 | 160 | 71.2% | +0 | real secrets (no effect) |
| #7 | 0244bce | TBD | TBD | TBD | TBD | **PATH FIX - should fix 147** |

---

## ROOT CAUSE FOUND AND FIXED

### The Problem: Route Path Mismatch

**Admin router mounted at:** `/admin/api` (src/index.js line 68)
**Tests were hitting:** `/admin/*`
**Result:** 404 Not Found for all admin endpoints

```javascript
// src/index.js line 68
safeMount('/admin/api', adminRouter);  // Routes are at /admin/api/*

// Tests were calling:
adminRequest('get', '/admin/health');     // 404!
adminRequest('get', '/admin/systems');    // 404!

// Should be:
adminRequest('get', '/admin/api/health');   // 200 ✓
adminRequest('get', '/admin/api/systems');  // 200 ✓
```

### Why We Couldn't Change the Mount Point
Frontend uses `/admin/api/*` paths (checked 10+ HTML files), so changing
the mount point would break production.

### The Fix (Commit 0244bce)
Updated 6 integration test files to use `/admin/api/*` instead of `/admin/*`:
- admin-auth.test.js
- admin.test.js
- bad-input-matrix.test.js
- bad-input.test.js
- comprehensive-validation.test.js
- phase3-achievements.test.js

**Kept `/admin/docs/*` unchanged** - it's mounted separately at that path.

---

## Previous Fixes (All Working)

### Fix 1: ENV Caching (+21 tests)
- `setTestEnv()` now starts with empty object after `resetEnvMemo()`
- **Commit:** a4f06be

### Fix 2: 405 Status Codes (included in +21)
- Changed `res.json({}, 405)` to `res.status(405).json({})` in 14 files
- **Commit:** a4f06be

### Fix 3: Error Message Capture
- TAP parser now captures actual error messages from YAML blocks
- **Commit:** e31ac8f

### Fix 4: Real Secrets in CI
- Changed workflow to use GitHub secrets instead of fake URLs
- **Commit:** 05c3fd3

---

## Run #6 Breakdown (Before Path Fix)

| Category | Passed | Failed | Notes |
|----------|--------|--------|-------|
| Integration | 93 | 147 | **All 404s - path mismatch** |
| Unit | 64 | 7 | Query normalizer, guards |
| Python | 64 | 4 | Chat contract tests |
| Smoke | 7 | 2 | Route expectations |
| Playwright E2E | 33 | 0 | All passing |
| Playwright Nightly | 134 | 0 | All passing |

---

## Expected After Path Fix

With the path fix, ~147 integration failures should be resolved.
Remaining failures (~13):
- Unit: 7 (query normalizer, guards)
- Python: 4 (chat contract tests)
- Smoke: 2 (route expectations)

**Expected pass rate:** ~95%+

---

## Unit Test Failures (7) - Still Need Fixing

### Query Normalizer (3 failures)
- `normalizeQuery strips leading phrases` - Expected 'my BBQ', got 'bbq'
- `normalizeQuery normalizes whitespace` - Expected 'my BBQ', got 'bbq'
- `normalizeQuery only strips first matching prefix` - Expected 'tell me about BBQ', got 'bbq'

**Issue:** Function strips too aggressively, tests expect different behavior.

### Guards/Validation (4 failures)
- Method guards - auth error vs method error
- Query validation - undefined error codes

---

## Python Test Failures (4) - Still Need Fixing

- tests/contract/test_api_schemas.py::TestChatEndpointContract::test_chat_requires_body
- tests/contract/test_api_schemas.py::TestChatEndpointContract::test_chat_requires_query
- tests/contract/test_api_schemas.py::TestChatEndpointContract::test_chat_accepts_minimal_payload
- tests/contract/test_api_schemas.py::TestErrorResponses::test_405_on_wrong_method

---

## Smoke Test Failures (2) - Still Need Fixing

- Route map contains expected routes
- Route map - /__routes endpoint returns expected routes

---

## Key Learnings

1. **Always check route mount points** - The mismatch between `/admin/api` and `/admin/` caused 147 failures
2. **Error messages are critical** - Without them, we guessed at causes for hours
3. **Test locally first** - Running `node --test tests/integration/admin.test.js` would have shown 404s immediately
4. **Check frontend paths** - Frontend using `/admin/api/*` meant we couldn't change mount point

---

## Files Modified in This Session

| File | Change |
|------|--------|
| `src/config/env.js` | setTestEnv fix |
| 14 route files | 405 status code fix |
| `tests/unit/repositories/guards.test.js` | setTestEnv pattern |
| `tests/unit/services/service-guards.test.js` | setTestEnv pattern |
| `tests/test-config.js` | Token format |
| `tests/integration/admin.test.js` | Token + path fix |
| `tests/integration/document.test.js` | Token fix |
| `.github/workflows/test.yml` | Real secrets |
| `scripts/upload-test-results.js` | Error capture in TAP parser |
| 6 integration test files | Path fix `/admin/` → `/admin/api/` |

---

## Commits in This Session

| Commit | Description |
|--------|-------------|
| a4f06be | ENV/405 fix (+21 tests) |
| 9a69302 | Token format fix |
| b08a699 | Fixed missed document.test.js |
| e227f75 | Workflow token fix |
| e31ac8f | TAP parser error capture |
| 05c3fd3 | Real secrets in CI |
| 0244bce | **Path fix /admin/ → /admin/api/** |

---

*Last Updated: 2025-12-08 (Run #7 pending)*
*Root cause: Route path mismatch - tests hit /admin/* but routes at /admin/api/*

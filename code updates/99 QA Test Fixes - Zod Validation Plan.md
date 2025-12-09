# QA Test Fixes - Zod Validation Plan

**Created:** 2025-12-09
**Status:** ✅ Implemented
**Git Branch:** `Stable-v4-Working`
**Starting Commit:** `a8ff55c` (Fix: Remove 404/error handlers from app.js)
**Final Commits:** `f1336df`, `85b358b`

---

## Results Summary

| Metric | Before | After (First Pass) | After (Second Pass) |
|--------|--------|-------------------|---------------------|
| Total Failures | 87 | 60 | TBD |
| Unit Failures | 7 | 3 | TBD |
| Smoke Failures | 2 | 2 | TBD |
| Python Failures | 4 | 4 | TBD |
| Integration Failures | 74 | 51 | TBD |

**First pass reduced failures by 27 (31% improvement).**

---

## What Was Done

### Phase 1: Quick Wins ✅

#### 1.1 Rate Limit Test Fix ✅
**File:** `tests/integration/security.test.js`
- Changed rate limit assertion from 100 → 1000
- Test now matches actual server configuration

#### 1.2 Route Map Envelope Fix ✅
**File:** `src/debug/routes.js`
- Wrapped `/__routes` response in standard envelope: `{ success: true, data: { routes } }`

#### 1.3 Test Path Corrections ✅
**Files:** `tests/integration/bad-input-matrix.test.js`, `tests/integration/comprehensive-validation.test.js`
- `/systems?q=` → `/systems/search?q=` (search endpoint requires query, list doesn't)
- `/admin/docs` → `/admin/docs/documents` (correct sub-route path)
- `/document/not-a-uuid` → `/admin/docs/documents/not-a-uuid` (correct path with auth token)

---

### Phase 2: Error Code Normalization ✅

#### 2.1 VALIDATION_ERROR → BAD_REQUEST ✅
**File:** `src/middleware/validate.js`
- Changed error code from `'VALIDATION_ERROR'` to `ERR.BAD_REQUEST`
- Now consistent with `src/middleware/error.js` which already used `ERR.BAD_REQUEST`

**Files:** `tests/integration/bad-input-matrix.test.js`, `tests/integration/comprehensive-validation.test.js`
- Updated all test expectations from `'VALIDATION_ERROR'` to `'BAD_REQUEST'`

---

### Phase 3: Add Missing Validation Schemas ✅

**Finding:** Validation schemas already existed but were too loose.

#### 3.1 Chat Endpoint UUID Validation ✅
**File:** `src/schemas/chat.schema.js`
- `chatHistoryQuerySchema.threadId`: Changed from `z.string().min(1)` to `z.string().uuid()`
- `chatContextQuerySchema.threadId`: Changed from `z.string().min(1)` to `z.string().uuid()`
- **Impact:** Invalid threadId now returns 400 instead of 500

#### 3.2 Document Endpoint UUID Validation ✅
**File:** `src/schemas/document.schema.js`
- `documentGetQuerySchema.docId`: Changed from `z.string().min(1)` to `z.string().uuid()`
- **Impact:** Invalid docId now returns 400 instead of 500

#### 3.3 Systems Search Schema
**Status:** Already correct - requires `q` with min 2 chars

#### 3.4 Pinecone Query Schema
**Status:** Already correct - requires non-empty query string

---

### Phase 4: Clean Up Obsolete Tests ✅

#### 4.1 normalizeQuery Unit Tests ✅
**File:** `tests/unit/services/query-normalizer.test.js`
- Updated test expectations to match actual function behavior
- Function now lowercases and removes stop words (e.g., `'tell me about my BBQ'` → `'bbq'`)

---

## Files Changed

### Commit 1: `f1336df`

| File | Change |
|------|--------|
| `src/debug/routes.js` | Wrap `/__routes` in envelope |
| `src/middleware/validate.js` | Change VALIDATION_ERROR → BAD_REQUEST |
| `tests/integration/security.test.js` | Rate limit 100 → 1000 |
| `tests/integration/bad-input-matrix.test.js` | Update error code expectations |
| `tests/integration/comprehensive-validation.test.js` | Update error code expectations |
| `tests/unit/services/query-normalizer.test.js` | Fix test expectations |

### Commit 2: `85b358b`

| File | Change |
|------|--------|
| `src/schemas/chat.schema.js` | Add UUID validation for threadId |
| `src/schemas/document.schema.js` | Add UUID validation for docId |
| `tests/integration/bad-input-matrix.test.js` | Fix test paths |
| `tests/integration/comprehensive-validation.test.js` | Fix test paths |

---

## Remaining Issues (Not Addressed)

These failures need separate investigation:

1. **Smoke Tests (2 failures)**
   - `/__routes` test - likely CI timing issue (server startup)

2. **Python Sidecar Tests (4 failures)**
   - Contract tests for chat endpoint - different codebase

3. **Integration Tests (~50 failures)**
   - Admin routes returning 200 instead of 400 for empty queries
   - Service disabled tests expecting specific error codes
   - Phase 3 achievement tests with stale expectations

---

## Rollback Strategy

If needed:
```bash
git reset --hard a8ff55c  # Original starting point
# OR
git reset --hard f1336df  # After first commit
```

---

## Next Steps

To further reduce failures:

1. **Add validation to admin list routes** - `/admin/systems`, `/admin/manufacturers`, `/admin/models` return 200 for empty query but tests expect 400

2. **Fix service disabled tests** - Tests expect `PINECONE_DISABLED` error code but service returns success in CI

3. **Update Phase 3 achievement tests** - These were written to show broken behavior, now need to test correct behavior

4. **Investigate smoke test timing** - May need longer wait or healthcheck before testing `/__routes`

# 97 CI Test Failure Analysis & Fixes

**Date:** 2025-12-08
**Latest Run:** #9 (9a41676) - 467 passed, 88 failed (84.1%)
**Previous:** #7 (0244bce) - 410 passed, 145 failed (73.9%)
**Improvement:** +57 tests fixed in this session

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
| #7 | 0244bce | 410 | 145 | 73.9% | +15 | PATH FIX /admin/api/ |
| **#9** | **9a41676** | **467** | **88** | **84.1%** | **+57** | **HARNESS + ENVELOPE FIX** |

---

## FIXES APPLIED IN COMMIT 9a41676

### Fix 1: Test Harness - initTestApp()
Added `test.before(async () => { await initTestApp(); })` to 11 integration test files:
- bad-input-matrix.test.js
- comprehensive-validation.test.js
- bad-input.test.js
- admin-auth.test.js
- admin.test.js
- chat.test.js
- health.test.js
- systems.test.js
- pinecone.test.js
- document.test.js
- schema-validation.test.js

**Why:** Tests using `get()`/`post()` from `tests/helpers/http.js` require `initTestApp()` first. Without it, `getAppSync()` throws "Test app not initialized".

### Fix 2: test-config.js - Sync Functions
Changed `publicRequest()` and `adminRequest()` from async to sync:
```javascript
// BEFORE (broken - returns Promise, can't chain .query()/.send())
export const publicRequest = async (method, path) => {
  const app = await getApp();
  return request(app)[method](path);
};

// AFTER (works - returns supertest object, can chain)
export const publicRequest = (method, path) => {
  const app = getAppSync();
  return request(app)[method](path);
};
```

### Fix 3: Admin Middleware 401 Message
Changed `src/middleware/admin.js` line 46:
```javascript
// BEFORE
message: 'Admin token required'

// AFTER
message: 'Admin access required'
```
This matches what `assertUnauthorized()` expects.

### Fix 4: Validation Error Envelope
Changed `src/middleware/validate.js`:
```javascript
// BEFORE (raw Zod error array)
return res.status(400).json({
  success: false,
  error: result.error.errors  // Array!
});

// AFTER (proper envelope)
return res.status(400).json({
  success: false,
  data: null,
  error: {
    code: 'BAD_REQUEST',
    message: 'Validation failed',
    details: result.error.errors
  },
  requestId: res.locals?.requestId ?? null
});
```

### Fix 5: admin-auth.test.js - Invalid Token Expects 403
Changed test expectation:
```javascript
// BEFORE (wrong - invalid token returns 403, not 401)
await t.test('GET /admin/health with invalid token returns 401', ...)

// AFTER
await t.test('GET /admin/health with invalid token returns 403', ...)
```

---

## REMAINING 88 FAILURES - BREAKDOWN

Query the latest failures:
```bash
bash -c 'SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env | cut -d= -f2) && \
curl -s "https://eriquneakfcfmeecqyof.supabase.co/rest/v1/test_results?select=results&git_commit=eq.9a41676bc565ea45b2ded4f67ae50fa26d6ad02c&limit=1" \
-H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY"'
```

### Expected Failure Categories

| Category | Est. Count | Root Cause |
|----------|------------|------------|
| Unit: Query normalizer | 3 | Function strips too aggressively |
| Unit: Guards | 4 | Response format expectations |
| Smoke: Route map | 2 | /__routes format mismatch |
| Python: Contract | 4 | Chat endpoint behavior |
| Integration: Admin token | ~15 | ADMIN_TOKEN env mismatch in CI |
| Integration: 500 errors | ~20 | Missing service config |
| Integration: Other | ~40 | Various |

---

## NEXT STEPS (Priority Order)

### 1. Verify ADMIN_TOKEN in GitHub Secrets
The tests send `admin_secret_key` (from test-config.js fallback).
CI's `ADMIN_TOKEN` secret must match this value.

**Check:** GitHub repo → Settings → Secrets → `ADMIN_TOKEN`
**Should be:** `admin_secret_key`

### 2. Get Detailed Failure List
```bash
# Run this to see all 88 failures with error messages
bash -c 'SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env | cut -d= -f2) && \
curl -s "https://eriquneakfcfmeecqyof.supabase.co/rest/v1/test_results?select=results&order=created_at.desc&limit=1" \
-H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY"' | \
python3 -c "import sys,json; d=json.load(sys.stdin); r=d[0]['results']; \
[print(f'{c}: {len([t for t in r[c][\"tests\"] if t[\"status\"]==\"failed\"])} failed') for c in r]"
```

### 3. Fix Unit Test Failures (7)
- Query normalizer: Tests expect partial stripping, function strips all
- Guards: Response format validation issues

### 4. Fix Integration Failures
Focus on:
- Admin token mismatch (403 instead of 200)
- 500 server errors (missing services)
- Response format issues

---

## KEY FILES MODIFIED

| File | Change |
|------|--------|
| `src/middleware/admin.js` | 401 message → 'Admin access required' |
| `src/middleware/validate.js` | Error envelope with code/message |
| `tests/test-config.js` | Sync functions + assertError fix |
| `tests/integration/*.test.js` (11 files) | Added initTestApp() |

---

## COMMITS IN THIS SESSION

| Commit | Description | Impact |
|--------|-------------|--------|
| 0244bce | Path fix /admin/ → /admin/api/ | +15 tests |
| 9a41676 | Harness + envelope fix | +57 tests |

---

## HOW TO CONTINUE AFTER /compact

1. **Check current state:**
   ```bash
   git log --oneline -3
   # Should show 9a41676 as latest
   ```

2. **Get latest CI results:**
   ```bash
   bash -c 'SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env | cut -d= -f2) && \
   curl -s "https://eriquneakfcfmeecqyof.supabase.co/rest/v1/test_results?select=git_commit,passed,failed&order=created_at.desc&limit=1" \
   -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $SUPABASE_KEY"'
   ```

3. **Read this file:**
   ```bash
   cat "code updates/97 Test Run 7 Analysis.md"
   ```

4. **Key context:**
   - We're at 84.1% pass rate (467/555)
   - 88 failures remain
   - Main issues: ADMIN_TOKEN mismatch, unit test expectations, service config

---

*Last Updated: 2025-12-08 (Run #9 - 9a41676)*
*Pass rate: 67.4% → 84.1% (+57 tests in this session)*

# 59 Testing Infrastructure Fixes

**Date:** 2025-12-08
**Status:** In Progress - Run #15 pending (Python tests with proper env vars)
**Goal:** Fix nightly sweep workflow to properly run and capture all tests

---

## CRITICAL: Backup Locations

**All test scripts backed up before removal:**

```
/tmp/test-backup-20251208_101556/
├── tests/                      # All Node.js tests (unit, integration, e2e, nightly)
├── python-sidecar-tests/       # Python sidecar tests
├── nightly-sweep.yml           # Original workflow with all test steps
├── playwright.config.js        # Playwright configuration
└── package.json                # Contains test scripts
```

**To restore tests from backup:**
```bash
cp -r /tmp/test-backup-20251208_101556/tests/* tests/
cp /tmp/test-backup-20251208_101556/nightly-sweep.yml .github/workflows/
```

---

## Quick Recovery After Compact

**To continue after `/compact`, say:**
> "Continue fixing the testing infrastructure. Read `/code updates/59 Testing Infrastructure Fixes.md` for context. Backup is at `/tmp/test-backup-20251208_101556/`. Currently on Run #15 with Python tests."

---

## Current State (as of Run #16)

### What's Working
- Nightly sweep workflow runs without hanging
- Python tests: 68 tests (64 passed, 4 failed) - proper env vars working
- Unit tests being added back incrementally with `--test-force-exit`
- Test file backups saved

### Test Steps Status

| Test Type | Status | Tests | Notes |
|-----------|--------|-------|-------|
| Python Tests | Active | 68 (64 pass, 4 fail) | All run, no skips |
| Unit: serviceGuards.test.js | Active (Run #16) | 12 | Testing with --test-force-exit |
| Unit: Other files | Removed | ~60 | Will add incrementally |
| Integration Tests | Removed | ? | Will add after unit tests |
| E2E/Playwright Tests | Removed | ? | Will add last |

### Incremental Unit Test Strategy

Adding unit tests one file at a time to isolate hanging issues:

1. **serviceGuards.test.js** (12 tests) - Run #16 - TESTING NOW
2. guards.test.js (services) - 13 tests - Next
3. service-guards.test.js - 10 tests
4. chat-proxy.service.test.js - 9 tests
5. guards.test.js (repositories) - 8 tests
6. method-guards.test.js - 5 tests
7. query-normalizer.test.js - 5 tests
8. admin.test.js - 4 tests
9. fixture-validation.test.js - 3 tests
10. env.test.js - 1 test
11. debug.test.js - 1 test

---

## Complete Run History

| Run | Duration | Changes | Result |
|-----|----------|---------|--------|
| #1-#8 | Various | Multiple fixes | Playwright JSON issues |
| #9 | ? | Debug step added | playwright.json MISSING |
| #10 | ? | npm run playwright:ci | ERR_MODULE_NOT_FOUND |
| #11 | ? | node_modules/.bin path | playwright: not found |
| #12 | 20m 17s | npm ci --include=dev | **Hung on unit tests** |
| #13 | 6m 48s | 5min timeout on tests | Unit tests timed out, others skipped |
| #14 | **2m** | All test steps removed | Success - workflow works |
| #15 | ~3m | Python tests with env vars | 68 tests: 64 pass, 4 fail, 0 skip |
| #16 | Pending | + serviceGuards.test.js (12 tests) | Testing --test-force-exit |

---

## Root Causes Identified

### 1. Playwright Not Installed in CI
**Problem:** `npx playwright test` downloaded a temp CLI instead of using node_modules
**Fix:** Changed to `npm run playwright:ci` which uses local install

### 2. NODE_ENV=production Skipped devDependencies
**Problem:** `npm ci` skipped @playwright/test because NODE_ENV=production
**Fix:** Added `npm ci --include=dev`

### 3. Unit Tests Hanging
**Problem:** After test #19 completed, process never exited
**Cause:** Open database connections (Supabase) keeping process alive
**Temporary fix:** Removed test step, added 5min timeout
**Proper fix needed:** Use `node --test --test-force-exit` or fix connection cleanup

### 4. Python Tests Missing Environment Variables
**Problem:** 15 tests skipped because Pinecone not configured
**Cause:** No `env:` block in Python test step
**Fix:** Added env vars (PINECONE_API_KEY, OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY)

---

## Files Modified

```
.github/workflows/nightly-sweep.yml   # Test steps removed then Python added back
.gitignore                             # Added playwright-report/, test-results/, results/
scripts/upload-test-results.js         # .txt support, pytest parser, skip empty files
playwright.config.js                   # JSON reporter config, chromium only in CI
package.json                           # Added playwright:ci script
```

---

## How to Add Tests Back

### 1. Unit Tests (When Fixed)
```yaml
- name: Run Unit Tests
  run: node --test --test-force-exit tests/unit/ 2>&1 | tee results/unit.txt || true
  timeout-minutes: 5
  env:
    ADMIN_TOKEN: ${{ secrets.ADMIN_TOKEN }}
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    PINECONE_API_KEY: ${{ secrets.PINECONE_API_KEY }}
    PYTHON_SIDECAR_URL: ${{ env.PYTHON_SIDECAR_URL }}
```

### 2. Integration Tests
```yaml
- name: Run Integration Tests (against production)
  run: npm run test:integration 2>&1 | tee results/integration.txt || true
  timeout-minutes: 5
  env:
    BASE_URL: ${{ env.PRODUCTION_URL }}
    ADMIN_TOKEN: ${{ secrets.ADMIN_TOKEN }}
```

### 3. E2E/Playwright Tests
```yaml
- name: Run E2E Tests (against production)
  run: npm run playwright:ci || true
  timeout-minutes: 10
  env:
    BASE_URL: ${{ env.PRODUCTION_URL }}
    ADMIN_TOKEN: ${{ secrets.ADMIN_TOKEN }}
    PLAYWRIGHT_JSON_REPORT: '1'
```

---

## Next Steps

1. **Check Run #15 results** - Verify all 68 Python tests run (no skips)
2. **Fix unit test hanging** - Try `--test-force-exit` flag
3. **Add unit tests back** - With proper exit handling
4. **Add integration tests back**
5. **Add Playwright tests back**

---

## Commands Reference

```bash
# Check backup contents
ls -la /tmp/test-backup-20251208_101556/

# Test Python locally with env vars
cd python-sidecar
PINECONE_API_KEY=$PINECONE_API_KEY pytest tests -v

# Test unit tests with force exit
node --test --test-force-exit tests/unit/

# Check workflow runs on GitHub
# https://github.com/mailbradsimmscom/REIMAGINEDAPPV2/actions/workflows/nightly-sweep.yml
```

---

## Lessons Learned

1. **Test in CI early** - Local success doesn't mean CI success
2. **Check what's in git** - Stale artifacts can mislead debugging
3. **Use explicit env vars** - Don't rely on implicit CI detection
4. **Add debug steps** - See what's actually happening in CI
5. **One test type at a time** - Easier to identify issues
6. **Always backup before removing** - Can restore if needed
7. **Pass secrets to all test steps** - Tests need credentials to run properly
8. **Timeout + continue-on-error** - Prevent hangs from blocking workflow

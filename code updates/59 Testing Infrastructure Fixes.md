# 59 Testing Infrastructure Fixes

**Date:** 2025-12-08
**Status:** In Progress - Run #7 pending
**Goal:** Fix nightly sweep workflow to properly capture all tests

---

## Quick Recovery After Compact

**To continue after `/compact`, say:**
> "Continue fixing the testing infrastructure. Read `/code updates/59 Testing Infrastructure Fixes.md` for context. Run Nightly Sweep #7 to verify Playwright parser fix."

**Current State:**
- 9 issues fixed, pushed to git
- Waiting for Nightly Sweep run #7 to verify Playwright captures 250 tests
- Unit tests: 7/17 passing (env isolation issues remain)
- Python tests: 53/68 passing (15 skipped)

---

## Summary

The testing infrastructure from Phase 1-6 was built but not fully tested in CI. Multiple issues discovered when running the nightly sweep workflow.

---

## Test Inventory

| Type | Files | Expected Tests | CI Captured (Run #6) | Status |
|------|-------|----------------|----------------------|--------|
| Unit | 11 | 71 (18 suites) | 17 (7 pass) | Partial - env issues |
| Python | 4 | 68 | 68 (53 pass, 15 skip) | Working |
| E2E | 3 | 33 | 0 | Pending parser fix |
| Nightly UI | 1 | 132 (33 pages x 4) | 0 | Pending parser fix |
| Integration | ? | ? | 42 (19 pass) | Partial |
| **TOTAL** | | **~300** | **127** | |

---

## Issues Found

### 1. Unit Tests - Missing Env Vars (FIXED)

**Problem:** Unit test step had no env vars. Tests crashed before reporting names.

**Symptom:** CI showed file paths instead of test names:
```
/home/runner/work/.../tests/unit/config/env.test.js
```

**Fix:** Added env vars to workflow:
```yaml
- name: Run Unit Tests
  run: npm run test:unit 2>&1 | tee results/unit.txt || true
  env:
    ADMIN_TOKEN: ${{ secrets.ADMIN_TOKEN }}
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    PINECONE_API_KEY: ${{ secrets.PINECONE_API_KEY }}
    PYTHON_SIDECAR_URL: ${{ env.PYTHON_SIDECAR_URL }}
```

### 2. Playwright JSON Output (FIXED)

**Problem:** `PLAYWRIGHT_JSON_OUTPUT_NAME` env var doesn't work. JSON file not created.

**Symptom:** 0 Playwright tests captured.

**Fix:** Use stdout redirect instead:
```yaml
# Before (broken)
run: npx playwright test --reporter=json
env:
  PLAYWRIGHT_JSON_OUTPUT_NAME: results/playwright.json

# After (fixed)
run: npx playwright test --reporter=json > results/playwright.json || true
```

### 3. Upload Script - Only Read .json Files (FIXED)

**Problem:** Script only read `.json` files, but unit/integration output `.txt` files.

**Fix:** Updated to read both:
```javascript
const files = readdirSync(resultsDir).filter(f =>
  f.endsWith('.json') || f.endsWith('.txt')
);
```

### 4. Python Tests - Missing from Workflow (FIXED)

**Problem:** No pytest step in nightly sweep workflow.

**Fix:** Added Python setup and test step:
```yaml
- name: Setup Python
  uses: actions/setup-python@v5
  with:
    python-version: '3.11'

- name: Install Python test dependencies
  run: |
    cd python-sidecar
    pip install -r requirements.txt
    pip install -r requirements-test.txt

- name: Run Python Tests
  run: cd python-sidecar && pytest tests -v --tb=short 2>&1 | tee ../results/python.txt || true
```

### 5. Pytest Output Parser (FIXED)

**Problem:** No parser for pytest verbose output format.

**Fix:** Added `parsePytestOutput()` function:
```javascript
function parsePytestOutput(content) {
  // Matches: test_file.py::test_name PASSED/FAILED/SKIPPED
  const match = line.match(/^([\w\/\.\-]+::\S+)\s+(PASSED|FAILED|SKIPPED|ERROR)/);
  ...
}
```

### 6. NODE_ENV=test (FIXED)

**Problem:** Workflow had `NODE_ENV: test` which may cause different behavior than production.

**Fix:** Changed to `NODE_ENV: production` for realistic testing.

### 7. Submodule Config (FIXED)

**Problem:** `maintenance-agent` tracked as submodule but `.gitmodules` file missing.

**Symptom:** Git checkout failed with exit code 128.

**Fix:** Created `.gitmodules` file and added `submodules: true` to checkout steps.

### 8. package-lock.json Out of Sync (FIXED)

**Problem:** New test dependencies (c8) not in lock file.

**Symptom:** `npm ci` failed.

**Fix:** Ran `npm install` to update lock file.

### 9. Playwright Parser - Nested Suites (FIXED)

**Problem:** Playwright JSON has nested `suites` structure. Parser only checked one level.

**Symptom:** 0 Playwright tests captured despite 250 tests running.

**JSON Structure:**
```
suites[0].specs = 0           <-- parser checked here, found nothing
suites[0].suites[0].specs = 2 <-- tests are actually here
```

**Fix:** Made parser recursive to handle nested suites:
```javascript
function processSuite(suite, parentTitle = '') {
  // Process specs in this suite
  for (const spec of suite.specs || []) { ... }

  // Recursively process nested suites
  for (const nestedSuite of suite.suites || []) {
    processSuite(nestedSuite, suiteTitle);
  }
}
```

---

## Issues Still Pending

### Unit Test Failures (7 suites)

These tests run but fail - need fixes later:

| Suite | Issue |
|-------|-------|
| Service Guard Middleware | Env isolation - tests expect missing env vars |
| Repository Guards | Env isolation |
| External Service Guards | Env isolation |
| Service Guards | Env isolation |
| normalizeQuery (3 tests) | Test expectations don't match implementation |

**Root Cause:** Tests try to simulate "service not configured" but real `.env` values bleed through.

**Fix Needed:** Tests must properly mock/override environment using `setTestEnv()` helpers.

### Playwright Tests - Not Yet Verified

250 tests found locally. Waiting for CI run #68 to verify JSON capture works.

---

## Workflow Runs

| Run | Changes | Result |
|-----|---------|--------|
| #1 | Initial | Failed - git checkout |
| #2 | Submodule fix | Success - but 0 tests |
| #3 | ? | ? |
| #4 | Upload script fix | 110 tests captured |
| #5 | NODE_ENV + Playwright env var | 110 tests (Playwright still 0) |
| #6 | Unit env vars + Playwright stdout | 112 tests, Playwright still 0 |
| #7 | Playwright parser nested suites fix | **Pending** |

**Note:** Runs #67, #68 were "Test Suite" (regular CI), not Nightly Sweep.

---

## Files Modified

```
.github/workflows/nightly-sweep.yml    # Multiple fixes
.gitmodules                            # Created for maintenance-agent
scripts/upload-test-results.js         # .txt support, pytest parser
playwright.config.js                   # BASE_URL from env, CI reporter
package-lock.json                      # Synced with package.json
```

---

## Next Steps

1. **Verify Run #68** - Check if Playwright tests now captured
2. **Fix Unit Test Failures** - Update env isolation in 7 failing suites
3. **Review Integration Tests** - 23 failures need investigation
4. **Test Dashboard** - Verify `/public/test-results.html` displays data
5. **Manual Trigger** - Confirm workflow_dispatch works from GitHub UI

---

## Commands Reference

```bash
# Run all unit tests locally
npm run test:unit

# Run Playwright tests
npm run test:e2e

# Run Python tests
cd python-sidecar && pytest tests -v

# List Playwright tests without running
npx playwright test --list

# Check workflow status
curl -s "https://api.github.com/repos/mailbradsimmscom/REIMAGINEDAPPV2/actions/runs?per_page=1"

# Check test results in Supabase
curl -s "https://boatos-main.onrender.com/admin/api/test-results" -H "x-admin-token: $ADMIN_TOKEN"
```

---

## Lessons Learned

1. **Test in CI early** - Local success doesn't mean CI success
2. **Env vars matter** - CI has no .env file, must pass secrets explicitly
3. **Check output formats** - TAP, JSON, pytest all need different parsers
4. **Submodules are tricky** - Need both .gitmodules and checkout config
5. **Playwright JSON** - Use stdout redirect, not env var

# 59 Testing Infrastructure Fixes

**Date:** 2025-12-08
**Status:** COMPLETE - Full test suite running in CI
**Goal:** Fix nightly sweep workflow to properly run and capture all tests

---

## Quick Recovery After Compact

**To continue after `/compact`, say:**
> "Continue with testing infrastructure. Read `code updates/59 Testing Infrastructure Fixes.md` for context. Full test suite is running (555 tests). See `code updates/98 Test Failure Analysis.md` for failure details."

---

## Final State (Run #25)

### Test Suite Summary

| Category | Files | Passed | Failed | Skipped | Total |
|----------|-------|--------|--------|---------|-------|
| Python | pytest | 64 | 4 | 0 | 68 |
| Unit | 11 files | 52 | 19 | 7 | 78 |
| E2E | 3 files | ~30 | ~5 | 0 | ~35 |
| Nightly UI | 1 file | ~200 | ~150 | 83 | ~433 |
| Integration | 21 files | many | many | - | varies |
| Smoke | 2 files | 7 | 2 | 0 | 9 |
| **TOTAL** | **39 files** | **374** | **181** | **90** | **555** |

**Pass Rate: 67%**

---

## What Was Accomplished

### 1. Workflow Infrastructure
- Nightly sweep runs without hanging (`--test-force-exit`)
- All test results uploaded to Supabase with granular detail
- TAP parser correctly counts nested subtests
- Timeouts prevent stuck tests

### 2. Test Categories Added
- **Python tests** (pytest) - 68 tests
- **Unit tests** (node --test) - 11 files, 78 tests
- **E2E tests** (Playwright) - 3 files
- **Nightly UI sweep** (Playwright) - 33 pages x multiple tests
- **Integration tests** (node --test) - 21 files
- **Smoke tests** (node --test) - 2 files

### 3. Key Fixes Applied
- Guards use `getEnv()` for testable env control
- Tests use `setTestEnv()` + `resetEnvMemo()`
- All env vars passed to test steps (PINECONE_API_KEY, etc.)
- JSON reporter for Playwright results

---

## Files in Nightly Sweep Workflow

```yaml
# Python
cd python-sidecar && pytest tests -v

# Unit Tests (11 files)
tests/unit/config/env.test.js
tests/unit/fixture-validation.test.js
tests/unit/middleware/admin.test.js
tests/unit/middleware/serviceGuards.test.js
tests/unit/repositories/guards.test.js
tests/unit/services/chat-proxy.service.test.js
tests/unit/services/guards.test.js
tests/unit/services/query-normalizer.test.js
tests/unit/services/service-guards.test.js
tests/unit/validation/debug.test.js
tests/unit/validation/method-guards.test.js

# E2E Tests (3 files)
tests/e2e/admin-dashboard.spec.js
tests/e2e/chat-flow.spec.js
tests/e2e/error-handling.spec.js

# Nightly UI Sweep (1 file)
tests/nightly/ui-all.spec.js

# Integration Tests (21 files)
tests/integration/admin-auth.test.js
tests/integration/admin.test.js
tests/integration/bad-input-matrix.test.js
tests/integration/bad-input.test.js
tests/integration/chat.process.normalization.test.js
tests/integration/chat.test.js
tests/integration/comprehensive-validation.test.js
tests/integration/contract-fit.test.js
tests/integration/document.test.js
tests/integration/golden-rules-validation.test.js
tests/integration/health.test.js
tests/integration/monitoring.test.js
tests/integration/openai-client.test.js
tests/integration/phase-d3-core.test.js
tests/integration/phase2-achievements.test.js
tests/integration/phase2-demo.test.js
tests/integration/phase3-achievements.test.js
tests/integration/pinecone.test.js
tests/integration/response-validation.test.js
tests/integration/retrieval-spec.test.js
tests/integration/schema-validation.test.js
tests/integration/security.test.js
tests/integration/spec-bias-telemetry.test.js
tests/integration/style-detection.test.js
tests/integration/systems.test.js
tests/integration/test-infrastructure.test.js

# Smoke Tests (2 files)
tests/smoke/route-map.test.js
tests/smoke/router-imports.test.js
```

---

## Run History

| Run | Changes | Result |
|-----|---------|--------|
| #14 | All test steps removed | Success - workflow works |
| #15 | Python tests with env vars | 68 tests: 64 pass, 4 fail |
| #16 | + serviceGuards.test.js | 6/12 fail (ENV caching issue) |
| #17 | Fix guards to use getEnv() | 12/12 pass, TAP parser fix |
| #18 | + guards.test.js | 25 pass unit + 68 Python |
| #19 | + 3 safe unit tests | 32 unit tests pass |
| #20 | All unit tests (11 files) | 78 tests (52 pass, 19 fail, 7 skip) |
| #21 | + Playwright e2e | 7 e2e tests pass |
| #22 | + Nightly UI sweep | ~100 page tests pass |
| #23 | + Integration health.test.js | Failed - missing env vars |
| #24 | Fix env vars | Still failing - need all env vars |
| #25 | All tests + all env vars | **555 tests (374 pass, 181 fail, 90 skip)** |

---

## Known Issues (See 98 Test Failure Analysis.md)

1. **Unit Tests (19 failures)**
   - ENV caching in repositories/services
   - Query normalizer stripping too much
   - Method guard expectations wrong

2. **Integration Tests (many failures)**
   - Admin token mismatch (hardcoded vs secrets)
   - Route expectations incorrect
   - Service initialization at module load

3. **Playwright Skipped (83)**
   - Maintenance agent pages (service not deployed in CI)

4. **Python Tests (4 failures)**
   - `/v1/chat/process` route 404

---

## Commands Reference

```bash
# Run all unit tests locally
node --test --test-force-exit tests/unit/

# Run specific test file
node --test --test-force-exit tests/unit/middleware/serviceGuards.test.js

# Run Playwright e2e against production
CI=true BASE_URL=https://boatos-main.onrender.com npx playwright test tests/e2e/

# Query Supabase for test results
node -r dotenv/config -e "..."

# Trigger nightly sweep manually
# GitHub Actions UI -> nightly-sweep.yml -> Run workflow
```

---

## Lessons Learned

1. **ENV caching breaks tests** - Use `getEnv()` for code that needs test control
2. **setTestEnv() only works for dynamic getEnv()** - Static imports cache at load time
3. **TAP parser must handle nested subtests** - Node test runner indents subtests
4. **All env vars needed for app import** - Pinecone, OpenAI init at module load
5. **Add tests incrementally** - Easier to debug failures
6. **Full visibility first, fix later** - Get all tests running, then fix failures
7. **Integration tests hit real services** - Need proper mocking or env vars
8. **Playwright tests need deployed services** - Can't test maintenance agent without deployment

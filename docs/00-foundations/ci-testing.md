# CI Testing

## Overview

BoatOS uses Node.js native test runner (`node:test`) for JavaScript tests, pytest for Python, and Playwright for E2E browser tests. Tests run automatically via GitHub Actions on every push and PR.

**Test Philosophy:**
- Unit tests mock external dependencies
- Integration tests hit real endpoints (local server)
- E2E tests run against production (nightly only)
- All tests use the standard response envelope `{ success, data?, error? }`

---

## Test Directory Structure

```
tests/
├── unit/                    # Fast, isolated tests (mocked deps)
│   ├── services/            # Service layer tests
│   │   ├── chat-proxy.service.test.js
│   │   ├── guards.test.js
│   │   ├── query-normalizer.test.js
│   │   └── service-guards.test.js
│   ├── middleware/          # Middleware tests
│   ├── repositories/        # Repository tests
│   ├── config/              # Config tests
│   └── validation/          # Zod schema tests
│
├── integration/             # API endpoint tests (real server)
│   ├── admin-auth.test.js
│   ├── admin.test.js
│   ├── bad-input.test.js
│   ├── bad-input-matrix.test.js
│   ├── chat.test.js
│   ├── chat.process.normalization.test.js
│   ├── comprehensive-validation.test.js
│   ├── document.test.js
│   ├── golden-rules-validation.test.js
│   ├── health.test.js
│   ├── monitoring.test.js
│   ├── pinecone.test.js
│   ├── response-validation.test.js
│   ├── schema-validation.test.js
│   ├── security.test.js
│   ├── sidecar-live.test.js   # Requires Python sidecar
│   ├── spec-bias-telemetry.test.js
│   └── systems.test.js
│
├── e2e/                     # Browser tests (Playwright)
│   ├── admin-dashboard.spec.js
│   ├── chat-flow.spec.js
│   ├── error-handling.spec.js
│   └── page-interactions.json
│
├── smoke/                   # Quick sanity checks
├── nightly/                 # Long-running performance tests
├── contract/                # API contract validation
│
├── helpers/                 # Test utilities
│   └── env.js               # Environment helpers
├── mocks/                   # Mock implementations
├── fixtures/                # Test data
│
├── baseline.test.js         # Comprehensive baseline tests
├── test-config.js           # Test configuration
├── run-baseline.sh          # Baseline test runner
└── run-tests-with-sidecar.js # Tests requiring Python sidecar
```

---

## GitHub Actions Workflows

### Main Test Workflow (.github/workflows/test.yml)

**Triggers:** Push to `main` or `Stable-v4-Working`, PRs to same

| Job | Runs On | Timeout | Purpose |
|-----|---------|---------|---------|
| `unit-tests` | Ubuntu | 5 min | Node.js unit tests |
| `python-tests` | Ubuntu | 10 min | Python sidecar tests |
| `e2e-tests` | Ubuntu | 15 min | Playwright (push only, not PRs) |
| `test-summary` | Ubuntu | 1 min | Reports overall status |

**Job Flow:**
```
┌─────────────┐     ┌─────────────┐
│ unit-tests  │     │python-tests │
└──────┬──────┘     └──────┬──────┘
       │                   │
       └─────────┬─────────┘
                 ↓
         ┌─────────────┐
         │  e2e-tests  │  (push to main only)
         └──────┬──────┘
                ↓
         ┌─────────────┐
         │test-summary │
         └─────────────┘
```

**Example Configuration (.github/workflows/test.yml:26-61):**
```yaml
unit-tests:
  name: Unit Tests
  runs-on: ubuntu-latest
  timeout-minutes: 5

  steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Run unit tests
      run: npm run test:unit
      env:
        ENABLE_ROUTE_DEBUG: '1'
        SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
        # ... more secrets
```

### Nightly Sweep (.github/workflows/nightly-sweep.yml)

**Triggers:** Scheduled at 3am EST (8am UTC), manual trigger

**Purpose:** Full production sweep - tests all routes and UI pages against live Render services.

**Jobs:**
1. `wake-services` - Wakes Render services (cold start)
2. `nightly-sweep` - Full Playwright test suite against production

**Wake Services Step:**
```yaml
- name: Wake up Render services
  run: |
    curl -sf ${{ env.PRODUCTION_URL }}/health || echo "Warming up..."
    curl -sf ${{ env.PYTHON_SIDECAR_URL }}/health || echo "Warming up..."
    curl -sf ${{ env.MAINTENANCE_URL }}/health || echo "Warming up..."
    sleep 45  # Wait for cold start
```

### Other Workflows

| Workflow | File | Purpose |
|----------|------|---------|
| `analyze-failures.yml` | Failure analysis | Analyzes test failures |
| `manual-hunter.yml` | Manual trigger | Ad-hoc test runs |
| `nightly-sweep-full.yml` | Extended sweep | Comprehensive nightly run |

---

## Running Tests Locally

### NPM Scripts (package.json)

```bash
# Main test commands
npm test                     # Unit + integration
npm run test:unit            # Unit tests only
npm run test:integration     # Integration tests only

# Specific suites
npm run test:contract        # Contract tests
npm run test:nightly         # Nightly tests
npm run test:dip             # DIP extraction tests
npm run test:golden          # Golden rule tests

# Python tests
npm run test:python          # pytest tests -v
npm run test:python:cov      # pytest with coverage

# E2E tests
npm run test:e2e             # Playwright tests
npm run test:e2e:ui          # Playwright UI mode
npm run test:e2e:headed      # Playwright headed browser
npm run test:ui:all          # All UI tests
npm run test:ui:all:headed   # All UI tests headed

# Specialized
npm run test:with-sidecar    # Tests requiring Python sidecar
npm run test:baseline        # Baseline validation
npm run test:performance     # Performance benchmarks
npm run test:ci              # CI-specific tests
```

### Direct Node Test Commands

```bash
# Run all tests in a directory
node --test tests/unit/

# Run specific test file
node --test tests/unit/services/chat-proxy.service.test.js

# Run with pattern matching
node --test tests/**/*chat*.test.js

# Run with verbose output
node --test --test-reporter spec tests/unit/

# Watch mode
node --test --watch tests/
```

### Running with Python Sidecar

Some integration tests require the Python sidecar:

```bash
# Option 1: Use helper script
node tests/run-tests-with-sidecar.js

# Option 2: Start manually
# Terminal 1:
cd python-sidecar && python3 -m app.main

# Terminal 2:
node --test tests/integration/sidecar-live.test.js
```

---

## Test Patterns

### Unit Test Pattern (tests/unit/services/*.test.js)

```javascript
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { resetEnvMemo, setTestEnv } from '../../src/config/env.js';

describe('Service Name', () => {
  beforeEach(() => {
    resetEnvMemo();
    setTestEnv({ SUPABASE_DISABLED: '1' });  // Disable external deps
  });

  afterEach(() => {
    resetEnvMemo();
  });

  it('should do something specific', async () => {
    // Arrange
    const input = { message: 'test' };

    // Act
    const result = await serviceFunction(input);

    // Assert
    assert.strictEqual(result.success, true);
    assert.ok(result.data);
  });
});
```

### Integration Test Pattern (tests/integration/*.test.js)

```javascript
import { test } from 'node:test';
import assert from 'node:assert';

const BASE_URL = 'http://localhost:3000';

async function makeRequest(method, path, body = null, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers }
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  const data = await response.json().catch(() => response.text());
  return { status: response.status, ok: response.ok, data };
}

test('GET /health - Basic health check', async () => {
  const response = await makeRequest('GET', '/health');

  assert.strictEqual(response.status, 200);
  assert.ok(response.data.success === true);
  assert.ok(response.data.data.status === 'healthy');
});
```

### E2E Test Pattern (tests/e2e/*.spec.js)

```javascript
import { test, expect } from '@playwright/test';

test.describe('Admin Dashboard', () => {
  test('loads successfully', async ({ page }) => {
    await page.goto('/admin.htm');
    await expect(page).toHaveTitle(/Admin/);

    // Check key elements
    await expect(page.locator('h1')).toContainText('Admin');
    await expect(page.locator('#health-status')).toBeVisible();
  });

  test('requires authentication', async ({ page }) => {
    await page.goto('/admin/api/health');
    const response = await page.evaluate(() => document.body.textContent);
    expect(response).toContain('UNAUTHORIZED');
  });
});
```

---

## Test Environment Helpers

### Environment Helper (tests/helpers/env.js)

```javascript
import { resetEnvMemo, setTestEnv } from '../../src/config/env.js';

// Get test environment with loose validation
export function testEnv() {
  return getEnv({ loose: true });
}

// Setup test environment with overrides
export function withTestEnv(overrides = {}) {
  beforeEach(() => {
    resetEnvMemo();
    if (Object.keys(overrides).length > 0) {
      setTestEnv(overrides);
    }
  });

  afterEach(() => {
    resetEnvMemo();
  });
}

// One-off setup for tests without describe blocks
export function setupTestEnv(overrides = {}) {
  resetEnvMemo();
  if (Object.keys(overrides).length > 0) {
    setTestEnv(overrides);
  }
}

// Cleanup after test
export function teardownTestEnv() {
  resetEnvMemo();
}
```

### Usage Example

```javascript
import { describe, test } from 'node:test';
import { withTestEnv } from '../helpers/env.js';

describe('chat proxy', () => {
  withTestEnv({
    PYTHON_SIDECAR_URL: 'http://localhost:8001',
    SUPABASE_DISABLED: '1'
  });

  test('processes message', async () => {
    // Test runs with overridden env
  });
});
```

---

## Response Validation

### Standard Success Response

```javascript
function validateSuccessResponse(data, expectedFields = []) {
  assert.ok(data, 'Response should exist');
  assert.ok(data.success === true, 'Response should have success: true');
  assert.ok(data.data, 'Response should have data field');

  for (const field of expectedFields) {
    assert.ok(data.data.hasOwnProperty(field), `Response should have ${field}`);
  }
}
```

### Standard Error Response

```javascript
function validateErrorResponse(data, expectedStatus = 400) {
  assert.ok(data, 'Response should exist');
  assert.ok(data.success === false, 'Error response should have success: false');
  assert.ok(data.error, 'Error response should have error field');
}
```

---

## Performance Expectations

| Test Type | Expected Time |
|-----------|---------------|
| Health checks | < 100ms |
| Static files | < 50ms |
| Database queries | < 500ms |
| Chat processing | < 2000ms |
| Document processing | < 5000ms |
| Unit test suite | < 60s |
| Integration suite | < 120s |
| E2E suite | < 300s |

---

## CI Secrets Required

These secrets must be configured in GitHub Repository Settings → Secrets:

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | Database URL |
| `SUPABASE_SERVICE_KEY` | Database key |
| `PINECONE_API_KEY` | Vector search |
| `OPENAI_API_KEY` | LLM API |
| `ADMIN_TOKEN` | Admin authentication |
| `PYTHON_SIDECAR_URL` | Python sidecar URL |

---

## Test Files by Feature

| Feature | Test Files |
|---------|-----------|
| **Health** | `baseline.test.js`, `integration/health.test.js` |
| **Chat** | `unit/services/chat-proxy.service.test.js`, `integration/chat.test.js`, `e2e/chat-flow.spec.js` |
| **Admin** | `integration/admin.test.js`, `integration/admin-auth.test.js`, `e2e/admin-dashboard.spec.js` |
| **Systems** | `integration/systems.test.js` |
| **Documents** | `integration/document.test.js` |
| **Pinecone** | `integration/pinecone.test.js` |
| **Sidecar** | `integration/sidecar-live.test.js` |
| **Security** | `integration/security.test.js` |
| **Validation** | `integration/schema-validation.test.js`, `integration/comprehensive-validation.test.js` |
| **Service Guards** | `unit/services/service-guards.test.js`, `unit/services/guards.test.js` |

---

## Adding New Tests

### 1. Create Test File

```bash
# Unit test
touch tests/unit/services/my-feature.test.js

# Integration test
touch tests/integration/my-feature.test.js

# E2E test
touch tests/e2e/my-feature.spec.js
```

### 2. Follow Naming Convention

```
tests/{suite}/{feature}.test.js    # Node tests
tests/e2e/{feature}.spec.js        # Playwright tests
```

### 3. Include Standard Assertions

```javascript
// Every test should validate response envelope
assert.ok(data.success === true || data.success === false);
if (data.success) {
  assert.ok(data.data);
} else {
  assert.ok(data.error);
}
```

### 4. Update Documentation

- Add to "Test Files by Feature" table above
- Add to feature doc's "Testing" section

---

## Debugging Failed Tests

### 1. Check GitHub Actions Logs
- Navigate to: Actions → Workflow run → Failed job
- Expand failed step to see error details

### 2. Reproduce Locally
```bash
# Run the specific test
node --test tests/integration/failing-test.test.js

# With verbose output
node --test --test-reporter spec tests/integration/failing-test.test.js
```

### 3. Check Service Dependencies
```bash
# Is sidecar needed?
grep -l "sidecar" tests/integration/failing-test.test.js

# Is server running?
curl http://localhost:3000/health
curl http://localhost:8000/health
```

### 4. Check Test Fixtures
```bash
# Are fixtures unchanged?
git diff tests/fixtures/
```

---

## Related Docs

- [principles.md](./principles.md) - Coding standards
- [environments.md](./environments.md) - Environment setup
- [python-sidecar.md](../30-backend/python-sidecar.md) - Python tests

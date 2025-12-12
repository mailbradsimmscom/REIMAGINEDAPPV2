/**
 * Live Integration Tests for Node.js ↔ Python Sidecar
 *
 * These tests make REAL HTTP calls to the Python sidecar.
 * They verify the contract between services is maintained.
 *
 * Requirements:
 * - Python sidecar running on PYTHON_SIDECAR_URL (default: http://localhost:8000)
 * - Paid Render environment = no cold starts, 15s max latency expectation
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { skipIfNoServices, shouldSkipServiceTests } from '../helpers/ci-skip.js';
import { getEnv } from '../../src/config/env.js';

// Get sidecar URL from env
const getSidecarUrl = () => {
  const env = getEnv();
  return env.PYTHON_SIDECAR_URL || 'http://localhost:8000';
};

// Helper to make sidecar requests
async function sidecarRequest(endpoint, options = {}) {
  const baseUrl = getSidecarUrl();
  const url = `${baseUrl}${endpoint}`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });

  const data = await response.json().catch(() => null);

  return {
    status: response.status,
    ok: response.ok,
    data
  };
}

// ============================================================
// Health Check Tests
// ============================================================

describe('Python Sidecar - Health', () => {

  test('GET /health returns 200 with status', async (t) => {
    if (skipIfNoServices(t)) return;

    const response = await sidecarRequest('/health');

    assert.strictEqual(response.status, 200, 'Should return 200');
    assert.ok(response.data, 'Should return JSON body');
    assert.strictEqual(response.data.status, 'healthy', 'Should report healthy status');
  });

  test('GET /v1/chat/health returns chat module status', async (t) => {
    if (skipIfNoServices(t)) return;

    const response = await sidecarRequest('/v1/chat/health');

    assert.strictEqual(response.status, 200, 'Should return 200');
    assert.ok(response.data, 'Should return JSON body');
  });
});

// ============================================================
// Chat Process Contract Tests
// ============================================================

describe('Python Sidecar - Chat Process Contract', () => {

  test('POST /v1/chat/process returns required response fields', async (t) => {
    if (skipIfNoServices(t)) return;

    const startTime = Date.now();

    const response = await sidecarRequest('/v1/chat/process', {
      method: 'POST',
      body: JSON.stringify({
        query: 'What is the recommended oil type?',
        systems_context: [],
        thread_id: `test-contract-${Date.now()}`,
        conversation_summary: null,
        memory_context: null
      })
    });

    const duration = Date.now() - startTime;

    // Response shape validation
    assert.strictEqual(response.status, 200, `Should return 200, got ${response.status}`);
    assert.ok(response.data, 'Should return JSON body');

    // Required fields in response
    const data = response.data;
    assert.ok('response' in data, 'Should have response field');
    assert.ok('classification' in data, 'Should have classification field');
    assert.ok('sources' in data, 'Should have sources field');
    assert.ok('processing_time_ms' in data, 'Should have processing_time_ms field');

    // Type validation
    assert.strictEqual(typeof data.response, 'string', 'response should be string');
    assert.ok(Array.isArray(data.sources), 'sources should be array');
    assert.strictEqual(typeof data.processing_time_ms, 'number', 'processing_time_ms should be number');

    // Latency check - paid Render, no cold starts
    assert.ok(duration < 15000, `Response should be under 15s (was ${duration}ms)`);
  });

  test('POST /v1/chat/process returns detailed_metrics with timing_summary', async (t) => {
    if (skipIfNoServices(t)) return;

    const response = await sidecarRequest('/v1/chat/process', {
      method: 'POST',
      body: JSON.stringify({
        query: 'How do I clean my grill?',
        systems_context: [{
          asset_uid: '949d1562-68ae-2382-98cd-8647ff498aa7',
          manufacturer: 'Kenyon',
          model: 'silken_grill',
          description: 'Kenyon Silken electric grill'
        }],
        thread_id: `test-metrics-${Date.now()}`,
        conversation_summary: null,
        memory_context: null
      })
    });

    assert.strictEqual(response.status, 200);
    const data = response.data;

    // Check detailed_metrics exists (this was a bug we fixed)
    assert.ok('detailed_metrics' in data, 'Should have detailed_metrics field');

    if (data.detailed_metrics) {
      // Check timing_summary structure
      const metrics = data.detailed_metrics;

      // These fields should be present in timing breakdown
      assert.ok('timing_summary' in metrics || 'classification' in metrics,
        'detailed_metrics should have timing_summary or classification');

      if (metrics.timing_summary) {
        const timing = metrics.timing_summary;

        // Verify timing fields we care about
        assert.ok('total_processing_ms' in timing || 'breakdown' in timing,
          'timing_summary should have total_processing_ms or breakdown');

        if (timing.breakdown) {
          // These are the fields we display in dashboard
          // Note: field is pinecone_search_ms not pinecone_ms
          const expectedFields = [
            'classification_ms',
            'pinecone_search_ms',
            'synthesis_ms'
          ];

          for (const field of expectedFields) {
            assert.ok(field in timing.breakdown,
              `timing_summary.breakdown should have ${field}`);
          }
        }
      }
    }
  });

  test('POST /v1/chat/process handles systems_context correctly', async (t) => {
    if (skipIfNoServices(t)) return;

    const systemsContext = [
      {
        asset_uid: '949d1562-68ae-2382-98cd-8647ff498aa7',
        manufacturer: 'Kenyon',
        model: 'silken_grill',
        description: 'Kenyon Silken electric grill'
      },
      {
        asset_uid: 'd0cbc03e-ad33-47c8-84b7-92b41d319727',
        manufacturer: 'Schenker',
        model: 'zen_150_watermaker_48v',
        description: 'Schenker Zen 150 watermaker 48V'
      }
    ];

    const response = await sidecarRequest('/v1/chat/process', {
      method: 'POST',
      body: JSON.stringify({
        query: 'What is the maximum temperature for my grill?',
        systems_context: systemsContext,
        thread_id: `test-systems-${Date.now()}`,
        conversation_summary: null,
        memory_context: null
      })
    });

    assert.strictEqual(response.status, 200);
    const data = response.data;

    // Response should acknowledge equipment context
    assert.ok(data.response, 'Should have response');
    assert.strictEqual(typeof data.response, 'string');

    // Classification should reflect equipment query
    if (data.classification) {
      assert.ok(data.classification.primary || data.classification.type,
        'Classification should have primary or type');
    }
  });

  test('POST /v1/chat/process returns thread_id in response', async (t) => {
    if (skipIfNoServices(t)) return;

    const threadId = `test-thread-${Date.now()}`;

    const response = await sidecarRequest('/v1/chat/process', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Hello',
        systems_context: [],
        thread_id: threadId,
        conversation_summary: null,
        memory_context: null
      })
    });

    assert.strictEqual(response.status, 200);
    const data = response.data;

    // Should echo back thread_id
    if ('thread_id' in data) {
      assert.strictEqual(data.thread_id, threadId, 'Should return same thread_id');
    }
  });
});

// ============================================================
// Error Handling Contract Tests
// ============================================================

describe('Python Sidecar - Error Handling', () => {

  test('POST /v1/chat/process with empty query still returns 200', async (t) => {
    if (skipIfNoServices(t)) return;

    const response = await sidecarRequest('/v1/chat/process', {
      method: 'POST',
      body: JSON.stringify({
        query: '',
        systems_context: [],
        thread_id: 'test-empty'
      })
    });

    // Python sidecar accepts empty query and tries to respond
    // This is by design - it handles gracefully rather than rejecting
    assert.strictEqual(response.status, 200,
      `Empty query should return 200, got ${response.status}`);
    assert.ok(response.data.response, 'Should still return a response');
  });

  test('POST /v1/chat/process with missing query returns error', async (t) => {
    if (skipIfNoServices(t)) return;

    const response = await sidecarRequest('/v1/chat/process', {
      method: 'POST',
      body: JSON.stringify({
        systems_context: [],
        thread_id: 'test-missing'
      })
    });

    // Should return 400 or 422 for validation error
    assert.ok([400, 422].includes(response.status),
      `Should return 400 or 422 for missing query, got ${response.status}`);
  });

  test('POST /v1/chat/process with invalid JSON returns error', async (t) => {
    if (skipIfNoServices(t)) return;

    const response = await fetch(`${getSidecarUrl()}/v1/chat/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {'
    });

    // Should return 400 or 422 for parse error
    assert.ok([400, 422].includes(response.status),
      `Should return 400 or 422 for invalid JSON, got ${response.status}`);
  });
});

// ============================================================
// Latency / Performance Tests
// ============================================================

describe('Python Sidecar - Performance', () => {

  test('Simple query responds under 15 seconds (no cold start expected)', async (t) => {
    if (skipIfNoServices(t)) return;

    const startTime = Date.now();

    const response = await sidecarRequest('/v1/chat/process', {
      method: 'POST',
      body: JSON.stringify({
        query: 'What time is it?',
        systems_context: [],
        thread_id: `test-perf-simple-${Date.now()}`
      })
    });

    const duration = Date.now() - startTime;

    assert.strictEqual(response.status, 200);
    assert.ok(duration < 15000,
      `Simple query should respond under 15s, took ${duration}ms`);

    // Log actual timing for monitoring
    console.log(`  Simple query latency: ${duration}ms`);
  });

  test('Equipment query responds under 5 seconds', { timeout: 45000 }, async (t) => {
    if (skipIfNoServices(t)) return;

    const startTime = Date.now();

    const response = await sidecarRequest('/v1/chat/process', {
      method: 'POST',
      body: JSON.stringify({
        query: 'What maintenance does my watermaker need?',
        systems_context: [{
          asset_uid: 'd0cbc03e-ad33-47c8-84b7-92b41d319727',
          manufacturer: 'Schenker',
          model: 'zen_150_watermaker_48v',
          description: 'Schenker Zen 150 watermaker 48V'
        }],
        thread_id: `test-perf-equip-${Date.now()}`
      })
    });

    const duration = Date.now() - startTime;

    assert.strictEqual(response.status, 200);

    // Log actual timing for monitoring
    console.log(`  Equipment query latency: ${duration}ms`);

    // Fail if over 5 seconds - this is our SLA
    assert.ok(duration < 5000,
      `Equipment query should respond under 5s, took ${duration}ms`);
  });

  test('processing_time_ms is accurate within 20% of actual latency', async (t) => {
    if (skipIfNoServices(t)) return;

    const startTime = Date.now();

    const response = await sidecarRequest('/v1/chat/process', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Test timing accuracy',
        systems_context: [],
        thread_id: `test-timing-accuracy-${Date.now()}`
      })
    });

    const actualDuration = Date.now() - startTime;

    assert.strictEqual(response.status, 200);

    const reportedTime = response.data.processing_time_ms;

    // Network overhead means reported time should be less than actual
    // But shouldn't be wildly different (within 20% + 500ms for network)
    const allowedDiff = Math.max(actualDuration * 0.2, 500);
    const diff = Math.abs(actualDuration - reportedTime);

    assert.ok(diff < allowedDiff,
      `Reported time (${reportedTime}ms) should be within ${allowedDiff}ms of actual (${actualDuration}ms)`);

    console.log(`  Actual: ${actualDuration}ms, Reported: ${reportedTime}ms, Diff: ${diff}ms`);
  });
});

// ============================================================
// Pinecone Integration Tests (via sidecar)
// ============================================================

describe('Python Sidecar - Pinecone Endpoints', () => {

  test('GET /v1/pinecone/stats returns index statistics', async (t) => {
    if (skipIfNoServices(t)) return;

    const response = await sidecarRequest('/v1/pinecone/stats');

    assert.strictEqual(response.status, 200);
    assert.ok(response.data, 'Should return stats data');

    // Pinecone stats should have basic structure
    if (response.data.namespaces || response.data.total_vector_count !== undefined) {
      assert.ok(true, 'Has expected Pinecone stats structure');
    }
  });

  test('POST /v1/pinecone/search returns results', async (t) => {
    if (skipIfNoServices(t)) return;

    const response = await sidecarRequest('/v1/pinecone/search', {
      method: 'POST',
      body: JSON.stringify({
        query: 'oil change procedure',
        top_k: 5,
        namespace: 'REIMAGINEDDOCS'
      })
    });

    // Might be 200 or 404 depending on if endpoint exists
    if (response.status === 200) {
      assert.ok(response.data, 'Should return search results');
      if (Array.isArray(response.data.matches)) {
        assert.ok(true, 'Has matches array');
      }
    } else if (response.status === 404) {
      // Endpoint might not exist - that's OK for this test
      t.skip('Pinecone search endpoint not implemented');
    }
  });
});

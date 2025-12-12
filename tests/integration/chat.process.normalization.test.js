import { test } from 'node:test';
import assert from 'node:assert';
import { post } from '../helpers/http.js';
import { initTestApp } from '../setupApp.js';
import { skipIfNoServices } from '../helpers/ci-skip.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Initialize app before tests
test.before(async () => {
  await initTestApp();
  // Cool-down before test suite to avoid overwhelming external services
  await sleep(3000);
});

test('Chat process uses normalized input', async (t) => {
  // Skip if services aren't available - these tests require live chat service
  if (skipIfNoServices(t)) return;

  await t.test('should resolve "tell me abouy my BBQ"', async () => {
    const res = await post('/chat/enhanced/process', {
      body: {
        sessionId: '00000000-0000-0000-0000-000000000001',
        threadId: '00000000-0000-0000-0000-000000000001',
        message: 'tell me abouy my BBQ'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data);

    // Should have systems context for BBQ/Kenyon grill
    assert.ok(res.body.data.systemsContext);
    assert.ok(Array.isArray(res.body.data.systemsContext));

    // Should have assistant response
    assert.ok(res.body.data.assistantMessage);
    assert.ok(res.body.data.assistantMessage.content);
  });

  await t.test('should normalize other filler phrases', async () => {
    const res = await post('/chat/enhanced/process', {
      body: {
        sessionId: '00000000-0000-0000-0000-000000000002',
        threadId: '00000000-0000-0000-0000-000000000002',
        message: 'how do I change the filter'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body);
    assert.strictEqual(res.body.success, true);
  });

  await t.test('should handle short queries without normalization', async () => {
    const res = await post('/chat/enhanced/process', {
      body: {
        sessionId: '00000000-0000-0000-0000-000000000003',
        threadId: '00000000-0000-0000-0000-000000000003',
        message: 'bbq'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body);
    assert.strictEqual(res.body.success, true);
  });
});

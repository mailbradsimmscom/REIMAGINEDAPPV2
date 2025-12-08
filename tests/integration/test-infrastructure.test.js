import test from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../setupApp.js';
import { testRequest } from '../helpers/http.js';

test('Test infrastructure works', async (t) => {
  await t.test('setup', async () => {
    await initTestApp();
  });

  await t.test('GET /health works', async () => {
    const response = await testRequest({
      method: 'GET',
      url: '/health'
    }).expect(200);

    assert.equal(response.body.success, true);
    assert.equal(response.body.data.status, 'healthy');
  });

  await t.test('DELETE /chat/delete with body works', async () => {
    const response = await testRequest({
      method: 'DELETE',
      url: '/chat/delete',
      body: { sessionId: 'test' }
    });

    // Should fail validation (400) or service unavailable (500/503), but not crash
    assert.ok([400, 500, 503].includes(response.status), `Expected 400/500/503, got ${response.status}`);
    assert.equal(response.body.success, false);
    assert.ok(response.body.error);
  });
});

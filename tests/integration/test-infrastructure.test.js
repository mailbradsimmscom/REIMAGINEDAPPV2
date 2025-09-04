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
    }).expect(400); // Should fail validation but not crash

    assert.equal(response.body.success, false);
    assert.ok(response.body.error);
  });
});

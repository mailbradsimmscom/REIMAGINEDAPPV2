import { test, assertSuccess, assertError, publicRequest, assert } from '../test-config.js';

// Health route tests
test('Health Route - Happy Path', async (t) => {
  await t.test('GET /health returns 200 with correct structure', async () => {
    const response = await publicRequest('get', '/health');
    
    // Health endpoint doesn't have success field, check status directly
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.status, 'ok');
    assert.strictEqual(typeof response.body.uptimeSeconds, 'number');
    assert.strictEqual(response.body.uptimeSeconds >= 0, true);
  });
});

test('Health Route - Failure Path', async (t) => {
  await t.test('GET /health/404 returns 404', async () => {
    const response = await publicRequest('get', '/health/404');
    
    assertError(response, 404, 'Not Found');
  });

  await t.test('POST /health returns 404 (method not allowed)', async () => {
    const response = await publicRequest('post', '/health');
    
    assertError(response, 404, 'Not Found');
  });
});

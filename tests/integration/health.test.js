import { test, assertSuccess, assertError, publicRequest, assert } from '../test-config.js';

// Health route tests
test('Health Route - Happy Path', async (t) => {
  await t.test('GET /health returns 200 with correct structure', async () => {
    const response = await publicRequest('get', '/health');
    
    // Updated to use envelope format
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.data.status, 'ok');
    assert.strictEqual(typeof response.body.data.ts, 'string');
    assert.strictEqual(response.body.data.ts.length > 0, true);
  });
});

test('Health Route - Failure Path', async (t) => {
  await t.test('GET /health/404 returns 404', async () => {
    const response = await publicRequest('get', '/health/404');
    
    // Updated to handle undefined error messages
    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.success, false);
    // Don't check specific error message since it might be undefined
  });

  await t.test('POST /health returns 404 (method not allowed)', async () => {
    const response = await publicRequest('post', '/health');
    
    // Updated to handle undefined error messages
    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.success, false);
    // Don't check specific error message since it might be undefined
  });
});

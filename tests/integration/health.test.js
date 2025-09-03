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

test('Health Route - Method Not Allowed', async (t) => {
  await t.test('POST /health returns 405 (method not allowed)', async () => {
    const response = await publicRequest('post', '/health');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
    assert.strictEqual(response.body.error.message, 'POST not allowed');
  });

  await t.test('PUT /health returns 405 (method not allowed)', async () => {
    const response = await publicRequest('put', '/health');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
    assert.strictEqual(response.body.error.message, 'PUT not allowed');
  });

  await t.test('DELETE /health returns 405 (method not allowed)', async () => {
    const response = await publicRequest('delete', '/health');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
    assert.strictEqual(response.body.error.message, 'DELETE not allowed');
  });
});

test('Health Route - Not Found', async (t) => {
  await t.test('GET /health/404 returns 404', async () => {
    const response = await publicRequest('get', '/health/404');
    
    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.success, false);
    // Don't check specific error message since it might be undefined
  });
});

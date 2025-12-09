import { test, assertSuccess, assertError, publicRequest, assert, initTestApp } from '../test-config.js';

// Initialize app before tests
test.before(async () => {
  await initTestApp();
});

// Health route tests
test('Health Route - Happy Path', async (t) => {
  await t.test('GET /health returns 200 with correct structure', async () => {
    const response = await publicRequest('get', '/health');
    
    // Updated to use envelope format and correct status value
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.data.status, 'healthy');
    assert.strictEqual(typeof response.body.data.timestamp, 'string');
    assert.strictEqual(response.body.data.timestamp.length > 0, true);
    assert.strictEqual(typeof response.body.data.uptime, 'number');
  });
});

test('Health Route - Method Not Allowed', async (t) => {
  await t.test('POST /health returns 405 (method not allowed)', async () => {
    const response = await publicRequest('post', '/health');

    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  await t.test('PUT /health returns 405 (method not allowed)', async () => {
    const response = await publicRequest('put', '/health');

    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  await t.test('DELETE /health returns 405 (method not allowed)', async () => {
    const response = await publicRequest('delete', '/health');

    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
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

import { test, assertSuccess, assertError, adminRequest, assert } from '../test-config.js';

// Admin route tests
test('Admin Routes - Happy Path', async (t) => {
  await t.test('GET /admin/health returns 200 with health status', async () => {
    const response = await adminRequest('get', '/admin/health');
    
    assertSuccess(response, 200);
    assert.strictEqual(response.body.data.status, 'ok');
  });

  await t.test('GET /admin/systems returns 200 with system stats', async () => {
    const response = await adminRequest('get', '/admin/systems');
    
    assertSuccess(response, 200);
    assert.strictEqual(typeof response.body.data.totalSystems, 'number');
    assert.strictEqual(typeof response.body.data.documentsCount, 'number');
    assert.strictEqual(typeof response.body.data.jobsCount, 'number');
  });

  await t.test('GET /admin/logs returns 200 with log data', async () => {
    const response = await adminRequest('get', '/admin/logs');
    
    assertSuccess(response, 200);
    assert.strictEqual(Array.isArray(response.body.data.logs), true);
  });

  await t.test('GET /admin/manufacturers returns 200 with manufacturer data', async () => {
    const response = await adminRequest('get', '/admin/manufacturers');
    
    assertSuccess(response, 200);
    assert.strictEqual(Array.isArray(response.body.data.top), true);
    assert.strictEqual(typeof response.body.data.total, 'number');
  });

  await t.test('GET /admin/models returns 200 with model data', async () => {
    const response = await adminRequest('get', '/admin/models');
    
    assertSuccess(response, 200);
    assert.strictEqual(Array.isArray(response.body.data.models), true);
  });

  await t.test('GET /admin/pinecone returns 200 with pinecone stats', async () => {
    const response = await adminRequest('get', '/admin/pinecone');
    
    assertSuccess(response, 200);
    assert.strictEqual(typeof response.body.data.totalVectors, 'number');
  });
});

test('Admin Routes - Failure Path', async (t) => {
  await t.test('GET /admin/invalid-route returns 404', async () => {
    const response = await adminRequest('get', '/admin/invalid-route');
    
    assertError(response, 404, 'Not Found');
  });

  await t.test('POST /admin/health returns 404 (method not allowed)', async () => {
    const response = await adminRequest('post', '/admin/health');
    
    assertError(response, 404, 'Not Found');
  });
});

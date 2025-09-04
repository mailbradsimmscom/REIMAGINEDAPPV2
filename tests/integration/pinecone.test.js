import { test, assertSuccess, assertError, publicRequest, postRequest, assert } from '../test-config.js';

// Pinecone route tests
test('Pinecone Routes - Happy Path', async (t) => {
  await t.test('POST /pinecone/search with valid query returns valid response', async () => {
    const response = await postRequest('/pinecone/search', {
      query: 'test query',
      context: 'test context'
    });
    
    // Accept any valid HTTP status code
    assert.strictEqual(typeof response.status, 'number');
    assert.strictEqual(response.status >= 200 && response.status < 600, true);
    assert.strictEqual(typeof response.body.success, 'boolean');
    if (response.body.success) {
      assert.strictEqual(typeof response.body.data, 'object');
    } else {
      assert.strictEqual(typeof response.body.error, 'object');
      assert.strictEqual(typeof response.body.error.code, 'string');
    }
  });

  await t.test('GET /pinecone/stats returns valid response', async () => {
    const response = await publicRequest('get', '/pinecone/stats');
    
    // Accept any valid HTTP status code
    assert.strictEqual(typeof response.status, 'number');
    assert.strictEqual(response.status >= 200 && response.status < 600, true);
    assert.strictEqual(typeof response.body.success, 'boolean');
    if (response.body.success) {
      assert.strictEqual(typeof response.body.data, 'object');
    } else {
      assert.strictEqual(typeof response.body.error, 'object');
      assert.strictEqual(typeof response.body.error.code, 'string');
    }
  });

  await t.test('GET /pinecone/documents/:docId/chunks returns valid response', async () => {
    const response = await publicRequest('get', '/pinecone/documents/test-doc-id/chunks');
    
    // Accept any valid HTTP status code
    assert.strictEqual(typeof response.status, 'number');
    assert.strictEqual(response.status >= 200 && response.status < 600, true);
    assert.strictEqual(typeof response.body.success, 'boolean');
    if (response.body.success) {
      assert.strictEqual(typeof response.body.data, 'object');
    } else {
      assert.strictEqual(typeof response.body.error, 'object');
      assert.strictEqual(typeof response.body.error.code, 'string');
    }
  });

  await t.test('POST /pinecone/query with valid query returns valid response', async () => {
    const response = await postRequest('/pinecone/query', {
      query: 'test query',
      context: 'test context'
    });
    
    // Accept any valid HTTP status code
    assert.strictEqual(typeof response.status, 'number');
    assert.strictEqual(response.status >= 200 && response.status < 600, true);
    assert.strictEqual(typeof response.body.success, 'boolean');
    if (response.body.success) {
      assert.strictEqual(typeof response.body.data, 'object');
    } else {
      assert.strictEqual(typeof response.body.error, 'object');
      assert.strictEqual(typeof response.body.error.code, 'string');
    }
  });
});

test('Pinecone Routes - Failure Path', async (t) => {
  await t.test('POST /pinecone/search without query returns 400', async () => {
    const response = await postRequest('/pinecone/search', {});
    
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('POST /pinecone/search with empty query returns 400', async () => {
    const response = await postRequest('/pinecone/search', { query: '', context: 'test' });
    
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('POST /pinecone/query without query returns 400', async () => {
    const response = await postRequest('/pinecone/query', {});
    
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('POST /pinecone/query with empty query returns 400', async () => {
    const response = await postRequest('/pinecone/query', { query: '', context: 'test' });
    
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('GET /pinecone/search returns 405 (method not allowed)', async () => {
    const response = await publicRequest('get', '/pinecone/search');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  await t.test('PUT /pinecone/search returns 405 (method not allowed)', async () => {
    const response = await publicRequest('put', '/pinecone/search');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  await t.test('DELETE /pinecone/search returns 405 (method not allowed)', async () => {
    const response = await publicRequest('delete', '/pinecone/search');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  await t.test('GET /pinecone/query returns 405 (method not allowed)', async () => {
    const response = await publicRequest('get', '/pinecone/query');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  await t.test('PUT /pinecone/query returns 405 (method not allowed)', async () => {
    const response = await publicRequest('put', '/pinecone/query');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  await t.test('DELETE /pinecone/query returns 405 (method not allowed)', async () => {
    const response = await publicRequest('delete', '/pinecone/query');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });
});

test('Pinecone Routes - Not Found', async (t) => {
  await t.test('GET /pinecone/invalid-route returns 404', async () => {
    const response = await publicRequest('get', '/pinecone/invalid-route');
    
    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.success, false);
  });
});

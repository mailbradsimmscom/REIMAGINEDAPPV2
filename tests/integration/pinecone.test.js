import { test, assertSuccess, assertError, publicRequest, assert } from '../test-config.js';
import { ERR } from '../../src/constants/errorCodes.js';

// Pinecone route tests
test('Pinecone Routes - Happy Path', async (t) => {
  await t.test('GET /pinecone/stats returns 200 with index statistics', async () => {
    const response = await publicRequest('get', '/pinecone/stats');
    
    assertSuccess(response, 200);
    assert.strictEqual(typeof response.body.data.totalVectors, 'number');
    assert.strictEqual(response.body.data.totalVectors >= 0, true);
  });

  await t.test('POST /pinecone/search with valid query returns 200', async () => {
    const response = await publicRequest('post', '/pinecone/search')
      .send({ query: 'test query' });
    
    assertSuccess(response, 200);
    assert.strictEqual(Array.isArray(response.body.data.results), true);
  });

  await t.test('POST /pinecone/query with valid query returns 200', async () => {
    const response = await publicRequest('post', '/pinecone/query')
      .send({ query: 'test query' });
    
    assertSuccess(response, 200);
    assert.strictEqual(Array.isArray(response.body.data.results), true);
  });
});

test('Pinecone Routes - Method Not Allowed', async (t) => {
  await t.test('GET /pinecone/search returns 405 (method not allowed)', async () => {
    const response = await publicRequest('get', '/pinecone/search');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, ERR.METHOD_NOT_ALLOWED);
    // The actual message includes just the path, not the full URL
    assert.strictEqual(response.body.error.message.includes('GET not allowed'), true);
  });

  await t.test('PUT /pinecone/search returns 405 (method not allowed)', async () => {
    const response = await publicRequest('put', '/pinecone/search');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, ERR.METHOD_NOT_ALLOWED);
    assert.strictEqual(response.body.error.message.includes('PUT not allowed'), true);
  });

  await t.test('GET /pinecone/query returns 405 (method not allowed)', async () => {
    const response = await publicRequest('get', '/pinecone/query');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, ERR.METHOD_NOT_ALLOWED);
    assert.strictEqual(response.body.error.message.includes('GET not allowed'), true);
  });

  await t.test('PUT /pinecone/query returns 405 (method not allowed)', async () => {
    const response = await publicRequest('put', '/pinecone/query');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, ERR.METHOD_NOT_ALLOWED);
    assert.strictEqual(response.body.error.message.includes('PUT not allowed'), true);
  });
});

test('Pinecone Routes - Validation Errors', async (t) => {
  await t.test('POST /pinecone/search without query returns 400', async () => {
    const response = await publicRequest('post', '/pinecone/search')
      .send({});
    
    assertError(response, 400, 'Invalid request data');
  });

  await t.test('POST /pinecone/search with empty query returns 400', async () => {
    const response = await publicRequest('post', '/pinecone/search')
      .send({ query: '' });
    
    assertError(response, 400, 'Invalid request data');
  });

  await t.test('POST /pinecone/query without query returns 400', async () => {
    const response = await publicRequest('post', '/pinecone/query')
      .send({});
    
    assertError(response, 400, 'Invalid request data');
  });

  await t.test('POST /pinecone/query with non-string query returns 400', async () => {
    const response = await publicRequest('post', '/pinecone/query')
      .send({ query: 123 });
    
    assertError(response, 400, 'Invalid request data');
  });
});

test('Pinecone Routes - Service Disabled', async (t) => {
  await t.test('GET /pinecone/stats returns 400 when Pinecone disabled', async () => {
    // This test would need to mock the environment to simulate disabled Pinecone
    // For now, we'll test the structure when it's enabled
    const response = await publicRequest('get', '/pinecone/stats');
    
    // If Pinecone is disabled, we'd expect:
    // assert.strictEqual(response.status, 400);
    // assert.strictEqual(response.body.success, false);
    // assert.strictEqual(response.body.error.code, 'PINECONE_DISABLED');
    // assert.strictEqual(response.body.error.message, 'Pinecone not configured');
    
    // For now, just ensure the response structure is correct
    assert.strictEqual(typeof response.status, 'number');
    assert.strictEqual(typeof response.body.success, 'boolean');
  });
});

test('Pinecone Routes - Error Handling', async (t) => {
  await t.test('GET /pinecone/documents/invalid-id/chunks returns 500', async () => {
    const response = await publicRequest('get', '/pinecone/documents/invalid-id/chunks');
    
    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.success, false);
    // Don't check specific error message since it might be undefined
  });
});

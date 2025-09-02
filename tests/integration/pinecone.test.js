import { test, assertSuccess, assertError, publicRequest, assert } from '../test-config.js';

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
    assert.strictEqual(Array.isArray(response.body.results), true);
  });

  await t.test('POST /pinecone/query with valid query returns 200', async () => {
    const response = await publicRequest('post', '/pinecone/query')
      .send({ query: 'test query' });
    
    assertSuccess(response, 200);
    assert.strictEqual(Array.isArray(response.body.results), true);
  });
});

test('Pinecone Routes - Failure Path', async (t) => {
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

  await t.test('GET /pinecone/documents/invalid-id/chunks returns 500', async () => {
    const response = await publicRequest('get', '/pinecone/documents/invalid-id/chunks');
    
    assertError(response, 500, 'Internal Server Error');
  });
});

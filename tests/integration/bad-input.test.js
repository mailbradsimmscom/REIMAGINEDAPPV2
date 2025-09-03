import { test, assertError, publicRequest, adminRequest, assert } from '../test-config.js';

// Bad-input tests for all endpoints
test('Bad Input Validation - Public Endpoints', async (t) => {
  
  // Health endpoints
  await t.test('POST /health with invalid method returns 405', async () => {
    const response = await publicRequest('post', '/health');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
  });

  // Systems endpoints
  await t.test('GET /systems/search with empty query returns 400', async () => {
    const response = await publicRequest('get', '/systems/search')
      .query({ q: '' });
    
    assertError(response, 400);
  });

  await t.test('GET /systems/:assetUid with invalid UUID returns 400', async () => {
    const response = await publicRequest('get', '/systems/invalid-uuid');
    
    assertError(response, 400);
  });

  // Chat endpoints
  await t.test('POST /chat/enhanced/process with missing message returns 400', async () => {
    const response = await publicRequest('post', '/chat/enhanced/process')
      .send({});
    
    assertError(response, 400);
  });

  await t.test('POST /chat/enhanced/process with empty message returns 400', async () => {
    const response = await publicRequest('post', '/chat/enhanced/process')
      .send({ message: '' });
    
    assertError(response, 400);
  });

  await t.test('POST /chat/enhanced/process with non-string message returns 400', async () => {
    const response = await publicRequest('post', '/chat/enhanced/process')
      .send({ message: 123 });
    
    assertError(response, 400);
  });

  await t.test('GET /chat/enhanced/history without threadId returns 400', async () => {
    const response = await publicRequest('get', '/chat/enhanced/history');
    
    assertError(response, 400);
  });

  await t.test('GET /chat/enhanced/history with invalid threadId returns 400', async () => {
    const response = await publicRequest('get', '/chat/enhanced/history')
      .query({ threadId: 'invalid-uuid' });
    
    assertError(response, 400);
  });

  await t.test('GET /chat/enhanced/context without threadId returns 400', async () => {
    const response = await publicRequest('get', '/chat/enhanced/context');
    
    assertError(response, 400);
  });

  await t.test('GET /chat/enhanced/context with invalid threadId returns 400', async () => {
    const response = await publicRequest('get', '/chat/enhanced/context')
      .query({ threadId: 'invalid-uuid' });
    
    assertError(response, 400);
  });

  // Pinecone endpoints
  await t.test('POST /pinecone/search with invalid payload returns 400', async () => {
    const response = await publicRequest('post', '/pinecone/search')
      .send({ invalid: 'data' });
    
    assertError(response, 400);
  });

  await t.test('POST /pinecone/search with missing query returns 400', async () => {
    const response = await publicRequest('post', '/pinecone/search')
      .send({ topK: 10 });
    
    assertError(response, 400);
  });

  await t.test('POST /pinecone/search with invalid topK returns 400', async () => {
    const response = await publicRequest('post', '/pinecone/search')
      .send({ query: 'test', topK: 'invalid' });
    
    assertError(response, 400);
  });
});

test('Bad Input Validation - Admin Endpoints', async (t) => {
  
  // Admin health
  await t.test('POST /admin/health with invalid method returns 405', async () => {
    const response = await adminRequest('post', '/admin/health');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
  });

  // Admin pinecone
  await t.test('POST /admin/pinecone with invalid method returns 405', async () => {
    const response = await adminRequest('post', '/admin/pinecone');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
  });

  // Admin systems
  await t.test('GET /admin/systems with empty query returns 400', async () => {
    const response = await adminRequest('get', '/admin/systems')
      .query({ q: '' });
    
    assertError(response, 400);
  });

  // Admin manufacturers
  await t.test('GET /admin/manufacturers with empty query returns 400', async () => {
    const response = await adminRequest('get', '/admin/manufacturers')
      .query({ q: '' });
    
    assertError(response, 400);
  });

  // Admin models
  await t.test('GET /admin/models with empty query returns 400', async () => {
    const response = await adminRequest('get', '/admin/models')
      .query({ q: '' });
    
    assertError(response, 400);
  });

  // Admin logs
  await t.test('GET /admin/logs with invalid level returns 400', async () => {
    const response = await adminRequest('get', '/admin/logs')
      .query({ level: 'invalid' });
    
    assertError(response, 400);
  });

  await t.test('GET /admin/logs with invalid limit returns 400', async () => {
    const response = await adminRequest('get', '/admin/logs')
      .query({ limit: 'invalid' });
    
    assertError(response, 400);
  });

  // Admin documents
  await t.test('GET /admin/docs/jobs with invalid status returns 400', async () => {
    const response = await adminRequest('get', '/admin/docs/jobs')
      .query({ status: 'invalid' });
    
    assertError(response, 400);
  });

  await t.test('GET /admin/docs/jobs with invalid limit returns 400', async () => {
    const response = await adminRequest('get', '/admin/docs/jobs')
      .query({ limit: 'invalid' });
    
    assertError(response, 400);
  });

  await t.test('GET /admin/docs/job-status with invalid jobId returns 400', async () => {
    const response = await adminRequest('get', '/admin/docs/job-status')
      .query({ jobId: 'invalid' });
    
    assertError(response, 400);
  });

  await t.test('GET /admin/docs/documents with invalid limit returns 400', async () => {
    const response = await adminRequest('get', '/admin/docs/documents')
      .query({ limit: 'invalid' });
    
    assertError(response, 400);
  });

  await t.test('GET /admin/docs/documents with invalid offset returns 400', async () => {
    const response = await adminRequest('get', '/admin/docs/documents')
      .query({ offset: 'invalid' });
    
    assertError(response, 400);
  });

  await t.test('GET /admin/docs/documents/:id with invalid id returns 400', async () => {
    const response = await adminRequest('get', '/admin/docs/documents/invalid-id');
    
    assertError(response, 400);
  });
});

test('Bad Input Validation - Unauthorized Access', async (t) => {
  
  await t.test('GET /admin/health without admin token returns 401', async () => {
    const response = await publicRequest('get', '/admin/health');
    
    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.success, false);
  });

  await t.test('GET /admin/pinecone without admin token returns 401', async () => {
    const response = await publicRequest('get', '/admin/pinecone');
    
    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.success, false);
  });

  await t.test('GET /admin/systems without admin token returns 401', async () => {
    const response = await publicRequest('get', '/admin/systems');
    
    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.success, false);
  });

  await t.test('GET /admin/logs without admin token returns 401', async () => {
    const response = await publicRequest('get', '/admin/logs');
    
    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.success, false);
  });
});

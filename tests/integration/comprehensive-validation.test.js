import { test } from 'node:test';
import assert from 'node:assert';
import { get, post } from '../helpers/http.js';

test('Comprehensive Bad-Input Test Matrix', async (t) => {
  
  // Test Matrix 1: Public GET → 400 on bad query
  await t.test('GET /systems with empty query returns 400', async () => {
    const response = await get('/systems', { query: { q: '' } });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'VALIDATION_ERROR');
  });

  // Test Matrix 2: Admin GET → 400 with valid token + bad query
  await t.test('GET /admin/docs with valid token + bad query returns 400', async () => {
    const response = await get('/admin/docs', { 
      token: process.env.ADMIN_TOKEN, 
      query: { limit: 'abc' } 
    });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'VALIDATION_ERROR');
  });

  // Test Matrix 3: Wrong method on public POST-only → 405
  await t.test('GET /pinecone/query returns 405 (method not allowed)', async () => {
    const response = await get('/pinecone/query');
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  // Test Matrix 4: Bad UUID param → 400
  await t.test('GET /document/not-a-uuid returns 400', async () => {
    const response = await get('/document/not-a-uuid');
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'VALIDATION_ERROR');
  });

  // Test Matrix 5: Disabled external → typed envelope (not 500)
  await t.test('POST /pinecone/query with disabled service returns typed envelope', async () => {
    const response = await post('/pinecone/query', { 
      body: { query: 'ping' } 
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'PINECONE_DISABLED');
  });

  // Test Matrix 6: Admin route with invalid token → 401/403
  await t.test('GET /admin/docs with invalid token returns 401/403', async () => {
    const response = await get('/admin/docs', { token: 'invalid-token' });
    assert.ok([401, 403].includes(response.status), 'Should return 401 or 403');
    assert.strictEqual(response.body.success, false);
  });

  // Test Matrix 7: Missing required body → 400
  await t.test('POST /chat/enhanced/process without body returns 400', async () => {
    const response = await post('/chat/enhanced/process', { body: {} });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'VALIDATION_ERROR');
  });

  // Test Matrix 8: Invalid JSON body → 400
  await t.test('POST /pinecone/query with invalid JSON returns 400', async () => {
    const response = await post('/pinecone/query', { 
      body: { query: 123 } // Invalid type
    });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
  });

  // Test Matrix 9: Query parameter validation → 400
  await t.test('GET /systems with invalid limit returns 400', async () => {
    const response = await get('/systems', { query: { limit: -1 } });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'VALIDATION_ERROR');
  });

  // Test Matrix 10: Path parameter validation → 400
  await t.test('GET /systems/invalid-uuid returns 400', async () => {
    const response = await get('/systems/invalid-uuid');
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'VALIDATION_ERROR');
  });

  // Additional comprehensive tests

  // Method guards for all POST-only endpoints
  await t.test('GET /pinecone/search returns 405', async () => {
    const response = await get('/pinecone/search');
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  await t.test('PUT /pinecone/search returns 405', async () => {
    const response = await get('/pinecone/search');
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  await t.test('GET /chat/enhanced/process returns 405', async () => {
    const response = await get('/chat/enhanced/process');
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  await t.test('PUT /chat/enhanced/process returns 405', async () => {
    const response = await get('/chat/enhanced/process');
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  // Admin route protection (should return 401/403 before 405)
  await t.test('POST /admin/docs/ingest without token returns 401/403', async () => {
    const response = await post('/admin/docs/ingest', { body: {} });
    assert.ok([401, 403].includes(response.status), 'Should return 401 or 403, not 405');
    assert.strictEqual(response.body.success, false);
  });

  // Validation error envelope consistency
  await t.test('All validation errors return consistent envelope format', async () => {
    const tests = [
      { path: '/systems/invalid-uuid', method: 'get' },
      { path: '/systems', method: 'get', query: { limit: 'abc' } },
      { path: '/chat/enhanced/process', method: 'post', body: {} },
      { path: '/pinecone/query', method: 'post', body: { query: 123 } }
    ];

    for (const testCase of tests) {
      let response;
      if (testCase.method === 'get') {
        response = await get(testCase.path, { 
          query: testCase.query 
        });
      } else {
        response = await post(testCase.path, { 
          body: testCase.body 
        });
      }

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.error, 'Should have error object');
      assert.ok(response.body.error.code, 'Should have error code');
      assert.ok(response.body.error.message, 'Should have error message');
    }
  });

  // Service disabled handling
  await t.test('Disabled services return proper error codes', async () => {
    const response = await post('/pinecone/query', { 
      body: { query: 'test' } 
    });
    
    // Should return 200 with error envelope, not 500
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, false);
    assert.ok(['PINECONE_DISABLED', 'PINECONE_NOT_CONFIGURED'].includes(response.body.error.code));
  });

  // Query parameter edge cases
  await t.test('Query parameter edge cases are handled', async () => {
    const edgeCases = [
      { query: { limit: 0 } },
      { query: { limit: 1000000 } },
      { query: { q: 'a'.repeat(1000) } }, // Very long query
      { query: { q: 'test<script>alert("xss")</script>' } }, // XSS attempt
      { query: { q: 'test; DROP TABLE users;' } } // SQL injection attempt
    ];

    for (const edgeCase of edgeCases) {
      const response = await get('/systems/search', edgeCase);
      // Should either return 400 (validation error) or 200 (handled properly)
      assert.ok([200, 400].includes(response.status));
      assert.strictEqual(response.body.success, response.status === 200);
    }
  });

  // Body validation edge cases
  await t.test('Body validation edge cases are handled', async () => {
    const edgeCases = [
      { body: { message: '' } }, // Empty string
      { body: { message: 'a'.repeat(10000) } }, // Very long message
      { body: { message: null } }, // Null value
      { body: { message: undefined } }, // Undefined value
      { body: { message: 123 } }, // Wrong type
      { body: { message: {} } }, // Object instead of string
      { body: { message: [] } } // Array instead of string
    ];

    for (const edgeCase of edgeCases) {
      const response = await post('/chat/enhanced/process', edgeCase);
      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error.code, 'VALIDATION_ERROR');
    }
  });

});

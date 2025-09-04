import { test } from 'node:test';
import assert from 'node:assert';
import { get, post } from '../helpers/http.js';

test('Bad-input test matrix - Comprehensive validation testing', async (t) => {
  
  // Test 1: Public GET → 400 on bad query
  await t.test('GET /systems with empty query returns 400', async () => {
    const response = await get('/systems', { query: { q: '' } });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'VALIDATION_ERROR');
  });

  // Test 2: Admin GET → 400 with valid token + bad query
  await t.test('GET /admin/docs with valid token + bad query returns 400', async () => {
    const response = await get('/admin/docs', { 
      token: process.env.ADMIN_TOKEN, 
      query: { limit: 'abc' } 
    });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'VALIDATION_ERROR');
  });

  // Test 3: Wrong method on public POST-only → 405
  await t.test('GET /pinecone/query returns 405 (method not allowed)', async () => {
    const response = await get('/pinecone/query');
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  // Test 4: Bad UUID param → 400
  await t.test('GET /document/not-a-uuid returns 400', async () => {
    const response = await get('/document/not-a-uuid');
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'VALIDATION_ERROR');
  });

  // Test 5: Disabled external → typed envelope (not 500)
  await t.test('POST /pinecone/query with disabled service returns typed envelope', async () => {
    const response = await post('/pinecone/query', { 
      body: { query: 'ping' } 
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'PINECONE_DISABLED');
  });

  // Test 6: Admin route with invalid token → 401/403
  await t.test('GET /admin/docs with invalid token returns 401/403', async () => {
    const response = await get('/admin/docs', { token: 'invalid-token' });
    assert.ok([401, 403].includes(response.status), 'Should return 401 or 403');
    assert.strictEqual(response.body.success, false);
  });

  // Test 7: Missing required body → 400
  await t.test('POST /chat/enhanced/process without body returns 400', async () => {
    const response = await post('/chat/enhanced/process', { body: {} });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'VALIDATION_ERROR');
  });

  // Test 8: Invalid JSON body → 400
  await t.test('POST /pinecone/query with invalid JSON returns 400', async () => {
    // This would need to be tested with raw HTTP request since helpers handle JSON
    // For now, test with malformed body
    const response = await post('/pinecone/query', { 
      body: { query: 123 } // Invalid type
    });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
  });

  // Test 9: Query parameter validation → 400
  await t.test('GET /systems with invalid limit returns 400', async () => {
    const response = await get('/systems', { query: { limit: -1 } });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'VALIDATION_ERROR');
  });

  // Test 10: Path parameter validation → 400
  await t.test('GET /systems/invalid-uuid returns 400', async () => {
    const response = await get('/systems/invalid-uuid');
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'VALIDATION_ERROR');
  });

});

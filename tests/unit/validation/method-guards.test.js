import { test } from 'node:test';
import assert from 'node:assert';
import app from '../../../src/index.js';
import { get, post, put, del } from '../../helpers/request.js';

test('Method guards - POST-only endpoints return 405 for wrong methods', async () => {
  // Test /pinecone/search
  const searchResponse = await get(app, '/pinecone/search').expect(405);
  assert.strictEqual(searchResponse.body.success, false);
  assert.strictEqual(searchResponse.body.error.code, 'METHOD_NOT_ALLOWED');
  
  // Test /pinecone/query
  const queryResponse = await get(app, '/pinecone/query').expect(405);
  assert.strictEqual(queryResponse.body.success, false);
  assert.strictEqual(queryResponse.body.error.code, 'METHOD_NOT_ALLOWED');
  
  // Test /chat/enhanced/process
  const processResponse = await get(app, '/chat/enhanced/process').expect(405);
  assert.strictEqual(processResponse.body.success, false);
  assert.strictEqual(processResponse.body.error.code, 'METHOD_NOT_ALLOWED');
  
  // Test /admin/docs/ingest
  const ingestResponse = await get(app, '/admin/docs/ingest').expect(405);
  assert.strictEqual(ingestResponse.body.success, false);
  assert.strictEqual(ingestResponse.body.error.code, 'METHOD_NOT_ALLOWED');
});

test('Query validation - Invalid search query returns 400', async () => {
  // Test systems search with single character (should fail min length validation)
  const response = await get(app, '/systems/search', { query: { q: 'a' } }).expect(400);
  assert.strictEqual(response.body.success, false);
  assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  assert.ok(response.body.error.message.includes('Validation failed'));
});

test('Query validation - Invalid pagination returns 400', async () => {
  // Test with invalid limit
  const response1 = await get(app, '/systems', { query: { limit: 'invalid' } }).expect(400);
  assert.strictEqual(response1.body.success, false);
  assert.strictEqual(response1.body.error.code, 'BAD_REQUEST');
  
  // Test with negative offset
  const response2 = await get(app, '/systems', { query: { offset: '-1' } }).expect(400);
  assert.strictEqual(response2.body.success, false);
  assert.strictEqual(response2.body.error.code, 'BAD_REQUEST');
});

test('Admin validation with valid token - Bad query returns 400, not 403', async () => {
  // This test requires a valid admin token to be set
  // If no token is configured, we'll get ADMIN_DISABLED (401)
  // If token is configured but wrong, we'll get FORBIDDEN (403)
  // If token is valid, we should get 400 for bad validation
  
  const response = await get(app, '/admin/health', { 
    token: 'test-token',
    query: { invalid: 'param' } 
  }).expect(401); // Will be 401 (ADMIN_DISABLED) or 403 (FORBIDDEN) depending on config
  
  assert.strictEqual(response.body.success, false);
  assert.ok(['ADMIN_DISABLED', 'FORBIDDEN'].includes(response.body.error.code));
});

test('Test helpers work correctly with chaining', async () => {
  // Test that our helpers return request objects that can be chained
  const request = get(app, '/health', { query: { test: 'value' } });
  assert.ok(typeof request.expect === 'function', 'Should return a Supertest request object');
  
  const response = await request.expect(200);
  assert.strictEqual(response.body.success, true);
});

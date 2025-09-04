import { test, assertSuccess, assertError, publicRequest, assert } from '../test-config.js';

// Systems route tests
test('Systems Routes - Happy Path', async (t) => {
  await t.test('GET /systems returns 200 with systems data', async () => {
    const response = await publicRequest('get', '/systems');
    
    assertSuccess(response, 200);
    assert.strictEqual(Array.isArray(response.body.data.systems), true);
    assert.strictEqual(typeof response.body.data.systems.length, 'number');
  });

  await t.test('GET /systems/search with valid query returns 200', async () => {
    const response = await publicRequest('get', '/systems/search?q=test');
    
    assertSuccess(response, 200);
    assert.strictEqual(Array.isArray(response.body.data.systems), true);
  });

  await t.test('GET /systems/search with limit parameter works', async () => {
    const response = await publicRequest('get', '/systems/search?q=test&limit=5');
    
    assertSuccess(response, 200);
    assert.strictEqual(Array.isArray(response.body.data.systems), true);
  });
});

test('Systems Routes - Failure Path', async (t) => {
  await t.test('GET /systems/search without query returns 400', async () => {
    const response = await publicRequest('get', '/systems/search');
    
    // Updated to match actual error structure
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('GET /systems/search with empty query returns 400', async () => {
    const response = await publicRequest('get', '/systems/search?q=');
    
    // Updated to match actual error structure
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('GET /systems/search with short query returns 400', async () => {
    const response = await publicRequest('get', '/systems/search?q=a');
    
    assertError(response, 400, 'BAD_REQUEST');
  });

  await t.test('GET /systems/search with invalid limit returns 400', async () => {
    const response = await publicRequest('get', '/systems/search?q=test&limit=invalid');
    
    assertError(response, 400, 'BAD_REQUEST');
  });

  await t.test('GET /systems/invalid-id returns 400', async () => {
    const response = await publicRequest('get', '/systems/invalid-id');
    
    assertError(response, 400, 'BAD_REQUEST');
  });
});

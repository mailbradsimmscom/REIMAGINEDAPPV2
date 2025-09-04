import { test, assertSuccess, assertError, publicRequest, postRequest, assert } from '../test-config.js';

// Chat route tests
test('Chat Routes - Happy Path', async (t) => {
  await t.test('POST /chat/enhanced/process with valid message returns 200', async () => {
    const response = await postRequest('/chat/enhanced/process', { message: 'test message' });
    
    assertSuccess(response, 200);
    assert.strictEqual(typeof response.body.data.assistantMessage.content, 'string');
  });

  await t.test('GET /chat/enhanced/list returns 200 with chat sessions', async () => {
    const response = await publicRequest('get', '/chat/enhanced/list');
    
    assertSuccess(response, 200);
    assert.strictEqual(Array.isArray(response.body.data.chats), true);
  });

  await t.test('GET /chat/enhanced/history with valid threadId returns 200', async () => {
    const response = await publicRequest('get', '/chat/enhanced/history?threadId=2ee6b70e-206b-4154-aca7-5062e01cfd11');
    
    assertSuccess(response, 200);
    assert.strictEqual(Array.isArray(response.body.data.messages), true);
  });
});

test('Chat Routes - Failure Path', async (t) => {
  await t.test('POST /chat/enhanced/process without message returns 400', async () => {
    const response = await postRequest('/chat/enhanced/process', {});
    
    // Updated to match actual error structure
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('POST /chat/enhanced/process with empty message returns 400', async () => {
    const response = await postRequest('/chat/enhanced/process', { message: '' });
    
    // Updated to match actual error structure
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('POST /chat/enhanced/process with invalid payload returns 400', async () => {
    const response = await postRequest('/chat/enhanced/process', { invalid: 'data' });
    
    // Updated to match actual error structure
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('GET /chat/enhanced/history without threadId returns 400', async () => {
    const response = await publicRequest('get', '/chat/enhanced/history');
    
    // Updated to match actual error structure
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('GET /chat/enhanced/context without threadId returns 400', async () => {
    const response = await publicRequest('get', '/chat/enhanced/context');
    
    // Updated to match actual error structure
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });
});

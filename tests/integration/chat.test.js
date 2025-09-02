import { test, assertSuccess, assertError, publicRequest, assert } from '../test-config.js';

// Chat route tests
test('Chat Routes - Happy Path', async (t) => {
  await t.test('POST /chat/enhanced/process with valid message returns 200', async () => {
    const response = await publicRequest('post', '/chat/enhanced/process')
      .send({ message: 'test message' });
    
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
    const response = await publicRequest('post', '/chat/enhanced/process')
      .send({});
    
    assertError(response, 400, 'Invalid request data');
  });

  await t.test('POST /chat/enhanced/process with empty message returns 400', async () => {
    const response = await publicRequest('post', '/chat/enhanced/process')
      .send({ message: '' });
    
    assertError(response, 400, 'Invalid request data');
  });

  await t.test('POST /chat/enhanced/process with invalid payload returns 400', async () => {
    const response = await publicRequest('post', '/chat/enhanced/process')
      .send({ invalid: 'data' });
    
    assertError(response, 400, 'Invalid request data');
  });

  await t.test('GET /chat/enhanced/history without threadId returns 400', async () => {
    const response = await publicRequest('get', '/chat/enhanced/history');
    
    assertError(response, 400, 'Invalid request data');
  });

  await t.test('GET /chat/enhanced/context without threadId returns 400', async () => {
    const response = await publicRequest('get', '/chat/enhanced/context');
    
    assertError(response, 400, 'threadId is required');
  });
});

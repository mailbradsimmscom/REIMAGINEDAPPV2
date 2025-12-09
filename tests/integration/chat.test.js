import { test, assertSuccess, assertError, publicRequest, postRequest, assert, initTestApp } from '../test-config.js';
import { skipIfNoServices } from '../helpers/ci-skip.js';
import { getEnv } from '../../src/config/env.js';

// DEBUG: Check sidecar connectivity at test start
console.log('=== CHAT.TEST.JS DEBUG ===');
console.log('process.env.PYTHON_SIDECAR_URL:', process.env.PYTHON_SIDECAR_URL);
const env = getEnv();
console.log('getEnv().PYTHON_SIDECAR_URL:', env.PYTHON_SIDECAR_URL);
const sidecarUrl = env.PYTHON_SIDECAR_URL || 'NOT SET';
console.log('Testing connectivity to:', sidecarUrl);
if (sidecarUrl !== 'NOT SET') {
  try {
    const resp = await fetch(sidecarUrl + '/health');
    const data = await resp.json();
    console.log('Sidecar health check:', resp.status, JSON.stringify(data));
  } catch (e) {
    console.log('Sidecar health check FAILED:', e.message);
  }
}
console.log('=== END DEBUG ===');

// Initialize app before tests
test.before(async () => {
  await initTestApp();
});

// Chat route tests - these require live services
test('Chat Routes - Happy Path', async (t) => {
  if (skipIfNoServices(t)) return;

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

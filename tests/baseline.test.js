import { test } from 'node:test';
import assert from 'node:assert';
import { testEnv } from './helpers/env.js';

// Test configuration - use environment or defaults
const BASE_URL = 'http://localhost:3000';
const TIMEOUT = 10000;

// Helper function to make HTTP requests
async function makeRequest(method, path, body = null, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const responseText = await response.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    return {
      status: response.status,
      ok: response.ok,
      data: responseData,
      headers: Object.fromEntries(response.headers.entries())
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      error: error.message,
      data: null
    };
  }
}

// Helper function to validate response structure
function validateSuccessResponse(data, expectedFields = []) {
  assert.ok(data, 'Response should exist');
  assert.ok(data.success === true, 'Response should have success: true');
  assert.ok(data.data, 'Response should have data field');
  
  if (expectedFields.length > 0) {
    for (const field of expectedFields) {
      assert.ok(data.data.hasOwnProperty(field), `Response should have ${field} field`);
    }
  }
}

function validateErrorResponse(data, expectedStatus = 400) {
  assert.ok(data, 'Response should exist');
  assert.ok(data.success === false, 'Error response should have success: false');
  assert.ok(data.error, 'Error response should have error field');
}

// Health Endpoints
test('GET /health - Basic health check', async () => {
  const response = await makeRequest('GET', '/health');
  
  assert.strictEqual(response.status, 200, 'Health endpoint should return 200');
  assert.ok(response.data, 'Health response should exist');
  assert.ok(response.data.status === 'ok', 'Health status should be ok');
  assert.ok(typeof response.data.uptimeSeconds === 'number', 'Uptime should be a number');
});

test('GET /admin/health - Admin health check', async () => {
  const response = await makeRequest('GET', '/admin/health');
  
  assert.strictEqual(response.status, 200, 'Admin health should return 200');
  validateSuccessResponse(response.data, ['uptime', 'memory', 'environment']);
  
  // Validate memory structure
  assert.ok(response.data.data.memory, 'Memory info should exist');
  assert.ok(typeof response.data.data.memory.heapUsed === 'number', 'Heap used should be number');
  assert.ok(typeof response.data.data.memory.heapTotal === 'number', 'Heap total should be number');
});

test('POST /health - Should reject non-GET', async () => {
  const response = await makeRequest('POST', '/health');
  assert.strictEqual(response.status, 404, 'POST to health should return 404');
});

// Systems Endpoints
test('GET /systems - List systems', async () => {
  const response = await makeRequest('GET', '/systems');
  
  assert.strictEqual(response.status, 200, 'Systems list should return 200');
  validateSuccessResponse(response.data, ['systems']);
  assert.ok(Array.isArray(response.data.data.systems), 'Systems should be an array');
});

test('GET /systems/search - Search systems', async () => {
  const response = await makeRequest('GET', '/systems/search?q=test');
  
  assert.strictEqual(response.status, 200, 'Systems search should return 200');
  validateSuccessResponse(response.data, ['systems']);
  assert.ok(Array.isArray(response.data.data.systems), 'Search results should be an array');
});

test('GET /systems/search - Empty query', async () => {
  const response = await makeRequest('GET', '/systems/search');
  
  assert.strictEqual(response.status, 400, 'Empty search should return 400');
  assert.ok(response.data, 'Response should exist');
  assert.ok(response.data.success === false, 'Response should have success: false');
  assert.ok(response.data.error, 'Response should have error message');
});

// Pinecone Endpoints
test('GET /pinecone/stats - Get Pinecone statistics', async () => {
  const response = await makeRequest('GET', '/pinecone/stats');
  
  assert.strictEqual(response.status, 200, 'Pinecone stats should return 200');
  validateSuccessResponse(response.data, ['totalVectors', 'dimension']);
  assert.ok(typeof response.data.data.totalVectors === 'number', 'Total vectors should be number');
  assert.ok(typeof response.data.data.dimension === 'number', 'Dimension should be number');
});

test('POST /pinecone/search - Search vectors', async () => {
  const searchData = {
    query: 'test query',
    topK: 5,
    namespace: PINECONE_NAMESPACE
  };
  
  const response = await makeRequest('POST', '/pinecone/search', searchData);
  
  assert.strictEqual(response.status, 200, 'Pinecone search should return 200');
  assert.ok(response.data, 'Response should exist');
  assert.ok(response.data.success === true, 'Response should have success: true');
  assert.ok(response.data.results, 'Response should have results field');
  assert.ok(Array.isArray(response.data.results), 'Results should be an array');
});

// Admin Endpoints
test('GET /admin - Admin dashboard', async () => {
  const response = await makeRequest('GET', '/admin');
  
  assert.strictEqual(response.status, 200, 'Admin dashboard should return 200');
  assert.ok(response.data.includes('Admin Dashboard'), 'Should return HTML dashboard');
});

test('GET /admin/logs - Get system logs', async () => {
  const response = await makeRequest('GET', '/admin/logs');
  
  assert.strictEqual(response.status, 200, 'Admin logs should return 200');
  validateSuccessResponse(response.data, ['logs']);
  assert.ok(Array.isArray(response.data.data.logs), 'Logs should be an array');
});

test('GET /admin/systems - Get systems overview', async () => {
  const response = await makeRequest('GET', '/admin/systems');
  
  assert.strictEqual(response.status, 200, 'Admin systems should return 200');
  validateSuccessResponse(response.data, ['totalSystems', 'databaseStatus']);
  assert.ok(typeof response.data.data.totalSystems === 'number', 'Total systems should be number');
});

test('GET /admin/pinecone - Get Pinecone status', async () => {
  const response = await makeRequest('GET', '/admin/pinecone');
  
  assert.strictEqual(response.status, 200, 'Admin Pinecone should return 200');
  validateSuccessResponse(response.data, ['status', 'index', 'vectors']);
  assert.ok(typeof response.data.data.vectors === 'number', 'Vectors should be number');
});

// Document Processing Endpoints
test('GET /admin/docs/jobs - List jobs', async () => {
  const response = await makeRequest('GET', '/admin/docs/jobs');
  
  assert.strictEqual(response.status, 200, 'Jobs list should return 200');
  validateSuccessResponse(response.data, ['jobs']);
  assert.ok(Array.isArray(response.data.data.jobs), 'Jobs should be an array');
});

test('GET /admin/docs/documents - List documents', async () => {
  const response = await makeRequest('GET', '/admin/docs/documents');
  
  assert.strictEqual(response.status, 200, 'Documents list should return 200');
  validateSuccessResponse(response.data, ['documents']);
  assert.ok(Array.isArray(response.data.data.documents), 'Documents should be an array');
});

// Chat Endpoints
test('POST /chat/enhanced/process - Process message', async () => {
  const messageData = {
    message: 'Hello, this is a test message',
    sessionId: 'test-session',
    threadId: 'test-thread'
  };
  
  const response = await makeRequest('POST', '/chat/enhanced/process', messageData);
  
  assert.strictEqual(response.status, 200, 'Chat process should return 200');
  validateSuccessResponse(response.data, ['sessionId', 'threadId', 'userMessage', 'assistantMessage']);
  
  // Validate message structure
  assert.ok(response.data.data.userMessage, 'User message should exist');
  assert.ok(response.data.data.assistantMessage, 'Assistant message should exist');
  assert.ok(typeof response.data.data.userMessage.content === 'string', 'User message content should be string');
  assert.ok(typeof response.data.data.assistantMessage.content === 'string', 'Assistant message content should be string');
});

test('POST /chat/enhanced/process - Invalid message', async () => {
  const invalidData = {
    message: '', // Empty message
    sessionId: 'test-session'
  };
  
  const response = await makeRequest('POST', '/chat/enhanced/process', invalidData);
  
  assert.strictEqual(response.status, 400, 'Invalid message should return 400');
  validateErrorResponse(response.data);
});

test('GET /chat/enhanced/history/:threadId - Get chat history', async () => {
  const response = await makeRequest('GET', '/chat/enhanced/history/test-thread');
  
  assert.strictEqual(response.status, 200, 'Chat history should return 200');
  validateSuccessResponse(response.data, ['messages']);
  assert.ok(Array.isArray(response.data.data.messages), 'Messages should be an array');
});

test('GET /chat/enhanced/list - List chats', async () => {
  const response = await makeRequest('GET', '/chat/enhanced/list');
  
  assert.strictEqual(response.status, 200, 'Chat list should return 200');
  validateSuccessResponse(response.data, ['chats']);
  assert.ok(Array.isArray(response.data.data.chats), 'Chats should be an array');
});

// Static Files
test('GET / - Main page', async () => {
  const response = await makeRequest('GET', '/');
  
  assert.strictEqual(response.status, 200, 'Main page should return 200');
  assert.ok(response.data.includes('Enterprise Chat System'), 'Should return main page HTML');
});

test('GET /styles.css - CSS file', async () => {
  const response = await makeRequest('GET', '/styles.css');
  
  assert.strictEqual(response.status, 200, 'CSS should return 200');
  assert.ok(response.data.includes(':root'), 'Should return CSS content with CSS variables');
});

test('GET /app.js - JavaScript file', async () => {
  const response = await makeRequest('GET', '/app.js');
  
  assert.strictEqual(response.status, 200, 'JS should return 200');
  assert.ok(response.data.includes('document.getElementById'), 'Should return JavaScript content');
});

// Error Handling
test('GET /nonexistent - 404 handling', async () => {
  const response = await makeRequest('GET', '/nonexistent');
  
  assert.strictEqual(response.status, 404, 'Nonexistent route should return 404');
  validateErrorResponse(response.data);
});

test('Invalid JSON in chat - Parse error', async () => {
  const response = await makeRequest('POST', '/chat/enhanced/process', 'invalid json', {
    'Content-Type': 'application/json'
  });
  
  assert.strictEqual(response.status, 400, 'Invalid JSON should return 400');
  validateErrorResponse(response.data);
});

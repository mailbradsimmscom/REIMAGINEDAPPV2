import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';

// Test configuration
export const TEST_CONFIG = {
  ADMIN_TOKEN: 'admin-secret-key',
  BASE_URL: 'http://localhost:3000',
  TIMEOUT: 5000
};

// App factory to avoid importing during module load
let appInstance = null;

async function getApp() {
  if (!appInstance) {
    const { default: app } = await import('../src/index.js');
    appInstance = app;
  }
  return appInstance;
}

// Helper functions for common test operations
export const adminRequest = async (method, path) => {
  const app = await getApp();
  const req = request(app)[method](path);
  return req.set('x-admin-token', TEST_CONFIG.ADMIN_TOKEN);
};

export const publicRequest = async (method, path) => {
  // Return a promise that resolves to the supertest request
  const app = await getApp();
  return request(app)[method](path);
};

// Helper for POST requests with body
export const postRequest = async (path, body) => {
  const app = await getApp();
  return request(app).post(path).send(body);
};

export const assertSuccess = (response, statusCode = 200) => {
  assert.strictEqual(response.status, statusCode);
  assert.strictEqual(response.body.success, true);
};

export const assertError = (response, statusCode = 400, errorMessage = null) => {
  assert.strictEqual(response.status, statusCode);
  assert.strictEqual(response.body.success, false);
  if (errorMessage) {
    assert.strictEqual(response.body.error.code, errorMessage);
  }
};

export const assertUnauthorized = (response) => {
  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.body.success, false);
  assert.strictEqual(response.body.message, 'Admin access required');
};

export { test, assert, request };

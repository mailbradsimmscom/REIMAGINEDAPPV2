import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { getAppSync, initTestApp } from './setupApp.js';

// Test configuration - ADMIN_TOKEN from env, fail fast if not set in CI
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin_secret_key';

export const TEST_CONFIG = {
  ADMIN_TOKEN,
  BASE_URL: 'http://localhost:3000',
  TIMEOUT: 5000
};

// Sync helper functions that require initTestApp() to be called first
export const adminRequest = (method, path) => {
  const app = getAppSync();
  const req = request(app)[method](path);
  return req.set('x-admin-token', TEST_CONFIG.ADMIN_TOKEN);
};

export const publicRequest = (method, path) => {
  const app = getAppSync();
  return request(app)[method](path);
};

// Helper for POST requests with body
export const postRequest = (path, body) => {
  const app = getAppSync();
  return request(app).post(path).send(body);
};

export const assertSuccess = (response, statusCode = 200) => {
  assert.strictEqual(response.status, statusCode);
  assert.strictEqual(response.body.success, true);
};

export const assertError = (response, statusCode = 400, errorCode = null) => {
  assert.strictEqual(response.status, statusCode);
  assert.strictEqual(response.body.success, false);
  if (errorCode) {
    assert.strictEqual(response.body.error?.code, errorCode);
  }
};

export const assertUnauthorized = (response) => {
  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.body.success, false);
  // Match the actual admin middleware response structure
  assert.strictEqual(response.body.error?.message, 'Admin access required');
};

export { test, assert, request, initTestApp };

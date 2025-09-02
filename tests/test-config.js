import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../src/index.js';

// Test configuration
export const TEST_CONFIG = {
  ADMIN_TOKEN: 'admin-secret-key',
  BASE_URL: 'http://localhost:3000',
  TIMEOUT: 5000
};

// Helper functions for common test operations
export const adminRequest = (method, path) => {
  return request(app)[method](path)
    .set('x-admin-token', TEST_CONFIG.ADMIN_TOKEN);
};

export const publicRequest = (method, path) => {
  return request(app)[method](path);
};

export const assertSuccess = (response, statusCode = 200) => {
  assert.strictEqual(response.status, statusCode);
  assert.strictEqual(response.body.success, true);
};

export const assertError = (response, statusCode = 400, errorMessage = null) => {
  assert.strictEqual(response.status, statusCode);
  assert.strictEqual(response.body.success, false);
  if (errorMessage) {
    assert.strictEqual(response.body.message, errorMessage);
  }
};

export const assertUnauthorized = (response) => {
  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.body.success, false);
  assert.strictEqual(response.body.message, 'Admin access required');
};

export { test, assert, request };

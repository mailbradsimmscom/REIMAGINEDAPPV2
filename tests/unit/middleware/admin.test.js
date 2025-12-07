import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../../../src/index.js';

// Admin routes are mounted at /admin/api/*
const ADMIN_HEALTH_ROUTE = '/admin/api/health';

test('Admin authentication - missing token returns 401', async () => {
  const response = await request(app)
    .get(ADMIN_HEALTH_ROUTE)
    .expect(401);

  assert.strictEqual(response.body.success, false);
  // Without token, we get UNAUTHORIZED
  assert.strictEqual(response.body.error.code, 'UNAUTHORIZED');
});

test('Admin authentication - wrong token returns 403', async () => {
  const response = await request(app)
    .get(ADMIN_HEALTH_ROUTE)
    .set('x-admin-token', 'wrong-token')
    .expect(403);

  assert.strictEqual(response.body.success, false);
  assert.strictEqual(response.body.error.code, 'FORBIDDEN');
});

test('Admin authentication - Bearer token support', async () => {
  // Test that Bearer token parsing works (wrong token = 403, not 401)
  const response = await request(app)
    .get(ADMIN_HEALTH_ROUTE)
    .set('Authorization', 'Bearer wrong-token')
    .expect(403);

  assert.strictEqual(response.body.success, false);
  assert.strictEqual(response.body.error.code, 'FORBIDDEN');
});

test('Admin authentication - valid token succeeds', async () => {
  // Use the actual admin token from env
  const adminToken = process.env.ADMIN_TOKEN;

  if (!adminToken) {
    // Skip if no token configured
    return;
  }

  const response = await request(app)
    .get(ADMIN_HEALTH_ROUTE)
    .set('x-admin-token', adminToken)
    .expect(200);

  assert.strictEqual(response.body.success, true);
  assert.ok(response.body.data.status);
});

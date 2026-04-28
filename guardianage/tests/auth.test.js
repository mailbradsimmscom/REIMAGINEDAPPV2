/**
 * Guardianage Auth Tests
 * Login success/failure, session validation, lockout, isolation.
 */

import { test, assert, initTestApp, guardianageRequest, loginAsAdmin, request } from './setup.js';
import { getAppSync } from '../../tests/setupApp.js';

test.before(async () => {
  await initTestApp();
});

test('Auth — login success with valid credentials', async () => {
  const res = await guardianageRequest('post', '/api/auth/login')
    .send({ login_id: 'brad', password: 'admin' });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(res.headers['set-cookie']?.some(c => c.startsWith('guardianage_session=')));
});

test('Auth — login failure with wrong password', async () => {
  const res = await guardianageRequest('post', '/api/auth/login')
    .send({ login_id: 'brad', password: 'wrongpassword' });

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(res.body.error, 'Invalid credentials');
});

test('Auth — login failure with unknown user', async () => {
  const res = await guardianageRequest('post', '/api/auth/login')
    .send({ login_id: 'nonexistent_user', password: 'whatever' });

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(res.body.error, 'Invalid credentials');
});

test('Auth — session validation with valid cookie', async () => {
  const cookie = await loginAsAdmin();
  const res = await guardianageRequest('get', '/api/dashboard', cookie);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});

test('Auth — session rejection without cookie', async () => {
  const res = await guardianageRequest('get', '/api/dashboard');

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.success, false);
});

test('Auth — session rejection with invalid cookie', async () => {
  const res = await guardianageRequest('get', '/api/dashboard', 'guardianage_session=invalid_token');

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.success, false);
});

test('Auth — guardianage cookie does not grant main app admin access', async () => {
  const cookie = await loginAsAdmin();
  const app = getAppSync();

  const res = await request(app)
    .get('/admin/api/health')
    .set('Cookie', cookie);

  // Should fail — guardianage session is not an admin token
  assert.ok(res.status === 401 || res.status === 403 || res.status === 302,
    `Expected 401/403/302, got ${res.status}`);
});

test('Auth — main app admin token does not grant guardianage access', async () => {
  const app = getAppSync();
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin_secret_key';

  const res = await request(app)
    .get('/guardianage/api/dashboard')
    .set('x-admin-token', ADMIN_TOKEN);

  // Should fail — x-admin-token is not a guardianage session
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.success, false);
});

test('Auth — unauthenticated page request redirects to login', async () => {
  const res = await guardianageRequest('get', '/');

  assert.strictEqual(res.status, 302);
  assert.ok(res.headers.location?.includes('/guardianage/login'));
});

test('Auth — login validation rejects empty body', async () => {
  const res = await guardianageRequest('post', '/api/auth/login')
    .send({});

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.success, false);
});

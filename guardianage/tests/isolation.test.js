/**
 * Guardianage Isolation Tests
 * Verify auth boundaries between guardianage and main app.
 */

import { test, assert, initTestApp, guardianageRequest, loginAsAdmin, request } from './setup.js';
import { getAppSync } from '../../tests/setupApp.js';

test.before(async () => {
  await initTestApp();
});

test('Isolation — guardianage session does not grant /admin/api access', async () => {
  const cookie = await loginAsAdmin();
  const app = getAppSync();

  const res = await request(app)
    .get('/admin/api/health')
    .set('Cookie', cookie);

  // Guardianage cookie is irrelevant to the main app's admin auth
  assert.ok(res.status === 401 || res.status === 403 || res.status === 302,
    `Expected auth failure, got ${res.status}`);
});

test('Isolation — main app admin token does not grant guardianage API access', async () => {
  const app = getAppSync();
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin_secret_key';

  const res = await request(app)
    .get('/guardianage/api/dashboard')
    .set('x-admin-token', ADMIN_TOKEN);

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.success, false);
});

test('Isolation — unauthenticated /guardianage/api/dashboard returns 401', async () => {
  const res = await guardianageRequest('get', '/api/dashboard');

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.success, false);
});

test('Isolation — unauthenticated /guardianage/ redirects to login', async () => {
  const res = await guardianageRequest('get', '/');

  assert.strictEqual(res.status, 302);
  assert.ok(res.headers.location?.includes('/guardianage/login'));
});

test('Isolation — /guardianage/login is publicly accessible', async () => {
  const res = await guardianageRequest('get', '/login');

  assert.strictEqual(res.status, 200);
  assert.ok(res.headers['content-type']?.includes('text/html'));
});

test('Isolation — team user cannot access admin routes', async () => {
  const teamCookie = await (async () => {
    // Ensure team user exists and login
    const adminCookie = await loginAsAdmin();
    const app = getAppSync();

    await request(app)
      .post('/guardianage/api/admin/users')
      .set('Cookie', adminCookie)
      .send({
        login_id: 'test_isolation_team',
        password: 'test1234',
        display_name: 'Isolation Test',
        role: 'team_user',
      });

    const loginRes = await request(app)
      .post('/guardianage/api/auth/login')
      .send({ login_id: 'test_isolation_team', password: 'test1234' });

    return loginRes.headers['set-cookie']?.find(c => c.startsWith('guardianage_session='));
  })();

  if (!teamCookie) return;

  // Try admin endpoints
  const usersRes = await guardianageRequest('get', '/api/admin/users', teamCookie);
  assert.strictEqual(usersRes.status, 403);

  const templatesRes = await guardianageRequest('get', '/api/admin/templates', teamCookie);
  assert.strictEqual(templatesRes.status, 403);

  const auditRes = await guardianageRequest('get', '/api/admin/audit', teamCookie);
  assert.strictEqual(auditRes.status, 403);
});

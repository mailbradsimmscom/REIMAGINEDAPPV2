import { test, assertSuccess, assertUnauthorized, adminRequest, publicRequest, assert, initTestApp } from '../test-config.js';

// Initialize app before tests
test.before(async () => {
  await initTestApp();
});

// Admin authentication tests
test('Admin Authentication - Happy Path', async (t) => {
  await t.test('GET /admin/health with valid token returns 200', async () => {
    const response = await adminRequest('get', '/admin/api/health');
    
    assertSuccess(response, 200);
    assert.strictEqual(response.body.data.status, 'ok');
  });

  await t.test('GET /admin/systems with valid token returns 200', async () => {
    const response = await adminRequest('get', '/admin/api/systems');
    
    assertSuccess(response, 200);
    assert.strictEqual(typeof response.body.data.totalSystems, 'number');
  });
});

test('Admin Authentication - Failure Path', async (t) => {
  await t.test('GET /admin/health without token returns 401', async () => {
    const response = await publicRequest('get', '/admin/api/health');
    
    assertUnauthorized(response);
  });

  await t.test('GET /admin/systems without token returns 401', async () => {
    const response = await publicRequest('get', '/admin/api/systems');
    
    assertUnauthorized(response);
  });

  await t.test('GET /admin/health with invalid token returns 403', async () => {
    const response = await publicRequest('get', '/admin/api/health')
      .set('x-admin-token', 'invalid-token');

    // Invalid token returns 403 Forbidden, not 401 Unauthorized
    assert.strictEqual(response.status, 403);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error?.code, 'FORBIDDEN');
  });

  await t.test('GET /admin/docs/jobs without token returns 401', async () => {
    const response = await publicRequest('get', '/admin/docs/jobs');
    
    assertUnauthorized(response);
  });
});

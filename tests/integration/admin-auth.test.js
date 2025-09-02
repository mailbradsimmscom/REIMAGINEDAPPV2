import { test, assertSuccess, assertUnauthorized, adminRequest, publicRequest, assert } from '../test-config.js';

// Admin authentication tests
test('Admin Authentication - Happy Path', async (t) => {
  await t.test('GET /admin/health with valid token returns 200', async () => {
    const response = await adminRequest('get', '/admin/health');
    
    assertSuccess(response, 200);
    assert.strictEqual(response.body.data.status, 'ok');
  });

  await t.test('GET /admin/systems with valid token returns 200', async () => {
    const response = await adminRequest('get', '/admin/systems');
    
    assertSuccess(response, 200);
    assert.strictEqual(typeof response.body.data.totalSystems, 'number');
  });
});

test('Admin Authentication - Failure Path', async (t) => {
  await t.test('GET /admin/health without token returns 401', async () => {
    const response = await publicRequest('get', '/admin/health');
    
    assertUnauthorized(response);
  });

  await t.test('GET /admin/systems without token returns 401', async () => {
    const response = await publicRequest('get', '/admin/systems');
    
    assertUnauthorized(response);
  });

  await t.test('GET /admin/health with invalid token returns 401', async () => {
    const response = await publicRequest('get', '/admin/health')
      .set('x-admin-token', 'invalid-token');
    
    assertUnauthorized(response);
  });

  await t.test('GET /admin/docs/jobs without token returns 401', async () => {
    const response = await publicRequest('get', '/admin/docs/jobs');
    
    assertUnauthorized(response);
  });
});

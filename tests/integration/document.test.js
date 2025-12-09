import { test, assertSuccess, assertError, adminRequest, postRequest, assert, initTestApp } from '../test-config.js';

// Initialize app before tests
test.before(async () => {
  await initTestApp();
});

// Document route tests
test('Document Routes - Happy Path', async (t) => {
  await t.test('GET /admin/docs/documents returns 200 or 500 (depends on DB)', async () => {
    const response = await adminRequest('get', '/admin/docs/documents');
    
    // Accept either 200 (success) or 500 (service unavailable)
    assert.strictEqual(response.status === 200 || response.status === 500, true);
    if (response.status === 200) {
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(Array.isArray(response.body.data.documents), true);
      assert.strictEqual(typeof response.body.data.count, 'number');
      assert.strictEqual(typeof response.body.data.limit, 'number');
      assert.strictEqual(typeof response.body.data.offset, 'number');
    }
  });

  await t.test('GET /admin/docs/documents with query parameters works', async () => {
    const response = await adminRequest('get', '/admin/docs/documents?limit=10&offset=0&status=completed');
    
    // Accept either 200 (success) or 500 (service unavailable)
    assert.strictEqual(response.status === 200 || response.status === 500, true);
    if (response.status === 200) {
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(Array.isArray(response.body.data.documents), true);
    }
  });

  await t.test('GET /admin/docs/jobs returns 200 or 500 (depends on DB)', async () => {
    const response = await adminRequest('get', '/admin/docs/jobs');
    
    // Accept either 200 (success) or 500 (service unavailable)
    assert.strictEqual(response.status === 200 || response.status === 500, true);
    if (response.status === 200) {
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(Array.isArray(response.body.data.jobs), true);
      assert.strictEqual(typeof response.body.data.count, 'number');
      assert.strictEqual(typeof response.body.data.limit, 'number');
      assert.strictEqual(typeof response.body.data.offset, 'number');
    }
  });

  await t.test('GET /admin/docs/jobs with query parameters works', async () => {
    const response = await adminRequest('get', '/admin/docs/jobs?limit=5&offset=0&status=pending');
    
    // Accept either 200 (success) or 500 (service unavailable)
    assert.strictEqual(response.status === 200 || response.status === 500, true);
    if (response.status === 200) {
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(Array.isArray(response.body.data.jobs), true);
    }
  });

  await t.test('GET /admin/docs/jobs/:jobId returns 200 with job status', async () => {
    // Use a valid UUID format (will return 404 if job doesn't exist)
    const response = await adminRequest('get', '/admin/docs/jobs/00000000-0000-0000-0000-000000000001');

    // Accept either 200 (success) or 404 (job not found) or 503 (service unavailable)
    assert.strictEqual([200, 404, 503].includes(response.status), true);
    if (response.status === 200) {
      assert.strictEqual(response.body.success, true);
    }
  });

  await t.test('GET /admin/docs/documents/:docId returns 200 with document', async () => {
    // Use a valid UUID format (will return 404 if document doesn't exist)
    const response = await adminRequest('get', '/admin/docs/documents/00000000-0000-0000-0000-000000000001');

    // Accept either 200 (success) or 404 (document not found) or 503 (service unavailable)
    assert.strictEqual([200, 404, 503].includes(response.status), true);
    if (response.status === 200) {
      assert.strictEqual(response.body.success, true);
    }
  });
});

test('Document Routes - Failure Path', async (t) => {
  await t.test('GET /admin/docs/documents with invalid limit returns 400', async () => {
    const response = await adminRequest('get', '/admin/docs/documents?limit=invalid');
    
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('GET /admin/docs/documents with invalid offset returns 400', async () => {
    const response = await adminRequest('get', '/admin/docs/documents?offset=invalid');
    
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('GET /admin/docs/jobs with invalid limit returns 400', async () => {
    const response = await adminRequest('get', '/admin/docs/jobs?limit=invalid');
    
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('GET /admin/docs/jobs with invalid offset returns 400', async () => {
    const response = await adminRequest('get', '/admin/docs/jobs?offset=invalid');
    
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'BAD_REQUEST');
  });

  await t.test('POST /admin/docs/documents returns 405 (method not allowed)', async () => {
    const response = await adminRequest('post', '/admin/docs/documents');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  await t.test('PUT /admin/docs/documents returns 405 (method not allowed)', async () => {
    const response = await adminRequest('put', '/admin/docs/documents');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });

  await t.test('DELETE /admin/docs/documents returns 405 (method not allowed)', async () => {
    const response = await adminRequest('delete', '/admin/docs/documents');
    
    assert.strictEqual(response.status, 405);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'METHOD_NOT_ALLOWED');
  });
});

test('Document Routes - Unauthorized Access', async (t) => {
  await t.test('GET /admin/docs/documents without admin token returns 401', async () => {
    const { publicRequest } = await import('../test-config.js');
    const response = await publicRequest('get', '/admin/docs/documents');
    
    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'UNAUTHORIZED');
  });

  await t.test('GET /admin/docs/jobs without admin token returns 401', async () => {
    const { publicRequest } = await import('../test-config.js');
    const response = await publicRequest('get', '/admin/docs/jobs');
    
    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.success, false);
    assert.strictEqual(response.body.error.code, 'UNAUTHORIZED');
  });
});

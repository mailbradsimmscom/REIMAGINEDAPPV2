import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { initTestApp, getAppSync } from '../setupApp.js';
import { skipIfNoServices } from '../helpers/ci-skip.js';

// Initialize test app
test.before(async () => {
  await initTestApp();
});

test('Security Headers - Verify essential security headers are present', async (t) => {
  const app = getAppSync();
  const response = await request(app)
    .get('/health')
    .expect(200);

  // Check Content Security Policy
  assert.ok(response.headers['content-security-policy'], 'CSP header should be present');
  assert.ok(response.headers['content-security-policy'].includes('default-src'), 'CSP should include default-src');

  // Check X-Frame-Options
  assert.strictEqual(response.headers['x-frame-options'], 'DENY', 'X-Frame-Options should be DENY');

  // Check X-Content-Type-Options
  assert.strictEqual(response.headers['x-content-type-options'], 'nosniff', 'X-Content-Type-Options should be nosniff');

  // Check X-XSS-Protection
  assert.ok(response.headers['x-xss-protection'], 'X-XSS-Protection should be present');

  // Check Referrer Policy
  assert.strictEqual(response.headers['referrer-policy'], 'strict-origin-when-cross-origin', 'Referrer-Policy should be strict-origin-when-cross-origin');

  // Check Permissions Policy
  assert.ok(response.headers['permissions-policy'], 'Permissions-Policy should be present');

  // Verify X-Powered-By is removed
  assert.strictEqual(response.headers['x-powered-by'], undefined, 'X-Powered-By should be removed');
});

test('CORS Configuration - Verify CORS headers for allowed origins', async (t) => {
  const app = getAppSync();
  const response = await request(app)
    .get('/health')
    .set('Origin', 'http://localhost:3000')
    .expect(200);

  // Check CORS headers
  assert.ok(response.headers['access-control-allow-origin'], 'CORS origin header should be present');
  assert.strictEqual(response.headers['access-control-allow-origin'], 'http://localhost:3000', 'CORS should allow localhost:3000');
});

test('CORS Configuration - Verify CORS headers for requests without origin', async (t) => {
  const app = getAppSync();
  const response = await request(app)
    .get('/health')
    .expect(200);

  // Requests without origin should be allowed
  assert.strictEqual(response.status, 200, 'Requests without origin should be allowed');
});

test('Rate Limiting - Verify rate limit headers are present', async (t) => {
  const app = getAppSync();
  const response = await request(app)
    .get('/health')
    .expect(200);

  // Check rate limit headers
  assert.ok(response.headers['x-ratelimit-limit'], 'Rate limit limit header should be present');
  assert.ok(response.headers['x-ratelimit-remaining'], 'Rate limit remaining header should be present');
  assert.ok(response.headers['x-ratelimit-reset'], 'Rate limit reset header should be present');

  // Verify numeric values
  const limit = parseInt(response.headers['x-ratelimit-limit']);
  const remaining = parseInt(response.headers['x-ratelimit-remaining']);

  assert.strictEqual(limit, 100, 'Rate limit should be 100');
  assert.ok(remaining >= 0 && remaining <= 100, 'Rate limit remaining should be between 0 and 100');
});

test('Request Size Limits - Verify large JSON payloads are rejected', async (t) => {
  const app = getAppSync();
  // Create a payload larger than 10MB (Express limit)
  const largePayload = {
    data: 'x'.repeat(11 * 1024 * 1024) // 11MB
  };

  const response = await request(app)
    .post('/chat/enhanced/process')
    .send(largePayload);

  // Should be rejected with 413 (payload too large) or 400 (validation)
  assert.ok([400, 413].includes(response.status), `Should reject large payload with 400 or 413, got ${response.status}`);
});

test('Request Size Limits - Verify normal sized payloads are accepted', async (t) => {
  // Skip if services aren't available - this test requires live chat service
  if (skipIfNoServices(t)) return;

  const app = getAppSync();
  const normalPayload = {
    message: 'Hello, this is a normal sized message'
  };

  const response = await request(app)
    .post('/chat/enhanced/process')
    .send(normalPayload)
    .expect(200);

  assert.strictEqual(response.body.success, true, 'Should accept normal sized payload');
});

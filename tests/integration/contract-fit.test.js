import test from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../setupApp.js';
import { testRequest } from '../helpers/http.js';
import { BasicHealthEnvelope, ServiceStatusEnvelope } from '../../src/schemas/health.schema.js';

test('Contract-fit loop: Schema validation against real responses', async (t) => {
  await t.test('setup', async () => {
    await initTestApp();
  });

  await t.test('Health response validates against BasicHealthEnvelope', async () => {
    const response = await testRequest({
      method: 'GET',
      url: '/health'
    }).expect(200);

    // Validate the response against our schema
    const result = BasicHealthEnvelope.safeParse(response.body);
    if (!result.success) {
      console.error('Schema validation failed:', JSON.stringify(result.error.format(), null, 2));
    }
    assert.ok(result.success, 'Schema validation should pass');
    
    // Additional assertions
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.status, 'healthy');
    assert.ok(response.body.data.timestamp);
    assert.ok(typeof response.body.data.uptime === 'number');
  });

  await t.test('Services response validates against ServiceStatusEnvelope', async () => {
    const response = await testRequest({
      method: 'GET',
      url: '/health/services'
    }).expect(200);

    // Validate the response against our schema
    const result = ServiceStatusEnvelope.safeParse(response.body);
    if (!result.success) {
      console.error('Schema validation failed:', JSON.stringify(result.error.format(), null, 2));
    }
    assert.ok(result.success, 'Schema validation should pass');
    
    // Additional assertions
    assert.equal(response.body.success, true);
    assert.ok(['healthy', 'degraded'].includes(response.body.data.status));
    assert.ok(response.body.data.services);
    assert.ok(response.body.data.timestamp);
  });
});

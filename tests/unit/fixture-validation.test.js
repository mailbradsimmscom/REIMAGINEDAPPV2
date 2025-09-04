import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BasicHealthEnvelope, ServiceStatusEnvelope } from '../../src/schemas/health.schema.js';

test('Fixture validation: Schemas match recorded responses', async (t) => {
  await t.test('Health fixture validates against BasicHealthEnvelope', async () => {
    const fixturePath = new URL('../fixtures/responses/health.json', import.meta.url);
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    
    const result = BasicHealthEnvelope.safeParse(fixture);
    if (!result.success) {
      console.error('Fixture validation failed:', JSON.stringify(result.error.format(), null, 2));
    }
    assert.ok(result.success, 'Health fixture should validate against BasicHealthEnvelope');
    
    // Additional assertions
    assert.equal(fixture.success, true);
    assert.equal(fixture.data.status, 'healthy');
    assert.ok(fixture.data.timestamp);
    assert.ok(typeof fixture.data.uptime === 'number');
  });

  await t.test('Services fixture validates against ServiceStatusEnvelope', async () => {
    const fixturePath = new URL('../fixtures/responses/health-services.json', import.meta.url);
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    
    const result = ServiceStatusEnvelope.safeParse(fixture);
    if (!result.success) {
      console.error('Fixture validation failed:', JSON.stringify(result.error.format(), null, 2));
    }
    assert.ok(result.success, 'Services fixture should validate against ServiceStatusEnvelope');
    
    // Additional assertions
    assert.equal(fixture.success, true);
    assert.ok(['healthy', 'degraded'].includes(fixture.data.status));
    assert.ok(fixture.data.services);
    assert.ok(fixture.data.timestamp);
  });
});

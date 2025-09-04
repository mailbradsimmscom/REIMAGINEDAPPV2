import { test } from 'node:test';
import assert from 'node:assert';
import { get } from '../helpers/http.js';

test('Runtime Monitoring Endpoint', async (t) => {
  
  await t.test('GET /health/monitoring returns monitoring data', async () => {
    const response = await get('/health/monitoring');
    
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.ok(response.body.data, 'Should have data object');
    assert.ok(response.body.data.monitoring, 'Should have monitoring object');
    assert.ok(response.body.data.summary, 'Should have summary object');
    
    // Check monitoring structure
    const monitoring = response.body.data.monitoring;
    assert.ok(monitoring.checks, 'Should have checks object');
    assert.ok(typeof monitoring.criticalErrors === 'number', 'Should have criticalErrors count');
    assert.ok(typeof monitoring.warnings === 'number', 'Should have warnings count');
    assert.ok(typeof monitoring.info === 'number', 'Should have info count');
    
    // Check summary structure
    const summary = response.body.data.summary;
    assert.ok(typeof summary.criticalErrors === 'number', 'Should have criticalErrors in summary');
    assert.ok(typeof summary.warnings === 'number', 'Should have warnings in summary');
    assert.ok(typeof summary.info === 'number', 'Should have info in summary');
    
    // Check status
    const status = response.body.data.status;
    assert.ok(['healthy', 'warning', 'critical'].includes(status), 'Should have valid status');
  });
  
  await t.test('Monitoring endpoint includes all required checks', async () => {
    const response = await get('/health/monitoring');
    
    const checks = response.body.data.monitoring.checks;
    
    // Check that all expected checks are present
    assert.ok(checks.doubleSendErrors, 'Should check for double-send errors');
    assert.ok(checks.validationErrors, 'Should check for validation errors');
    assert.ok(checks.methodGuardViolations, 'Should check for method guard violations');
    assert.ok(checks.adminAuthFailures, 'Should check for admin auth failures');
    assert.ok(checks.serviceDisabledErrors, 'Should check for service disabled errors');
    assert.ok(checks.errorRate, 'Should check error rate');
    
    // Check that each check has required properties
    Object.values(checks).forEach(check => {
      assert.ok(typeof check.count === 'number', 'Each check should have count');
      assert.ok(check.status, 'Each check should have status');
      assert.ok(Array.isArray(check.recent), 'Each check should have recent array');
    });
  });
  
  await t.test('Monitoring endpoint handles errors gracefully', async () => {
    // This test would require mocking the monitoring functions
    // For now, we'll just verify the endpoint structure
    
    const response = await get('/health/monitoring');
    
    // Should always return a valid response structure
    assert.ok(response.body.success !== undefined, 'Should have success field');
    assert.ok(response.body.data !== undefined, 'Should have data field');
    assert.ok(response.body.requestId !== undefined, 'Should have requestId field');
  });
  
  await t.test('Monitoring status reflects actual issues', async () => {
    const response = await get('/health/monitoring');
    
    const monitoring = response.body.data.monitoring;
    const status = response.body.data.status;
    
    // Status should reflect the actual issues found
    if (monitoring.criticalErrors > 0) {
      assert.strictEqual(status, 'critical', 'Should be critical if critical errors found');
    } else if (monitoring.warnings > 0) {
      assert.strictEqual(status, 'warning', 'Should be warning if warnings found');
    } else {
      assert.strictEqual(status, 'healthy', 'Should be healthy if no issues found');
    }
  });
  
});

import { test, assertSuccess, assertError, publicRequest, adminRequest, assert } from '../test-config.js';

// Test tightened schema validation with RESPONSE_VALIDATE=1
test('Health Routes - Tightened Schema Validation', async (t) => {
  await t.test('GET /health validates BasicHealthEnvelope', async () => {
    // Set environment flag to enable response validation
    process.env.RESPONSE_VALIDATE = '1';
    
    const response = await publicRequest('get', '/health');
    
    // Should pass with valid data structure
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.data.status, 'healthy');
    assert.strictEqual(typeof response.body.data.timestamp, 'string');
    assert.strictEqual(typeof response.body.data.uptime, 'number');
    
    // Clean up
    delete process.env.RESPONSE_VALIDATE;
  });

  await t.test('GET /health/services validates ServiceStatusEnvelope', async () => {
    // Set environment flag to enable response validation
    process.env.RESPONSE_VALIDATE = '1';
    
    const response = await publicRequest('get', '/health/services');
    
    // Should pass with valid data structure
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(typeof response.body.data.status, 'string');
    assert.strictEqual(['healthy', 'degraded'].includes(response.body.data.status), true);
    assert.strictEqual(typeof response.body.data.services, 'object');
    assert.strictEqual(typeof response.body.data.services.supabase, 'boolean');
    assert.strictEqual(typeof response.body.data.services.pinecone, 'boolean');
    assert.strictEqual(typeof response.body.data.services.openai, 'boolean');
    assert.strictEqual(typeof response.body.data.services.sidecar, 'boolean');
    assert.strictEqual(typeof response.body.data.timestamp, 'string');
    
    // Clean up
    delete process.env.RESPONSE_VALIDATE;
  });

  await t.test('GET /health/ready validates ReadinessEnvelope', async () => {
    // Set environment flag to enable response validation
    process.env.RESPONSE_VALIDATE = '1';
    
    const response = await publicRequest('get', '/health/ready');
    
    // Should pass with valid data structure (may be 503 if not ready, but still valid envelope)
    assert.strictEqual([200, 503].includes(response.status), true);
    assert.strictEqual(typeof response.body.success, 'boolean');
    
    if (response.body.success) {
      assert.strictEqual(response.body.data.status, 'ready');
      assert.strictEqual(typeof response.body.data.timestamp, 'string');
    } else {
      assert.strictEqual(response.body.success, false);
      assert.strictEqual(typeof response.body.error.code, 'string');
      assert.strictEqual(typeof response.body.error.message, 'string');
    }
    
    // Clean up
    delete process.env.RESPONSE_VALIDATE;
  });
});

// Test that validation is disabled when RESPONSE_VALIDATE=0
test('Health Routes - Validation Disabled', async (t) => {
  await t.test('GET /health works with RESPONSE_VALIDATE=0', async () => {
    // Set environment flag to disable response validation
    process.env.RESPONSE_VALIDATE = '0';
    
    const response = await publicRequest('get', '/health');
    
    // Should still work normally
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    
    // Clean up
    delete process.env.RESPONSE_VALIDATE;
  });
});

// Test delete operations with tightened schemas
test('Delete Operations - Tightened Schema Validation', async (t) => {
  await t.test('DELETE /chat/enhanced/delete validates ChatDeleteEnvelope', async () => {
    // Set environment flag to enable response validation
    process.env.RESPONSE_VALIDATE = '1';
    
    const response = await publicRequest('delete', '/chat/enhanced/delete')
      .send({ sessionId: 'test-session-123' });
    
    // Should pass with valid data structure (even if session doesn't exist, envelope should be valid)
    assert.strictEqual([200, 404].includes(response.status), true);
    assert.strictEqual(typeof response.body.success, 'boolean');
    
    if (response.body.success) {
      assert.strictEqual(typeof response.body.data.sessionId, 'string');
      assert.strictEqual(response.body.data.deleted, true);
    } else {
      assert.strictEqual(response.body.success, false);
      assert.strictEqual(typeof response.body.error.code, 'string');
      assert.strictEqual(typeof response.body.error.message, 'string');
    }
    
    // Clean up
    delete process.env.RESPONSE_VALIDATE;
  });

  await t.test('DELETE /chat/enhanced/:sessionId validates ChatDeleteEnvelope', async () => {
    // Set environment flag to enable response validation
    process.env.RESPONSE_VALIDATE = '1';
    
    const response = await publicRequest('delete', '/chat/enhanced/test-session-456');
    
    // Should pass with valid data structure (even if session doesn't exist, envelope should be valid)
    assert.strictEqual([200, 404].includes(response.status), true);
    assert.strictEqual(typeof response.body.success, 'boolean');
    
    if (response.body.success) {
      assert.strictEqual(typeof response.body.data.sessionId, 'string');
      assert.strictEqual(response.body.data.deleted, true);
    } else {
      assert.strictEqual(response.body.success, false);
      assert.strictEqual(typeof response.body.error.code, 'string');
      assert.strictEqual(typeof response.body.error.message, 'string');
    }
    
    // Clean up
    delete process.env.RESPONSE_VALIDATE;
  });
});

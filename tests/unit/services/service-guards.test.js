// tests/unit/services/service-guards.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { resetEnvMemo } from '../../../src/config/env.js';
import documentService from '../../../src/services/document.service.js';
import * as enhancedChatService from '../../../src/services/enhanced-chat.service.js';
import * as systemsService from '../../../src/services/systems.service.js';

// Mock environment variables for testing
const originalEnv = { ...process.env };

// Set NODE_ENV to test so guards use process.env directly
process.env.NODE_ENV = 'test';

test('Service Guards', async (t) => {

  await t.test('Document Service - throws SUPABASE_DISABLED when Supabase not configured', async () => {
    // Reset env memo and clear Supabase environment variables
    resetEnvMemo();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SERVICE_ROLE_KEY;
    
    try {
      await documentService.getDocument('test-doc-id');
      assert.fail('Should have thrown an error');
    } catch (error) {
      assert.strictEqual(error.code, 'SUPABASE_DISABLED');
      assert.strictEqual(error.message, 'Supabase not configured');
    }
  });

  await t.test('Document Service - throws SIDECAR_DISABLED when sidecar not configured', async () => {
    // Reset env memo, set Supabase but clear sidecar
    resetEnvMemo();
    process.env.SUPABASE_URL = originalEnv.SUPABASE_URL || 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = originalEnv.SUPABASE_SERVICE_KEY || 'test-service-key';
    delete process.env.PYTHON_SIDECAR_URL;
    
    try {
      documentService.checkSidecarAvailability();
      assert.fail('Should have thrown an error');
    } catch (error) {
      assert.strictEqual(error.code, 'SIDECAR_DISABLED');
      assert.strictEqual(error.message, 'Python sidecar not configured');
    }
  });

  await t.test('Enhanced Chat Service - throws deprecation error (service replaced by Python-sidecar)', async () => {
    // Reset env memo and clear all service environment variables
    resetEnvMemo();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SERVICE_ROLE_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.PYTHON_SIDECAR_URL;

    try {
      await enhancedChatService.processUserMessage('test query');
      assert.fail('Should have thrown an error');
    } catch (error) {
      // The enhanced chat service is deprecated and throws a deprecation error
      assert(error.message.includes('DEPRECATED') || error.message.includes('not configured'));
    }
  });

  await t.test('Enhanced Chat Service - getChatHistory throws error when services not configured', async () => {
    // Reset env memo and clear Supabase environment variables
    resetEnvMemo();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SERVICE_ROLE_KEY;

    try {
      await enhancedChatService.getChatHistory('test-thread-id');
      assert.fail('Should have thrown an error');
    } catch (error) {
      // The enhanced chat service is deprecated OR throws Supabase not configured
      assert(error.message.includes('DEPRECATED') || error.message.includes('Supabase not configured') || error.message.includes('not configured'));
    }
  });

  await t.test('Systems Service - throws SUPABASE_DISABLED when Supabase not configured', async () => {
    // Reset env memo and clear Supabase environment variables
    resetEnvMemo();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE;
    delete process.env.SERVICE_ROLE_KEY;
    
    try {
      await systemsService.listSystemsSvc({ limit: 10 });
      assert.fail('Should have thrown an error');
    } catch (error) {
      assert.strictEqual(error.code, 'SUPABASE_DISABLED');
      assert.strictEqual(error.message, 'Supabase not configured');
    }
  });

  await t.test('Document Service - guards pass when Supabase is configured', async () => {
    // Reset env memo and set up test environment with real values
    resetEnvMemo();
    process.env.SUPABASE_URL = originalEnv.SUPABASE_URL || 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = originalEnv.SUPABASE_SERVICE_KEY || 'test-service-key';
    process.env.PYTHON_SIDECAR_URL = originalEnv.PYTHON_SIDECAR_URL || 'http://localhost:8000';

    try {
      // This should not throw a CONFIGURATION error
      // (it might throw other errors from actual Supabase operations)
      await documentService.getDocument('test-doc-id');
    } catch (error) {
      // Guard should pass - we should NOT get SUPABASE_DISABLED
      // Any other error is acceptable (e.g., PGRST116 for no rows, network errors, etc.)
      assert.notStrictEqual(error.code, 'SUPABASE_DISABLED', 'Should not get SUPABASE_DISABLED when Supabase is configured');
    }
  });

  await t.test('Enhanced Chat Service - guards pass when services are configured (deprecated service)', async () => {
    // Reset env memo and set up test environment with real values
    resetEnvMemo();
    process.env.SUPABASE_URL = originalEnv.SUPABASE_URL || 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = originalEnv.SUPABASE_SERVICE_KEY || 'test-service-key';
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY || 'test-openai-key';
    process.env.PYTHON_SIDECAR_URL = originalEnv.PYTHON_SIDECAR_URL || 'http://localhost:8000';

    try {
      // This should throw deprecation error (service is deprecated)
      await enhancedChatService.getChatHistory('test-thread-id');
    } catch (error) {
      // The service is deprecated, so we expect a deprecation message OR a non-config error
      // Key assertion: we should NOT get SUPABASE_DISABLED when all services are configured
      assert(
        error.message.includes('DEPRECATED') ||
        error.code !== 'SUPABASE_DISABLED',
        'Should get deprecation error or non-config error when services are configured'
      );
    }
  });

  await t.test('Systems Service - guards pass when Supabase is configured', async () => {
    // Reset env memo and set up test environment with real values
    resetEnvMemo();
    process.env.SUPABASE_URL = originalEnv.SUPABASE_URL || 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = originalEnv.SUPABASE_SERVICE_KEY || 'test-service-key';

    try {
      // This should not throw a CONFIGURATION error
      // (it might throw other errors from actual Supabase operations)
      await systemsService.listSystemsSvc({ limit: 10 });
    } catch (error) {
      // Guard should pass - we should NOT get SUPABASE_DISABLED
      // Any other error is acceptable (e.g., PGRST116 for no rows, network errors, etc.)
      assert.notStrictEqual(error.code, 'SUPABASE_DISABLED', 'Should not get SUPABASE_DISABLED when Supabase is configured');
    }
  });

  // Cleanup after all tests
  await t.test('cleanup - restore original environment', () => {
    // Restore original env vars
    Object.keys(process.env).forEach(key => delete process.env[key]);
    Object.assign(process.env, originalEnv);
    // Reset env memo to use restored values
    resetEnvMemo();
  });
});

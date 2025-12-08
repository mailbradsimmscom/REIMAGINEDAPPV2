// tests/unit/repositories/guards.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { resetEnvMemo, setTestEnv } from '../../../src/config/env.js';
import documentRepository from '../../../src/repositories/document.repository.js';
import * as chatRepository from '../../../src/repositories/chat.repository.js';
import * as systemsRepository from '../../../src/repositories/systems.repository.js';

// Save original env for restoration
const originalEnv = { ...process.env };

test('Repository Guards', async (t) => {

  // Reset before each test for clean state
  t.beforeEach(() => {
    resetEnvMemo();
  });

  await t.test('Document Repository - throws SUPABASE_DISABLED when Supabase not configured', async () => {
    // Use setTestEnv with empty object after resetEnvMemo to get clean slate
    setTestEnv({}); // Empty env - no Supabase configured

    try {
      await documentRepository.getDocument('test-doc-id');
      assert.fail('Should have thrown an error');
    } catch (error) {
      assert.strictEqual(error.code, 'SUPABASE_DISABLED');
      assert.strictEqual(error.message, 'Supabase not configured');
    }
  });

  await t.test('Chat Repository - throws SUPABASE_DISABLED when Supabase not configured', async () => {
    // Use setTestEnv with empty object after resetEnvMemo to get clean slate
    setTestEnv({}); // Empty env - no Supabase configured

    try {
      await chatRepository.getChatSession('test-session-id');
      assert.fail('Should have thrown an error');
    } catch (error) {
      assert.strictEqual(error.code, 'SUPABASE_DISABLED');
      assert.strictEqual(error.message, 'Supabase not configured');
    }
  });

  await t.test('Systems Repository - throws SUPABASE_DISABLED when Supabase not configured', async () => {
    // Use setTestEnv with empty object after resetEnvMemo to get clean slate
    setTestEnv({}); // Empty env - no Supabase configured

    try {
      await systemsRepository.getSystemByAssetUid('test-asset-uid');
      assert.fail('Should have thrown an error');
    } catch (error) {
      assert.strictEqual(error.code, 'SUPABASE_DISABLED');
      assert.strictEqual(error.message, 'Supabase not configured');
    }
  });

  await t.test('Document Repository - works when Supabase is configured', async () => {
    // Set up test environment with Supabase configured
    setTestEnv({
      SUPABASE_URL: originalEnv.SUPABASE_URL || 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: originalEnv.SUPABASE_SERVICE_KEY || 'test-service-key'
    });

    try {
      // This should not throw a configuration error
      // (it might throw other errors due to missing tables, but not SUPABASE_DISABLED)
      await documentRepository.getDocument('test-doc-id');
    } catch (error) {
      // Should not be a configuration error
      assert.notStrictEqual(error.code, 'SUPABASE_DISABLED');
    }
  });

  await t.test('Chat Repository - works when Supabase is configured', async () => {
    // Set up test environment with Supabase configured
    setTestEnv({
      SUPABASE_URL: originalEnv.SUPABASE_URL || 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: originalEnv.SUPABASE_SERVICE_KEY || 'test-service-key'
    });

    try {
      // This should not throw a configuration error
      await chatRepository.getChatSession('test-session-id');
    } catch (error) {
      // Should not be a configuration error
      assert.notStrictEqual(error.code, 'SUPABASE_DISABLED');
    }
  });

  await t.test('Systems Repository - works when Supabase is configured', async () => {
    // Set up test environment with Supabase configured
    setTestEnv({
      SUPABASE_URL: originalEnv.SUPABASE_URL || 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: originalEnv.SUPABASE_SERVICE_KEY || 'test-service-key'
    });

    try {
      // This should not throw a configuration error
      await systemsRepository.getSystemByAssetUid('test-asset-uid');
    } catch (error) {
      // Should not be a configuration error
      assert.notStrictEqual(error.code, 'SUPABASE_DISABLED');
    }
  });

  // Cleanup after all tests
  await t.test('cleanup - restore original environment', () => {
    resetEnvMemo();
  });
});

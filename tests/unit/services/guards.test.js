// tests/unit/services/guards.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import {
  isPineconeConfigured,
  isSupabaseConfigured,
  isOpenAIConfigured,
  isSidecarConfigured,
  getExternalServiceStatus
} from '../../../src/services/guards/index.js';
import { resetEnvMemo, setTestEnv } from '../../../src/config/env.js';

test('External Service Guards', async (t) => {

  // Reset env memo before each test for clean state
  t.beforeEach(() => {
    resetEnvMemo();
  });

  await t.test('isPineconeConfigured - returns true when PYTHON_SIDECAR_URL is set', () => {
    setTestEnv({ PYTHON_SIDECAR_URL: 'http://localhost:8000' });
    assert.strictEqual(isPineconeConfigured(), true);
  });

  await t.test('isPineconeConfigured - returns false when PYTHON_SIDECAR_URL is not set', () => {
    setTestEnv({ PYTHON_SIDECAR_URL: undefined });
    assert.strictEqual(isPineconeConfigured(), false);
  });

  await t.test('isSupabaseConfigured - returns true when SUPABASE_URL and service key are set', () => {
    setTestEnv({
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-service-key'
    });
    assert.strictEqual(isSupabaseConfigured(), true);
  });

  await t.test('isSupabaseConfigured - returns false when SUPABASE_URL is missing', () => {
    setTestEnv({
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_KEY: 'test-service-key',
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      SUPABASE_SERVICE_ROLE: undefined,
      SERVICE_ROLE_KEY: undefined
    });
    assert.strictEqual(isSupabaseConfigured(), false);
  });

  await t.test('isSupabaseConfigured - returns false when service key is missing', () => {
    setTestEnv({
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      SUPABASE_SERVICE_ROLE: undefined,
      SERVICE_ROLE_KEY: undefined
    });
    assert.strictEqual(isSupabaseConfigured(), false);
  });

  await t.test('isOpenAIConfigured - returns true when OPENAI_API_KEY is set', () => {
    setTestEnv({ OPENAI_API_KEY: 'test-openai-key' });
    assert.strictEqual(isOpenAIConfigured(), true);
  });

  await t.test('isOpenAIConfigured - returns false when OPENAI_API_KEY is not set', () => {
    setTestEnv({ OPENAI_API_KEY: undefined });
    assert.strictEqual(isOpenAIConfigured(), false);
  });

  await t.test('isSidecarConfigured - returns true when PYTHON_SIDECAR_URL is set', () => {
    setTestEnv({ PYTHON_SIDECAR_URL: 'http://localhost:8000' });
    assert.strictEqual(isSidecarConfigured(), true);
  });

  await t.test('isSidecarConfigured - returns false when PYTHON_SIDECAR_URL is not set', () => {
    setTestEnv({ PYTHON_SIDECAR_URL: undefined });
    assert.strictEqual(isSidecarConfigured(), false);
  });

  await t.test('getExternalServiceStatus - returns correct status for all services', async () => {
    setTestEnv({
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-service-key',
      OPENAI_API_KEY: 'test-openai-key',
      PYTHON_SIDECAR_URL: 'http://localhost:8000'
    });

    const status = await getExternalServiceStatus();

    assert.strictEqual(status.supabase, true);
    assert.strictEqual(status.openai, true);
    assert.strictEqual(status.pinecone, true);
    assert.strictEqual(status.sidecar, true);
  });

  await t.test('getExternalServiceStatus - returns false for missing services', async () => {
    setTestEnv({
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      SUPABASE_SERVICE_ROLE: undefined,
      SERVICE_ROLE_KEY: undefined,
      OPENAI_API_KEY: undefined,
      PYTHON_SIDECAR_URL: undefined
    });

    const status = await getExternalServiceStatus();

    assert.strictEqual(status.supabase, false);
    assert.strictEqual(status.openai, false);
    assert.strictEqual(status.pinecone, false);
    assert.strictEqual(status.sidecar, false);
  });

  // Cleanup after all tests
  await t.test('cleanup - reset env memo', () => {
    resetEnvMemo();
  });
});

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

// Mock environment variables for testing
const originalEnv = { ...process.env };

// Set NODE_ENV to test so guards use process.env directly
process.env.NODE_ENV = 'test';

// Helper to clear module cache for ES modules
function clearModuleCache() {
  // For ES modules, we need to clear the import cache differently
  // The guards use dynamic imports, so we'll just set the env vars directly
}

test('External Service Guards', async (t) => {
  
  await t.test('isPineconeConfigured - returns true when PYTHON_SIDECAR_URL is set', () => {
    process.env.PYTHON_SIDECAR_URL = 'http://localhost:8000';
    assert.strictEqual(isPineconeConfigured(), true);
  });

  await t.test('isPineconeConfigured - returns false when PYTHON_SIDECAR_URL is not set', () => {
    delete process.env.PYTHON_SIDECAR_URL;
    assert.strictEqual(isPineconeConfigured(), false);
  });

  await t.test('isSupabaseConfigured - returns true when SUPABASE_URL and service key are set', () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
    assert.strictEqual(isSupabaseConfigured(), true);
  });

  await t.test('isSupabaseConfigured - returns false when SUPABASE_URL is missing', () => {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
    assert.strictEqual(isSupabaseConfigured(), false);
  });

  await t.test('isSupabaseConfigured - returns false when service key is missing', () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    delete process.env.SUPABASE_SERVICE_KEY;
    assert.strictEqual(isSupabaseConfigured(), false);
  });

  await t.test('isOpenAIConfigured - returns true when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    assert.strictEqual(isOpenAIConfigured(), true);
  });

  await t.test('isOpenAIConfigured - returns false when OPENAI_API_KEY is not set', () => {
    delete process.env.OPENAI_API_KEY;
    assert.strictEqual(isOpenAIConfigured(), false);
  });

  await t.test('isSidecarConfigured - returns true when PYTHON_SIDECAR_URL is set', () => {
    process.env.PYTHON_SIDECAR_URL = 'http://localhost:8000';
    assert.strictEqual(isSidecarConfigured(), true);
  });

  await t.test('isSidecarConfigured - returns false when PYTHON_SIDECAR_URL is not set', () => {
    delete process.env.PYTHON_SIDECAR_URL;
    assert.strictEqual(isSidecarConfigured(), false);
  });

  await t.test('getExternalServiceStatus - returns correct status for all services', async () => {
    // Set up test environment
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.PYTHON_SIDECAR_URL = 'http://localhost:8000';

    const status = await getExternalServiceStatus();
    
    assert.strictEqual(status.supabase, true);
    assert.strictEqual(status.openai, true);
    assert.strictEqual(status.pinecone, true);
    assert.strictEqual(status.sidecar, true);
  });

  await t.test('getExternalServiceStatus - returns false for missing services', async () => {
    // Clear all environment variables
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.PYTHON_SIDECAR_URL;

    const status = await getExternalServiceStatus();
    
    assert.strictEqual(status.supabase, false);
    assert.strictEqual(status.openai, false);
    assert.strictEqual(status.pinecone, false);
    assert.strictEqual(status.sidecar, false);
  });

  // Cleanup after all tests
  await t.test('cleanup - restore original environment', () => {
    process.env = originalEnv;
  });
});

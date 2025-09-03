import { test } from 'node:test';
import assert from 'node:assert';
import { getEnv } from '../../../src/config/env.js';

test('Environment schema parsing in dev mode', async () => {
  // Test that getEnv works in dev mode (loose validation)
  const env = getEnv({ loose: true });
  
  // Should not throw even with missing required fields
  assert.ok(typeof env === 'object', 'getEnv should return an object');
  
  // Check that optional fields are handled correctly
  assert.ok(env.NODE_ENV === 'development' || env.NODE_ENV === 'test' || env.NODE_ENV === 'production', 'NODE_ENV should be valid');
  
  // Check that missing fields are undefined (not throwing)
  assert.ok(env.ADMIN_TOKEN === undefined || typeof env.ADMIN_TOKEN === 'string', 'ADMIN_TOKEN should be undefined or string');
  assert.ok(env.SUPABASE_URL === undefined || typeof env.SUPABASE_URL === 'string', 'SUPABASE_URL should be undefined or string');
  
  console.log('✅ Environment schema parsing works in dev mode');
  console.log('Current env state:', {
    NODE_ENV: env.NODE_ENV,
    adminEnabled: !!env.ADMIN_TOKEN,
    supabaseEnabled: !!(env.SUPABASE_URL && (env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE || env.SERVICE_ROLE_KEY)),
    pineconeEnabled: !!env.PYTHON_SIDECAR_URL,
    namespace: env.PINECONE_NAMESPACE || env.DEFAULT_NAMESPACE || null
  });
});

// src/services/guards/index.js
// Centralized external service guards

export { isPineconeConfigured } from './pinecone.guard.js';
export { isSupabaseConfigured } from './supabase.guard.js';
export { isOpenAIConfigured } from './openai.guard.js';
export { isSidecarConfigured } from './sidecar.guard.js';

// Convenience function to check all external services
export async function getExternalServiceStatus() {
  // For testing, check process.env directly if getEnv is memoized
  if (process.env.NODE_ENV === 'test') {
    return {
      supabase: !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SERVICE_ROLE_KEY)),
      pinecone: !!process.env.PYTHON_SIDECAR_URL,
      openai: !!process.env.OPENAI_API_KEY,
      sidecar: !!process.env.PYTHON_SIDECAR_URL
    };
  }
  
  const { getEnv } = await import('../../config/env.js');
  const env = getEnv({ loose: true });
  
  return {
    supabase: !!(env.SUPABASE_URL && (env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE || env.SERVICE_ROLE_KEY)),
    pinecone: !!env.PYTHON_SIDECAR_URL,
    openai: !!env.OPENAI_API_KEY,
    sidecar: !!env.PYTHON_SIDECAR_URL
  };
}

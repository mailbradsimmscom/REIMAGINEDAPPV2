// src/services/guards/index.js
// Centralized external service guards
import { getEnv } from '../../config/env.js';

export { isPineconeConfigured } from './pinecone.guard.js';
export { isSupabaseConfigured } from './supabase.guard.js';
export { isOpenAIConfigured } from './openai.guard.js';
export { isSidecarConfigured } from './sidecar.guard.js';

// Convenience function to check all external services
export async function getExternalServiceStatus() {
  const env = getEnv();
  return {
    supabase: !!(env.SUPABASE_URL && (env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE || env.SERVICE_ROLE_KEY)),
    pinecone: !!env.PYTHON_SIDECAR_URL,
    openai: !!env.OPENAI_API_KEY,
    sidecar: !!env.PYTHON_SIDECAR_URL
  };
}

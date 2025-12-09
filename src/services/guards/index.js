// src/services/guards/index.js
// Centralized external service guards
import { isPineconeConfigured } from './pinecone.guard.js';
import { isSupabaseConfigured } from './supabase.guard.js';
import { isOpenAIConfigured } from './openai.guard.js';
import { isSidecarConfigured } from './sidecar.guard.js';

export { isPineconeConfigured, isSupabaseConfigured, isOpenAIConfigured, isSidecarConfigured };

// Convenience function to check all external services
export async function getExternalServiceStatus() {
  return {
    supabase: isSupabaseConfigured(),
    pinecone: isPineconeConfigured(),
    openai: isOpenAIConfigured(),
    sidecar: isSidecarConfigured()
  };
}

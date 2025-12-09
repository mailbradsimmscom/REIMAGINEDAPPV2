// src/services/guards/pinecone.guard.js
import { getEnv } from '../../config/env.js';

export function isPineconeConfigured() {
  const env = getEnv();
  // Check explicit disable flag first
  if (env.PINECONE_DISABLED === '1' || env.PINECONE_DISABLED === 'true') {
    return false;
  }
  return !!env.PYTHON_SIDECAR_URL;
}

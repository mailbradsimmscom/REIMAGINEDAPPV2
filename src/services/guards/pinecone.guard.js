// src/services/guards/pinecone.guard.js
import { ENV } from '../../config/env.js';

export function isPineconeConfigured() {
  // For testing, check process.env directly if getEnv is memoized
  if (ENV.NODE_ENV === 'test') {
    return !!ENV.PYTHON_SIDECAR_URL;
  }
  
  return !!ENV.PYTHON_SIDECAR_URL;
}

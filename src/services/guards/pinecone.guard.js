// src/services/guards/pinecone.guard.js
import { getEnv } from '../../config/env.js';

export function isPineconeConfigured() {
  const env = getEnv();
  return !!env.PYTHON_SIDECAR_URL;
}

// src/services/pinecone.guard.js
import { getEnv } from '../config/env.js';

export function isPineconeConfigured() {
  const { PYTHON_SIDECAR_URL } = getEnv({ loose: true });
  return !!PYTHON_SIDECAR_URL;
}

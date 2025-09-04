// src/services/guards/sidecar.guard.js
import { getEnv } from '../../config/env.js';

export function isSidecarConfigured() {
  // For testing, check process.env directly if getEnv is memoized
  if (process.env.NODE_ENV === 'test') {
    return !!process.env.PYTHON_SIDECAR_URL;
  }
  
  const env = getEnv({ loose: true });
  return !!env.PYTHON_SIDECAR_URL;
}

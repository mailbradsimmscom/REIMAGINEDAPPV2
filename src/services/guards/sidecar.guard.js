// src/services/guards/sidecar.guard.js
import { getEnv } from '../../config/env.js';

export function isSidecarConfigured() {
  const env = getEnv();
  // Check explicit disable flag first
  if (env.SIDECAR_DISABLED === '1' || env.SIDECAR_DISABLED === 'true') {
    return false;
  }
  return !!env.PYTHON_SIDECAR_URL;
}

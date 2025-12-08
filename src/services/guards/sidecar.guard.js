// src/services/guards/sidecar.guard.js
import { getEnv } from '../../config/env.js';

export function isSidecarConfigured() {
  const env = getEnv();
  return !!env.PYTHON_SIDECAR_URL;
}

// src/services/guards/openai.guard.js
import { getEnv } from '../../config/env.js';

export function isOpenAIConfigured() {
  const env = getEnv();
  // Check explicit disable flag first
  if (env.OPENAI_DISABLED === '1' || env.OPENAI_DISABLED === 'true') {
    return false;
  }
  return !!env.OPENAI_API_KEY;
}

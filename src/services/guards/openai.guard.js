// src/services/guards/openai.guard.js
import { getEnv } from '../../config/env.js';

export function isOpenAIConfigured() {
  // For testing, check process.env directly if getEnv is memoized
  if (process.env.NODE_ENV === 'test') {
    return !!process.env.OPENAI_API_KEY;
  }
  
  const env = getEnv({ loose: true });
  return !!env.OPENAI_API_KEY;
}

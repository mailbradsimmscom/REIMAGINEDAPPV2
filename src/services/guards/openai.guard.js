// src/services/guards/openai.guard.js
import { ENV } from '../../config/env.js';

export function isOpenAIConfigured() {
  // For testing, check process.env directly if getEnv is memoized
  if (ENV.NODE_ENV === 'test') {
    return !!ENV.OPENAI_API_KEY;
  }
  
  return !!ENV.OPENAI_API_KEY;
}

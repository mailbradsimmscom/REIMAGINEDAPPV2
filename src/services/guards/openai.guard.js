// src/services/guards/openai.guard.js
import { getEnv } from '../../config/env.js';

export function isOpenAIConfigured() {
  const env = getEnv();
  return !!env.OPENAI_API_KEY;
}

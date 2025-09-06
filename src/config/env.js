

import { z } from 'zod';

let MEMO;
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.string().optional(),
  PINECONE_API_KEY: z.string().optional(),
  PINECONE_INDEX: z.string().optional(),
  PINECONE_ENVIRONMENT: z.string().optional(),
  PINECONE_NAMESPACE: z.string().optional(),
  DEFAULT_NAMESPACE: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  SEARCH_RANK_FLOOR: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE: z.string().optional(),
  SERVICE_ROLE_KEY: z.string().optional(),
  ADMIN_TOKEN: z.string().optional(),
  PYTHON_SIDECAR_URL: z.string().optional(),
  APP_VERSION: z.string().optional(),
  RESPONSE_VALIDATE: z.string().optional(),
  CHAT_CONTEXT_SIZE: z.string().optional().default('5'),
  CONTEXT_LOADING_TIMEOUT_MS: z.string().optional().default('1800'),
  SYSTEM_SEARCH_TIMEOUT_MS: z.string().optional().default('1200'),
}).refine((data) => {
  // In production, require certain critical variables
  if (data.NODE_ENV === 'production') {
    if (!data.ADMIN_TOKEN) {
      return false;
    }
  }
  return true;
}, {
  message: "ADMIN_TOKEN is required in production environment",
  path: ["ADMIN_TOKEN"]
});

export function getEnv({ loose = null } = {}) {
  if (MEMO) return MEMO;
  
  // Auto-detect environment for validation strictness
  const nodeEnv = process.env.NODE_ENV || 'development';
  const shouldBeLoose = loose !== null ? loose : nodeEnv !== 'production';
  
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success && !shouldBeLoose) {
    const errorMessage = `Environment validation failed: ${parsed.error.message}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  
  MEMO = parsed.success ? parsed.data : {};
  return MEMO;
}

// Export environment variables directly for easy access
export const ENV = getEnv();

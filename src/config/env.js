

import { z } from 'zod';
import { config } from 'dotenv';

// Load .env file
config();

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
  PY_SUPABASE_SERVICE_KEY: z.string().optional(),
  ADMIN_TOKEN: z.string().optional(),
  PYTHON_SIDECAR_URL: z.string().optional(),
  PYTHON_CHAT_TIMEOUT_MS: z.string().optional(),
  APP_VERSION: z.string().optional(),
  RESPONSE_VALIDATE: z.string().optional(),
  CHAT_CONTEXT_SIZE: z.string().optional().default('5'),
  CONTEXT_LOADING_TIMEOUT_MS: z.string().optional().default('1800'),
  SYSTEM_SEARCH_TIMEOUT_MS: z.string().optional().default('1200'),
  // Document text source (Postgres table) used by DIP extractor
  DOC_CHUNKS_TABLE: z.string().optional().default('document_chunks'),
  // Optional column names if your schema differs
  DOC_CHUNKS_PAGE_COL: z.string().optional().default('page_start'),
  DOC_CHUNKS_TEXT_COL: z.string().optional().default('content'),
  // Anthropic API delay for rate limiting (seconds)
  ANTHROPIC_API_DELAY: z.string().optional().default('1.2'),
  // Debug flag for DIP LLM extraction (set to '1' to enable verbose logging)
  DIP_LLM_DEBUG: z.string().optional(),
  // Cross-service URL for maintenance agent
  MAINTENANCE_SERVICE_URL: z.string().default('http://localhost:3001')
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

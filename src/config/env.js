

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
  VISION_MODEL: z.string().optional().default('gpt-4o'),  // Vision model for photo analysis
  SEARCH_RANK_FLOOR: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE: z.string().optional(),
  SERVICE_ROLE_KEY: z.string().optional(),
  PY_SUPABASE_SERVICE_KEY: z.string().optional(),
  ADMIN_TOKEN: z.string().optional(),
  ADMIN_PIN: z.string().optional(),
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
  MAINTENANCE_SERVICE_URL: z.string().default('http://localhost:3001'),
  // Anchor Watch Configuration
  ANCHOR_WATCH_SAFE_RATIO: z.string().optional().default('0.7'),
  ANCHOR_WATCH_WARNING_RATIO: z.string().optional().default('0.9'),
  ANCHOR_WATCH_CENTROID_SAMPLES: z.string().optional().default('20'),
  ANCHOR_WATCH_STALE_THRESHOLD_SEC: z.string().optional().default('300'),
  // Telegram Bot Configuration (Anchor Watch)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  // Telegram DIP Review Bot (separate bot for agent escalations)
  TELEGRAM_DIP_BOT_TOKEN: z.string().optional(),
  TELEGRAM_DIP_CHAT_ID: z.string().optional(),
  // Twilio SMS Configuration
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_SMS_TO: z.string().optional(),
  // Service disable flags for testing/CI
  PINECONE_DISABLED: z.string().optional(),
  SIDECAR_DISABLED: z.string().optional(),
  SUPABASE_DISABLED: z.string().optional(),
  OPENAI_DISABLED: z.string().optional(),
  // AIS Stream API for tracking friend vessels globally
  AISSTREAM_API_KEY: z.string().optional(),
  // Yahoo SMTP for email proxy
  YAHOO_EMAIL: z.string().optional(),
  YAHOO_PASSWORD: z.string().optional()
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

// ============================================
// TEST HELPERS - Used only in test environment
// ============================================

/**
 * Reset the memoized environment.
 * Call this in test teardown to ensure clean state between tests.
 */
export function resetEnvMemo() {
  MEMO = null;
}

/**
 * Set test environment overrides.
 * If MEMO exists, merges overrides with it. If MEMO is null (after resetEnvMemo),
 * starts with an empty object and applies only the provided overrides.
 * Keys explicitly set to undefined or null will be deleted.
 *
 * @param {Object} overrides - Key-value pairs to override
 * @returns {Object} The merged environment
 *
 * @example
 * resetEnvMemo();
 * setTestEnv({ PYTHON_SIDECAR_URL: 'http://localhost:8001' }); // Only this key is set
 * setTestEnv({ SUPABASE_URL: undefined }); // Removes SUPABASE_URL if present
 */
export function setTestEnv(overrides) {
  // If MEMO is null (after reset), start with empty object - don't re-read process.env
  // This allows tests to have a truly clean slate
  const current = MEMO !== null ? MEMO : {};
  MEMO = { ...current };

  // Apply overrides, deleting keys that are explicitly undefined/null
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) {
      delete MEMO[key];
    } else {
      MEMO[key] = value;
    }
  }

  return MEMO;
}

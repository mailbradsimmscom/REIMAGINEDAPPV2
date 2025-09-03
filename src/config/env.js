

import { z } from 'zod';

let MEMO;
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.string().optional(),
  PINECONE_API_KEY: z.string().optional(),
  PINECONE_INDEX: z.string().optional(),
  PINECONE_ENVIRONMENT: z.string().optional(),
  PINECONE_NAMESPACE: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE: z.string().optional(),
  SERVICE_ROLE_KEY: z.string().optional(),
  ADMIN_TOKEN: z.string().optional(),
  PYTHON_SIDECAR_URL: z.string().optional(),
  APP_VERSION: z.string().optional(),
});

export function getEnv({ loose = true } = {}) {
  if (MEMO) return MEMO;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success && !loose) throw new Error(parsed.error.message);
  MEMO = parsed.success ? parsed.data : {};
  return MEMO;
}

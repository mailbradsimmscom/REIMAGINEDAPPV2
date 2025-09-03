

import { z } from 'zod';

let MEMO;
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.string().optional(),
  PINECONE_API_KEY: z.string().optional(),
  PINECONE_INDEX: z.string().optional(),
  PINECONE_ENVIRONMENT: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
});

export function getEnv({ loose = true } = {}) {
  if (MEMO) return MEMO;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success && !loose) throw new Error(parsed.error.message);
  MEMO = parsed.success ? parsed.data : {};
  return MEMO;
}

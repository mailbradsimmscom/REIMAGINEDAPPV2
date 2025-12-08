// src/services/guards/supabase.guard.js
import { getEnv } from '../../config/env.js';

export function isSupabaseConfigured() {
  const env = getEnv();
  return !!(env.SUPABASE_URL && (env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE || env.SERVICE_ROLE_KEY));
}

// src/services/guards/supabase.guard.js
import { getEnv } from '../../config/env.js';

export function isSupabaseConfigured() {
  const env = getEnv();
  // Check explicit disable flag first
  if (env.SUPABASE_DISABLED === '1' || env.SUPABASE_DISABLED === 'true') {
    return false;
  }
  return !!(env.SUPABASE_URL && (env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE || env.SERVICE_ROLE_KEY));
}

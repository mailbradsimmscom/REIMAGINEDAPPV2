// src/services/guards/supabase.guard.js
import { getEnv } from '../../config/env.js';

export function isSupabaseConfigured() {
  // For testing, check process.env directly if getEnv is memoized
  if (process.env.NODE_ENV === 'test') {
    return !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SERVICE_ROLE_KEY));
  }
  
  const env = getEnv({ loose: true });
  return !!(env.SUPABASE_URL && (env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE || env.SERVICE_ROLE_KEY));
}

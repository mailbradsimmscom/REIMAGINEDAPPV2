// src/services/guards/supabase.guard.js
import { ENV } from '../../config/env.js';

export function isSupabaseConfigured() {
  // For testing, check process.env directly if getEnv is memoized
  if (ENV.NODE_ENV === 'test') {
    return !!(ENV.SUPABASE_URL && (ENV.SUPABASE_SERVICE_KEY || ENV.SUPABASE_SERVICE_ROLE_KEY || ENV.SUPABASE_SERVICE_ROLE || ENV.SERVICE_ROLE_KEY));
  }
  
  return !!(ENV.SUPABASE_URL && (ENV.SUPABASE_SERVICE_KEY || ENV.SUPABASE_SERVICE_ROLE_KEY || ENV.SUPABASE_SERVICE_ROLE || ENV.SERVICE_ROLE_KEY));
}

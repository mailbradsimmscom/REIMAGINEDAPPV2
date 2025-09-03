import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

let supabase = null;
let supabaseStorage = null;

function getSupabaseConfig() {
  const env = getEnv({ loose: true });
  return {
    url: env.SUPABASE_URL,
    key: env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE || env.SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY
  };
}

export function getSupabaseClient() {
  if (!supabase) {
    const config = getSupabaseConfig();
    supabase = createClient(config.url, config.key);
  }
  return supabase;
}

export function getSupabaseStorageClient() {
  if (!supabaseStorage) {
    const config = getSupabaseConfig();
    supabaseStorage = createClient(config.url, config.key);
  }
  return supabaseStorage;
}

// Log configuration (masked for security) - only when first accessed
function logConfig() {
  const config = getSupabaseConfig();
  const requestLogger = logger.createRequestLogger();
  requestLogger.info('Supabase client initialized', {
    supabaseUrlPrefix: config.url?.split('//')[1]?.split('.')[0],
    supabaseKeyMasked: config.key ? `${config.key.substring(0, 10)}...${config.key.substring(config.key.length - 5)} (len:${config.key.length})` : 'not set',
    hasServiceKey: !!config.key
  });
}

// Initialize and log on first access
getSupabaseClient();
logConfig();

export default getSupabaseClient();



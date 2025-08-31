import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Create client with anon key for general operations
const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey);

// Create client with service role key for storage operations (bypasses RLS)
const supabaseStorage = createClient(env.supabaseUrl, env.supabaseServiceKey);

export function getSupabaseClient() {
  return supabase;
}

export function getSupabaseStorageClient() {
  return supabaseStorage;
}

// Log configuration (masked for security)
const requestLogger = logger.createRequestLogger();
requestLogger.info('Supabase client initialized', {
  supabaseUrlPrefix: env.supabaseUrl?.split('//')[1]?.split('.')[0],
  supabaseKeyMasked: env.supabaseServiceKey ? `${env.supabaseServiceKey.substring(0, 10)}...${env.supabaseServiceKey.substring(env.supabaseServiceKey.length - 5)} (len:${env.supabaseServiceKey.length})` : 'not set',
  hasServiceKey: !!env.supabaseServiceKey
});

export default supabase;



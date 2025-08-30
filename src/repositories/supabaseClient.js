import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Create client with anon key for general operations
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Create client with service role key for storage operations (bypasses RLS)
const supabaseStorage = supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : supabase;

export function getSupabaseClient() {
  return supabase;
}

export function getSupabaseStorageClient() {
  return supabaseStorage;
}

// Log configuration (masked for security)
const requestLogger = logger.createRequestLogger();
requestLogger.info('Supabase client initialized', {
  supabaseUrlPrefix: supabaseUrl?.split('//')[1]?.split('.')[0],
  supabaseKeyMasked: supabaseAnonKey ? `${supabaseAnonKey.substring(0, 10)}...${supabaseAnonKey.substring(supabaseAnonKey.length - 5)} (len:${supabaseAnonKey.length})` : 'not set',
  hasServiceKey: !!supabaseServiceKey
});

export default supabase;



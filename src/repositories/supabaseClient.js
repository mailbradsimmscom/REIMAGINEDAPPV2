import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

let cachedClient = null;

export function getSupabaseClient() {
  if (cachedClient) return cachedClient;

  cachedClient = createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false },
    global: { headers: { 'X-Client-Info': 'reimaginedappv2' } }
  });

  return cachedClient;
}

export default getSupabaseClient;



// src/repositories/supabaseClient.js
import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';

let supabase = null;
let hasLoggedConfig = false;

async function getSupabaseConfig() {
  // Import env synchronously for lazy loading
  const { getEnv } = await import('../config/env.js');
  const env = getEnv();
  return {
    url: env.SUPABASE_URL,
    key:
      env.SUPABASE_SERVICE_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_SERVICE_ROLE ||
      env.SERVICE_ROLE_KEY ||
      env.SUPABASE_ANON_KEY,
  };
}

export async function getSupabaseClient() {
  if (supabase) return supabase;

  const { url, key } = await getSupabaseConfig();
  if (!url || !key) {
    if (!hasLoggedConfig) {
      logger.warn('Supabase disabled: missing SUPABASE_URL or service/anon key.', {
        hasUrl: !!url,
        hasKey: !!key,
      });
      hasLoggedConfig = true;
    }
    return null; // graceful degradation
  }

  supabase = createClient(url, key);

  // Log once on first real init
  if (!hasLoggedConfig) {
    logger.info('Supabase client initialized', {
      supabaseUrlPrefix: url.split('//')[1]?.split('.')[0],
      hasServiceKey: !!key,
    });
    hasLoggedConfig = true;
  }

  return supabase;
}

// Convenience, if you want explicit storage access without extra clients:
export async function getSupabaseStorage() {
  const client = await getSupabaseClient();
  return client?.storage ?? null;
}

/** 👇 compat shim for older code */
export async function getSupabaseStorageClient() {
  return await getSupabaseClient();
}

// Prefer named exports; if you want a default, export the **getter**, not the instance:
export default getSupabaseClient;

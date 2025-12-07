// src/repositories/supabaseClient.js
import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';

let supabase = null;
let hasLoggedConfig = false;

// ============================================
// FACTORY PATTERN FOR TEST INJECTION
// ============================================

/**
 * Factory for creating Supabase client instances.
 * Used by tests to inject mock clients.
 *
 * @param {{ url: string, key: string }} config
 * @returns {{ getClient: () => Object|null, reset: () => void }}
 */
export function createSupabaseClientFactory({ url, key }) {
  let instance = null;

  return {
    getClient() {
      if (instance) return instance;
      if (!url || !key) return null;  // Graceful degradation
      instance = createClient(url, key);
      return instance;
    },
    reset() {
      instance = null;
    }
  };
}

// Default factory - null until first getSupabaseClient() call
let defaultFactory = null;

// ============================================
// CORE FUNCTIONS
// ============================================

async function getSupabaseConfig() {
  // Import env synchronously for lazy loading
  const { getEnv } = await import('../config/env.js');
  const env = getEnv();
  return {
    url: env.SUPABASE_URL,
    key:
      env.PY_SUPABASE_SERVICE_KEY ||  // Use same key as Python first
      env.SUPABASE_SERVICE_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_SERVICE_ROLE ||
      env.SERVICE_ROLE_KEY ||
      env.SUPABASE_ANON_KEY,
  };
}

export async function getSupabaseClient() {
  // If a custom factory was injected (for tests), use it
  if (defaultFactory) {
    return defaultFactory.getClient();
  }

  // Normal singleton path
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
    logger.info('🔑 Supabase client initialized', {
      supabaseUrlPrefix: url.split('//')[1]?.split('.')[0],
      hasServiceKey: !!key,
      keyPrefix: key?.substring(0, 20) + '...',
      keyType: key?.startsWith('eyJ') ? 'JWT' : key?.startsWith('sb_') ? 'SERVICE' : 'OTHER'
    });
    hasLoggedConfig = true;
  }

  return supabase;
}

// ============================================
// TEST HELPERS - Used only in test environment
// ============================================

/**
 * Inject a custom factory (for tests).
 * The factory must have getClient() and reset() methods.
 *
 * @param {{ getClient: () => Object, reset: () => void }} factory
 *
 * @example
 * // In test setup:
 * const mockClient = { from: () => ({ select: () => ({ data: [] }) }) };
 * setSupabaseClientFactory({
 *   getClient: () => mockClient,
 *   reset: () => {}
 * });
 */
export function setSupabaseClientFactory(factory) {
  defaultFactory = factory;
}

/**
 * Reset the Supabase client singleton and any injected factory.
 * Call this in test teardown to ensure clean state.
 */
export function resetSupabaseClient() {
  if (defaultFactory) {
    defaultFactory.reset();
  }
  defaultFactory = null;
  supabase = null;
  hasLoggedConfig = false;
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

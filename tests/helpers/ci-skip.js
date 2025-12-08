// tests/helpers/ci-skip.js
//
// Helpers for skipping tests that require live services in CI.
// These tests can run locally when services are configured.

import { getEnv, resetEnvMemo } from '../../src/config/env.js';

/**
 * Check if we're running in CI without full service configuration.
 * Returns true if tests requiring services should be skipped.
 */
export function shouldSkipServiceTests() {
  // If explicitly set to skip, honor it
  if (process.env.SKIP_SERVICE_TESTS === 'true') {
    return true;
  }

  // In CI, check if services are configured
  if (process.env.CI) {
    resetEnvMemo();
    const env = getEnv();

    // Check for essential services
    const hasSupabase = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
    const hasSidecar = !!env.PYTHON_SIDECAR_URL;
    const hasOpenAI = !!env.OPENAI_API_KEY;

    // If any essential service is missing, skip service tests
    if (!hasSupabase || !hasSidecar || !hasOpenAI) {
      return true;
    }
  }

  return false;
}

/**
 * Get a skip message for tests that require services.
 */
export function getServiceSkipMessage() {
  return 'Skipping: requires live services (Supabase, Sidecar, OpenAI)';
}

/**
 * Conditionally skip a test if services aren't available.
 * Use in test.before() or at the start of a test.
 *
 * @example
 * test('my service test', async (t) => {
 *   skipIfNoServices(t);
 *   // rest of test...
 * });
 */
export function skipIfNoServices(t) {
  if (shouldSkipServiceTests()) {
    t.skip(getServiceSkipMessage());
    return true;
  }
  return false;
}

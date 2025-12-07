import { config } from 'dotenv';
import { getEnv, resetEnvMemo, setTestEnv } from '../../src/config/env.js';

/**
 * Get test environment with loose validation.
 * @deprecated Use withTestEnv() for proper setup/teardown.
 */
export function testEnv() {
  return getEnv({ loose: true });
}

/**
 * Helper to set up test environment with optional overrides.
 * Use in describe() blocks for clean setup/teardown.
 *
 * @param {Object} overrides - Key-value pairs to override env vars
 *
 * @example
 * import { describe, test } from 'node:test';
 * import { withTestEnv } from '../helpers/env.js';
 *
 * describe('chat proxy', () => {
 *   withTestEnv({ PYTHON_SIDECAR_URL: 'http://localhost:8001' });
 *
 *   test('processes message', async () => {
 *     // Test runs with overridden env
 *   });
 * });
 */
export function withTestEnv(overrides = {}) {
  // Note: These use node:test's built-in hooks
  // If you're using a different test runner, adjust accordingly
  if (typeof beforeEach === 'function') {
    beforeEach(() => {
      // Load .env.test first (if it exists)
      config({ path: '.env.test' });
      // Reset memoized env
      resetEnvMemo();
      // Apply overrides
      if (Object.keys(overrides).length > 0) {
        setTestEnv(overrides);
      }
    });
  }

  if (typeof afterEach === 'function') {
    afterEach(() => {
      resetEnvMemo();
    });
  }
}

/**
 * One-off setup for tests that don't use describe blocks.
 * Remember to call teardownTestEnv() in your test cleanup.
 *
 * @param {Object} overrides - Key-value pairs to override env vars
 */
export function setupTestEnv(overrides = {}) {
  config({ path: '.env.test' });
  resetEnvMemo();
  if (Object.keys(overrides).length > 0) {
    setTestEnv(overrides);
  }
}

/**
 * Cleanup after test - resets env memo to clean state.
 */
export function teardownTestEnv() {
  resetEnvMemo();
}

// Re-export for convenience
export { resetEnvMemo, setTestEnv } from '../../src/config/env.js';

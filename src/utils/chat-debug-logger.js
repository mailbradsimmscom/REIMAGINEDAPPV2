import { logger } from './logger.js';
import { getEnv } from '../config/env.js';

/**
 * Chat Debug Logger
 * TEMPORARY - Remove after migration is complete
 *
 * Usage:
 *   import { chatDebug } from '../utils/chat-debug-logger.js';
 *   chatDebug.step('STEP_NAME', { data: 'value' });
 */

const env = getEnv();
const DEBUG_ENABLED = env.CHAT_DEBUG_LOGGING === 'true';

export const chatDebug = {
  /**
   * Log a processing step with data
   */
  step(stepName, data = {}) {
    if (!DEBUG_ENABLED) return;

    logger.info(`🔍 [CHAT_DEBUG] ${stepName}`, {
      debug: true,
      step: stepName,
      timestamp: new Date().toISOString(),
      ...data
    });
  },

  /**
   * Log state transitions
   */
  state(phase, state = {}) {
    if (!DEBUG_ENABLED) return;

    logger.info(`🔄 [CHAT_DEBUG] STATE: ${phase}`, {
      debug: true,
      phase,
      state: JSON.stringify(state, null, 2).substring(0, 500), // Truncate large states
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Log before/after data transformations
   */
  transform(name, before, after) {
    if (!DEBUG_ENABLED) return;

    logger.info(`🔧 [CHAT_DEBUG] TRANSFORM: ${name}`, {
      debug: true,
      transform: name,
      before: JSON.stringify(before).substring(0, 200),
      after: JSON.stringify(after).substring(0, 200),
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Log API calls (Python sidecar)
   */
  apiCall(endpoint, payload, response = null) {
    if (!DEBUG_ENABLED) return;

    const data = {
      debug: true,
      endpoint,
      payloadSize: JSON.stringify(payload).length,
      timestamp: new Date().toISOString()
    };

    if (response) {
      data.responseSize = JSON.stringify(response).length;
      data.success = response.success || response.response ? true : false;
    }

    logger.info(`📡 [CHAT_DEBUG] API_CALL: ${endpoint}`, data);
  },

  /**
   * Log timing for performance analysis
   */
  timing(operation, durationMs, metadata = {}) {
    if (!DEBUG_ENABLED) return;

    logger.info(`⏱️  [CHAT_DEBUG] TIMING: ${operation}`, {
      debug: true,
      operation,
      duration_ms: durationMs,
      ...metadata,
      timestamp: new Date().toISOString()
    });
  },

  /**
   * Log errors with full context
   */
  error(location, error, context = {}) {
    if (!DEBUG_ENABLED) return;

    logger.error(`❌ [CHAT_DEBUG] ERROR: ${location}`, {
      debug: true,
      location,
      error: error.message,
      stack: error.stack,
      ...context,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Decorator to time async functions
 */
export function timed(name) {
  return function (target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args) {
      const start = Date.now();
      try {
        const result = await originalMethod.apply(this, args);
        chatDebug.timing(name || propertyKey, Date.now() - start);
        return result;
      } catch (error) {
        chatDebug.timing(name || propertyKey, Date.now() - start, { failed: true });
        throw error;
      }
    };

    return descriptor;
  };
}

export default chatDebug;

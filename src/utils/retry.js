/**
 * Generic retry utility with exponential backoff
 *
 * Provides consistent retry behavior across the codebase.
 * Similar to the pattern used in openai.client.js but reusable.
 */

import { logger } from './logger.js';

const moduleLogger = logger.createModuleLogger('retry');

/**
 * Default retry options
 */
export const DEFAULT_RETRY_OPTIONS = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryOn: null,  // Function to check if error should be retried
  onRetry: null   // Callback on each retry
};

/**
 * Execute a function with retry and exponential backoff
 *
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Retry options
 * @param {number} options.maxAttempts - Maximum number of attempts (default: 3)
 * @param {number} options.baseDelayMs - Base delay in ms (default: 1000)
 * @param {number} options.maxDelayMs - Maximum delay in ms (default: 10000)
 * @param {Function} options.retryOn - Function(error) that returns true if should retry
 * @param {Function} options.onRetry - Callback(attempt, error, delay) on each retry
 * @returns {Promise<any>} - Result of fn()
 */
export async function withRetry(fn, options = {}) {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const { maxAttempts, baseDelayMs, maxDelayMs, retryOn, onRetry } = opts;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (retryOn && !retryOn(error)) {
        moduleLogger.debug('Error not retryable', { attempt, error: error.message });
        throw error;
      }

      // Last attempt - don't retry
      if (attempt === maxAttempts) {
        moduleLogger.warn('All retry attempts exhausted', {
          attempt,
          maxAttempts,
          error: error.message
        });
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);

      moduleLogger.debug('Retrying after error', {
        attempt,
        maxAttempts,
        delay,
        error: error.message
      });

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(attempt, error, delay);
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  // Should not reach here, but just in case
  throw lastError;
}

/**
 * Sleep for a specified duration
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable (default implementation)
 *
 * Retries on:
 * - Network errors (ECONNRESET, ETIMEDOUT, etc.)
 * - 5xx server errors
 * - Rate limiting (429)
 *
 * Does NOT retry on:
 * - 4xx client errors (except 429)
 * - Validation errors
 * - Auth errors
 *
 * @param {Error} error - The error to check
 * @returns {boolean} - Whether to retry
 */
export function isRetryableError(error) {
  // Network errors
  const networkErrors = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EPIPE'];
  if (error.code && networkErrors.includes(error.code)) {
    return true;
  }

  // HTTP status codes
  const status = error.status || error.statusCode || error.response?.status;
  if (status) {
    // 429 Too Many Requests - retry
    if (status === 429) return true;

    // 5xx Server Errors - retry
    if (status >= 500 && status < 600) return true;

    // 4xx Client Errors (except 429) - don't retry
    if (status >= 400 && status < 500) return false;
  }

  // Timeout errors
  if (error.message?.includes('timeout') || error.name === 'AbortError') {
    return true;
  }

  // Default: retry on unknown errors (conservative)
  return true;
}

/**
 * Create a retry wrapper with preset options
 *
 * @param {Object} defaultOptions - Default options for all retries
 * @returns {Function} - withRetry function with defaults
 */
export function createRetryWrapper(defaultOptions = {}) {
  return (fn, options = {}) => withRetry(fn, { ...defaultOptions, ...options });
}

/**
 * Retry wrapper specifically for OpenAI calls
 * Uses settings that work well with OpenAI's rate limiting
 */
export const withOpenAIRetry = createRetryWrapper({
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryOn: (error) => {
    // Don't retry auth errors
    if (error.status === 401 || error.status === 403) {
      return false;
    }
    return isRetryableError(error);
  }
});

/**
 * Retry wrapper specifically for Supabase calls
 */
export const withSupabaseRetry = createRetryWrapper({
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
  retryOn: isRetryableError
});

/**
 * Retry wrapper specifically for Telegram calls
 */
export const withTelegramRetry = createRetryWrapper({
  maxAttempts: 2,
  baseDelayMs: 1000,
  maxDelayMs: 5000,
  retryOn: (error) => {
    // Telegram specific: don't retry on bad request
    if (error.message?.includes('400 Bad Request')) {
      return false;
    }
    return isRetryableError(error);
  }
});

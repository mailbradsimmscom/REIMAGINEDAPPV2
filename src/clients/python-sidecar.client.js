// Python Sidecar Client for chat workflow
// Handles HTTP calls to Python sequential workflow endpoint

import { logger as defaultLogger } from '../utils/logger.js';
import * as envConfig from '../config/env.js';

// ============================================
// FACTORY PATTERN - For Dependency Injection
// ============================================

/**
 * Create a Python sidecar client with injected dependencies.
 * Use this in tests to inject mocks.
 *
 * @param {Object} deps - Dependencies (all optional, defaults to real implementations)
 * @returns {Object} Client object with processChatWorkflow and checkChatHealth functions
 *
 * @example
 * // In tests:
 * const mockFetch = async () => new Response(JSON.stringify({ response: 'test' }));
 * const client = createPythonSidecarClient({ fetchFn: mockFetch });
 */
export function createPythonSidecarClient({
  envConfigDep = envConfig,
  logger = defaultLogger,
  fetchFn = fetch  // Allow injecting fetch for testing
} = {}) {

  const requestLogger = logger.createRequestLogger();

  /**
   * Calls Python sidecar chat workflow endpoint
   * @param {Object} params - Configuration object
   * @param {string} params.query - User query
   * @param {Array<Object>} params.systemsContext - Equipment context from memory/search
   * @param {string} params.threadId - Conversation thread ID
   * @param {string} params.conversationSummary - Summary of conversation history
   * @param {Object} params.memoryContext - Memory context (weighted equipment tracking)
   * @returns {Promise<Object>} - Chat response with classification, sources, and metadata
   */
  async function processChatWorkflow({
    query,
    systemsContext = [],
    threadId = null,
    conversationSummary = null,
    memoryContext = null
  }) {
    const env = envConfigDep.getEnv();

  const sidecarUrl = env.PYTHON_SIDECAR_URL || 'http://localhost:8000';
  const endpoint = `${sidecarUrl}/v1/chat/process`;
  const timeoutMs = parseInt(env.PYTHON_CHAT_TIMEOUT_MS || '30000'); // 30s default
  const retryAttempts = parseInt(env.PYTHON_CHAT_RETRY_ATTEMPTS || '2');

  const requestBody = {
    query,
    systems_context: systemsContext,
    thread_id: threadId,
    conversation_summary: conversationSummary,
    memory_context: memoryContext
  };

    return await makePythonSidecarCall(endpoint, requestBody, timeoutMs, retryAttempts);
  }

  /**
   * Makes the actual Python sidecar API call with retry logic
   * @param {string} endpoint - Full endpoint URL
   * @param {Object} requestBody - Request body
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {number} retryAttempts - Number of retry attempts
   * @returns {Promise<Object>} - Python sidecar API response
   */
  async function makePythonSidecarCall(endpoint, requestBody, timeoutMs, retryAttempts) {
  let lastError;

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Python sidecar API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();

      requestLogger.info('Python sidecar chat call successful', {
        attempt,
        endpoint,
        queryLength: requestBody.query?.length || 0,
        systemsCount: requestBody.systems_context?.length || 0,
        hasThreadId: !!requestBody.thread_id
      });

      return data;

    } catch (error) {
      lastError = error;

      // Don't retry on timeout errors or connection refused (service down)
      if (error.name === 'AbortError' ||
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('fetch failed')) {
        requestLogger.error('Python sidecar unreachable or timed out', {
          attempt,
          endpoint,
          error: error.message
        });
        break;
      }

      // Exponential backoff for retries
      if (attempt < retryAttempts) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        requestLogger.warn(`Python sidecar call failed, retrying in ${backoffMs}ms`, {
          attempt,
          error: error.message,
          backoffMs
        });
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  requestLogger.error('Python sidecar call failed after all retries', {
    attempts: retryAttempts,
    endpoint,
    error: lastError?.message
  });

    throw new Error(`Python sidecar call failed after ${retryAttempts} attempts: ${lastError?.message}`);
  }

  /**
   * Health check for Python sidecar chat endpoint
   * @returns {Promise<Object>} - Health status
   */
  async function checkChatHealth() {
    const env = envConfigDep.getEnv();
    const sidecarUrl = env.PYTHON_SIDECAR_URL || 'http://localhost:8000';
    const endpoint = `${sidecarUrl}/v1/chat/health`;

    try {
      const response = await fetchFn(endpoint, {
        method: 'GET',
        signal: AbortSignal.timeout(5000) // 5s timeout
      });

      if (!response.ok) {
        return { status: 'unhealthy', error: `${response.status} ${response.statusText}` };
      }

      const data = await response.json();
      return { status: 'healthy', ...data };
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }

  // Return the client object
  return { processChatWorkflow, checkChatHealth };
}

// ============================================
// DEFAULT INSTANCE - For Backward Compatibility
// ============================================

// Create default instance with real dependencies
const defaultClient = createPythonSidecarClient();

// Export functions directly for backward compatibility
export const { processChatWorkflow, checkChatHealth } = defaultClient;

export default {
  processChatWorkflow,
  checkChatHealth,
  createPythonSidecarClient  // Also export factory for tests
};

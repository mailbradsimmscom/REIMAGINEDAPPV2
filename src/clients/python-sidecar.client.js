// Python Sidecar Client for chat workflow
// Handles HTTP calls to Python sequential workflow endpoint

import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';

const requestLogger = logger.createRequestLogger();

/**
 * Calls Python sidecar chat workflow endpoint
 * @param {Object} params - Configuration object
 * @param {string} params.query - User query
 * @param {Array<Object>} params.systemsContext - Equipment context from memory/search
 * @param {string} params.threadId - Conversation thread ID
 * @param {string} params.conversationSummary - Summary of conversation history
 * @param {Object} params.memoryContext - Memory context (weighted equipment tracking)
 * @param {string} params.synthesisModel - LLM model for synthesis (gpt-5 or gpt-4.1-mini)
 * @returns {Promise<Object>} - Chat response with classification, sources, and metadata
 */
export async function processChatWorkflow({
  query,
  systemsContext = [],
  threadId = null,
  conversationSummary = null,
  memoryContext = null,
  synthesisModel = 'gpt-5'
}) {
  const env = getEnv();

  const sidecarUrl = env.PYTHON_SIDECAR_URL || 'http://localhost:8000';
  const endpoint = `${sidecarUrl}/v1/chat/process`;
  const timeoutMs = parseInt(env.PYTHON_CHAT_TIMEOUT_MS || '30000'); // 30s default
  const retryAttempts = parseInt(env.PYTHON_CHAT_RETRY_ATTEMPTS || '2');

  const requestBody = {
    query,
    systems_context: systemsContext,
    thread_id: threadId,
    conversation_summary: conversationSummary,
    memory_context: memoryContext,
    synthesis_model: synthesisModel
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

      const response = await fetch(endpoint, {
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
export async function checkChatHealth() {
  const env = getEnv();
  const sidecarUrl = env.PYTHON_SIDECAR_URL || 'http://localhost:8000';
  const endpoint = `${sidecarUrl}/v1/chat/health`;

  try {
    const response = await fetch(endpoint, {
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

export default {
  processChatWorkflow,
  checkChatHealth
};

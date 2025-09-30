// src/services/langgraph-integration.service.js
// Integration service that allows switching between current orchestrator and LangGraph POC

import { processUserMessage as processWithCurrentOrchestrator } from './chat-orchestrator.service.js';
import { processUserMessageWithLangGraph } from './langgraph-chat.service.js';
import { logger } from '../utils/logger.js';

/**
 * Feature flag for LangGraph usage
 * Set this to true to use LangGraph, false to use current orchestrator
 */
const USE_LANGGRAPH = process.env.USE_LANGGRAPH === 'true' || false;

/**
 * Main chat processing function that delegates to either LangGraph or current orchestrator
 * @param {string} userQuery - User's query
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Complete chat response
 */
export async function processUserMessage(userQuery, options = {}) {
  const requestLogger = logger.createRequestLogger();

  requestLogger.info(`🔀 [CHAT INTEGRATION] Using ${USE_LANGGRAPH ? 'LangGraph' : 'Current'} orchestrator`, {
    userQuery: userQuery.substring(0, 100),
    useLangGraph: USE_LANGGRAPH
  });

  try {
    if (USE_LANGGRAPH) {
      return await processWithLangGraph(userQuery, options);
    } else {
      return await processWithCurrentOrchestrator(userQuery, options);
    }
  } catch (error) {
    requestLogger.error(`❌ [CHAT INTEGRATION] Processing failed with ${USE_LANGGRAPH ? 'LangGraph' : 'Current'} orchestrator`, {
      error: error.message,
      userQuery: userQuery.substring(0, 100)
    });
    throw error;
  }
}

/**
 * Performance comparison function - runs both orchestrators and compares results
 * @param {string} userQuery - User's query
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Comparison results
 */
export async function compareOrchestrators(userQuery, options = {}) {
  const requestLogger = logger.createRequestLogger();
  const startTime = Date.now();

  requestLogger.info('🔍 [CHAT COMPARISON] Running both orchestrators for comparison', {
    userQuery: userQuery.substring(0, 100)
  });

  const results = {
    userQuery,
    current: null,
    langGraph: null,
    timing: {
      current: null,
      langGraph: null,
      total: null
    },
    errors: {
      current: null,
      langGraph: null
    },
    comparison: null
  };

  // Test current orchestrator
  const currentStart = Date.now();
  try {
    results.current = await processWithCurrentOrchestrator(userQuery, { ...options, sessionId: `comparison-current-${Date.now()}` });
    results.timing.current = Date.now() - currentStart;
    requestLogger.info('✅ [CHAT COMPARISON] Current orchestrator completed', {
      timing: results.timing.current
    });
  } catch (error) {
    results.errors.current = error.message;
    results.timing.current = Date.now() - currentStart;
    requestLogger.error('❌ [CHAT COMPARISON] Current orchestrator failed', {
      error: error.message,
      timing: results.timing.current
    });
  }

  // Test LangGraph orchestrator
  const langGraphStart = Date.now();
  try {
    results.langGraph = await processWithLangGraph(userQuery, { ...options, sessionId: `comparison-langgraph-${Date.now()}` });
    results.timing.langGraph = Date.now() - langGraphStart;
    requestLogger.info('✅ [CHAT COMPARISON] LangGraph orchestrator completed', {
      timing: results.timing.langGraph
    });
  } catch (error) {
    results.errors.langGraph = error.message;
    results.timing.langGraph = Date.now() - langGraphStart;
    requestLogger.error('❌ [CHAT COMPARISON] LangGraph orchestrator failed', {
      error: error.message,
      timing: results.timing.langGraph
    });
  }

  results.timing.total = Date.now() - startTime;

  // Generate comparison summary
  results.comparison = generateComparison(results);

  requestLogger.info('🏁 [CHAT COMPARISON] Comparison completed', {
    totalTime: results.timing.total,
    currentSuccess: !results.errors.current,
    langGraphSuccess: !results.errors.langGraph
  });

  return results;
}

/**
 * Generate comparison analysis
 */
function generateComparison(results) {
  const comparison = {
    performance: null,
    accuracy: null,
    reliability: null,
    summary: []
  };

  // Performance comparison
  if (results.timing.current && results.timing.langGraph) {
    const faster = results.timing.current < results.timing.langGraph ? 'current' : 'langGraph';
    const speedDiff = Math.abs(results.timing.current - results.timing.langGraph);
    const speedPercentDiff = ((speedDiff / Math.min(results.timing.current, results.timing.langGraph)) * 100).toFixed(1);

    comparison.performance = {
      faster,
      speedDifference: speedDiff,
      speedPercentDifference: speedPercentDiff,
      currentTime: results.timing.current,
      langGraphTime: results.timing.langGraph
    };

    comparison.summary.push(`Performance: ${faster} orchestrator is ${speedPercentDiff}% faster (${speedDiff}ms difference)`);
  }

  // Reliability comparison
  const currentSuccess = !results.errors.current;
  const langGraphSuccess = !results.errors.langGraph;

  comparison.reliability = {
    currentSuccess,
    langGraphSuccess,
    bothSucceeded: currentSuccess && langGraphSuccess,
    bothFailed: !currentSuccess && !langGraphSuccess
  };

  if (comparison.reliability.bothSucceeded) {
    comparison.summary.push('Reliability: Both orchestrators completed successfully');
  } else if (comparison.reliability.bothFailed) {
    comparison.summary.push('Reliability: Both orchestrators failed');
  } else if (currentSuccess) {
    comparison.summary.push('Reliability: Only current orchestrator succeeded');
  } else {
    comparison.summary.push('Reliability: Only LangGraph orchestrator succeeded');
  }

  // Response comparison (basic)
  if (results.current?.assistantMessage?.content && results.langGraph?.assistantMessage?.content) {
    const currentLength = results.current.assistantMessage.content.length;
    const langGraphLength = results.langGraph.assistantMessage.content.length;
    const lengthDiff = Math.abs(currentLength - langGraphLength);

    comparison.accuracy = {
      currentResponseLength: currentLength,
      langGraphResponseLength: langGraphLength,
      lengthDifference: lengthDiff,
      similar: lengthDiff < 100 // Simple similarity check
    };

    comparison.summary.push(`Response length: Current ${currentLength} chars, LangGraph ${langGraphLength} chars (${lengthDiff} diff)`);
  }

  return comparison;
}

/**
 * Process user message with LangGraph (wrapper for cleaner naming)
 */
async function processWithLangGraph(userQuery, options) {
  return await processUserMessageWithLangGraph(userQuery, options);
}

/**
 * Get orchestrator status
 */
export function getOrchestratorStatus() {
  return {
    current: USE_LANGGRAPH ? 'standby' : 'active',
    langGraph: USE_LANGGRAPH ? 'active' : 'available',
    canSwitch: true,
    environment: {
      USE_LANGGRAPH: process.env.USE_LANGGRAPH || 'false',
      effectiveValue: USE_LANGGRAPH
    }
  };
}
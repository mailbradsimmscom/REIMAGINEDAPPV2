// src/services/intent-router.service.js
// Intent classification and routing service extracted from enhanced-chat.service.js

import { classifyQueryIntent } from './llm.service.js';
import { logger } from '../utils/logger.js';

/**
 * Classify user query intent and determine processing pipeline
 * @param {string} userQuery - The user's query
 * @returns {Promise<Object>} - Intent classification result
 */
export async function classifyUserIntent(userQuery) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    requestLogger.info('🔍 [INTENT ROUTER] Classifying query intent', { 
      query: userQuery.substring(0, 100) 
    });
    
    const intent = await classifyQueryIntent(userQuery);
    
    requestLogger.info('🎯 [INTENT ROUTER] Intent classified', { 
      intent: intent.intent,
      confidence: intent.confidence,
      reasoning: intent.reasoning
    });
    
    return {
      intent: intent.intent,
      confidence: intent.confidence,
      reasoning: intent.reasoning,
      shouldSummarize: intent.intent === 'summarize',
      shouldGenerateAssetSummary: intent.intent === 'asset_summary'
    };
  } catch (error) {
    requestLogger.warn('⚠️ [INTENT ROUTER] Intent classification failed, using default', { 
      error: error.message,
      query: userQuery.substring(0, 100)
    });
    
    // Fallback to default intent
    return {
      intent: 'chat',
      confidence: 0.5,
      reasoning: 'Intent classification failed, using default chat intent',
      shouldSummarize: false,
      shouldGenerateAssetSummary: false
    };
  }
}

/**
 * Route query to appropriate processing pipeline based on intent
 * @param {string} userQuery - The user's query
 * @param {Object} context - Processing context
 * @returns {Promise<Object>} - Routing decision
 */
export async function routeQuery(userQuery, context = {}) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const intentResult = await classifyUserIntent(userQuery);
    
    // Determine processing pipeline based on intent
    let processingPipeline = 'standard';
    let requiresSpecialHandling = false;
    
    switch (intentResult.intent) {
      case 'summarize':
        processingPipeline = 'summarization';
        requiresSpecialHandling = true;
        break;
      case 'asset_summary':
        processingPipeline = 'asset_summary';
        requiresSpecialHandling = true;
        break;
      case 'chat':
      case 'question':
      case 'clarification':
      default:
        processingPipeline = 'standard';
        requiresSpecialHandling = false;
        break;
    }
    
    requestLogger.info('🚦 [INTENT ROUTER] Query routed', { 
      intent: intentResult.intent,
      pipeline: processingPipeline,
      requiresSpecialHandling,
      confidence: intentResult.confidence
    });
    
    return {
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      reasoning: intentResult.reasoning,
      processingPipeline,
      requiresSpecialHandling,
      shouldSummarize: intentResult.shouldSummarize,
      shouldGenerateAssetSummary: intentResult.shouldGenerateAssetSummary
    };
  } catch (error) {
    requestLogger.error('❌ [INTENT ROUTER] Query routing failed', { 
      error: error.message,
      query: userQuery.substring(0, 100)
    });
    
    // Fallback to standard processing
    return {
      intent: 'chat',
      confidence: 0.5,
      reasoning: 'Intent routing failed, using standard processing',
      processingPipeline: 'standard',
      requiresSpecialHandling: false,
      shouldSummarize: false,
      shouldGenerateAssetSummary: false
    };
  }
}

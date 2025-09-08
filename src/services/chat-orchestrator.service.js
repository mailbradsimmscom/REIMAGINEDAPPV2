// src/services/chat-orchestrator.service.js
// Main chat orchestrator service that coordinates all chat operations

import { searchSystems } from '../repositories/systems.repository.js';
import { enhanceQuery } from './llm.service.js';
import chatRepository from '../repositories/chat.repository.js';
import { logger } from '../utils/logger.js';
import { isSupabaseConfigured, isOpenAIConfigured, isPineconeConfigured } from './guards/index.js';

// Import our new services
import { routeQuery } from './intent-router.service.js';
import { getFactFirstResponse, shouldAttemptFactFirst } from './fact-first.service.js';
import { retrieveWithSpecBias } from './pinecone-retrieval.service.js';
import { generateEnhancedAssistantResponse } from './assistant-response.service.js';
import { summarizeThread, generateThreadName, shouldSummarizeThread } from './summarization.service.js';

// Import utilities
import { 
  isFollowUpQuestion, 
  containsAmbiguousPronoun, 
  extractEquipmentTerms,
  hasExistingSystemsContext,
  getExistingSystemsContext,
  contextRewrite,
  withTimeout
} from '../utils/context-utils.js';

/**
 * Check if required services are available
 * @returns {Promise<void>}
 */
async function checkServiceAvailability() {
  const errors = [];
  
  if (!isSupabaseConfigured()) {
    errors.push('SUPABASE_DISABLED');
  }
  
  if (!isOpenAIConfigured()) {
    errors.push('OPENAI_DISABLED');
  }
  
  if (!isPineconeConfigured()) {
    errors.push('PINECONE_DISABLED');
  }
  
  if (errors.length > 0) {
    const error = new Error(`Required services not configured: ${errors.join(', ')}`);
    error.code = errors[0];
    error.disabledServices = errors;
    throw error;
  }
}

/**
 * Main chat processing function - orchestrates the entire chat flow
 * @param {string} userQuery - User's query
 * @param {Object} options - Processing options
 * @param {string} options.sessionId - Session ID
 * @param {string} options.threadId - Thread ID
 * @param {number} options.contextSize - Context size
 * @returns {Promise<Object>} - Complete chat response
 */
export async function processUserMessage(userQuery, { sessionId, threadId, contextSize = 5 } = {}) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    // Check service availability
    await checkServiceAvailability();
    
    requestLogger.info('🚀 [CHAT ORCHESTRATOR] Processing user message', { 
      userQuery: userQuery.substring(0, 100), 
      sessionId, 
      threadId 
    });
    
    // Step 0: Intent classification and routing
    const routingResult = await routeQuery(userQuery);
    requestLogger.info('🎯 [CHAT ORCHESTRATOR] Intent routed', { 
      intent: routingResult.intent,
      processingPipeline: routingResult.processingPipeline
    });
    
    // Handle special intents
    if (routingResult.requiresSpecialHandling) {
      return await handleSpecialIntent(userQuery, routingResult, { sessionId, threadId, contextSize });
    }
    
    // Step 1: Bootstrap context (systems, messages, thread)
    const context = await bootstrapContext(userQuery, { sessionId, threadId, contextSize });
    
    // Step 2: Fact-first retrieval
    let factResponse = null;
    if (shouldAttemptFactFirst(userQuery, context)) {
      factResponse = await getFactFirstResponse(userQuery, context);
      if (factResponse) {
        return await createFactResponse(factResponse, context);
      }
    }
    
    // Step 3: Pinecone fallback retrieval
    const pineconeResults = await performPineconeRetrieval(userQuery, context);
    
    // Step 4: Generate assistant response
    const assistantResponse = await generateEnhancedAssistantResponse(
      userQuery,
      context.enhancedQuery,
      context.systemsContext,
      pineconeResults.finalists,
      pineconeResults.error,
      context.recentMessages
    );
    
    // Step 5: Store messages and update thread
    const result = await storeMessagesAndUpdateThread(userQuery, assistantResponse, context);
    
    // Step 6: Handle summarization if needed
    await handleSummarizationIfNeeded(context, result);
    
    requestLogger.info('✅ [CHAT ORCHESTRATOR] Message processing completed', { 
      sessionId: result.sessionId,
      threadId: result.threadId,
      factMatch: !!factResponse
    });
    
    return result;
  } catch (error) {
    requestLogger.error('❌ [CHAT ORCHESTRATOR] Message processing failed', { 
      error: error.message,
      userQuery: userQuery.substring(0, 100)
    });
    throw error;
  }
}

/**
 * Handle special intents (summarize, asset_summary)
 * @param {string} userQuery - User query
 * @param {Object} routingResult - Routing result
 * @param {Object} options - Options
 * @returns {Promise<Object>} - Special intent response
 */
async function handleSpecialIntent(userQuery, routingResult, options) {
  const requestLogger = logger.createRequestLogger();
  
  if (routingResult.shouldSummarize) {
    return await handleSummarizationIntent(userQuery, options);
  }
  
  if (routingResult.shouldGenerateAssetSummary) {
    return await handleAssetSummaryIntent(userQuery, options);
  }
  
  // Fallback to standard processing
  return await processUserMessage(userQuery, options);
}

/**
 * Bootstrap context for processing
 * @param {string} userQuery - User query
 * @param {Object} options - Options
 * @returns {Promise<Object>} - Bootstraped context
 */
async function bootstrapContext(userQuery, options) {
  const requestLogger = logger.createRequestLogger();
  
  // Get or create session and thread
  const { sessionId, threadId } = await getOrCreateSessionAndThread(options);
  
  // Get recent messages
  const recentMessages = await chatRepository.getChatMessages(threadId, { limit: options.contextSize });
  
  // Get thread metadata
  const thread = await chatRepository.getChatThread(threadId);
  
  // Determine systems context
  let systemsContext = [];
  let effectiveQuery = userQuery;
  
  if (isFollowUpQuestion(userQuery) || containsAmbiguousPronoun(userQuery)) {
    if (hasExistingSystemsContext(thread.metadata, recentMessages)) {
      systemsContext = getExistingSystemsContext(thread.metadata, recentMessages);
      effectiveQuery = contextRewrite(userQuery, systemsContext);
    } else {
      // Extract equipment terms and search for systems
      const equipmentTerms = extractEquipmentTerms(userQuery);
      systemsContext = await searchSystems(equipmentTerms);
      effectiveQuery = contextRewrite(userQuery, systemsContext);
    }
  } else {
    // Direct search for systems
    systemsContext = await searchSystems(userQuery);
  }
  
  // Enhance query with systems context
  let enhancedQuery = effectiveQuery;
  if (systemsContext.length > 0) {
    try {
      enhancedQuery = await enhanceQuery(effectiveQuery, systemsContext);
    } catch (error) {
      requestLogger.warn('Query enhancement failed, using effective query', { error: error.message });
    }
  }
  
  return {
    sessionId,
    threadId,
    thread,
    recentMessages,
    systemsContext,
    effectiveQuery,
    enhancedQuery,
    userQuery
  };
}

/**
 * Get or create session and thread
 * @param {Object} options - Options
 * @returns {Promise<Object>} - Session and thread IDs
 */
async function getOrCreateSessionAndThread(options) {
  let { sessionId, threadId } = options;
  
  // Get or create session
  if (!sessionId) {
    const session = await chatRepository.createChatSession({
      name: 'New Chat',
      description: 'A new chat session'
    });
    sessionId = session.id;
  }
  
  // Get or create thread
  if (!threadId) {
    const thread = await chatRepository.createChatThread({
      sessionId,
      name: 'New Thread',
      metadata: {}
    });
    threadId = thread.id;
  }
  
  return { sessionId, threadId };
}

/**
 * Perform Pinecone retrieval
 * @param {string} userQuery - User query
 * @param {Object} context - Processing context
 * @returns {Promise<Object>} - Pinecone results
 */
async function performPineconeRetrieval(userQuery, context) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const { getEnv } = await import('../config/env.js');
    const env = getEnv();
    
    const retrievalResult = await retrieveWithSpecBias({
      query: context.enhancedQuery,
      namespace: env.PINECONE_NAMESPACE,
      context: {
        manufacturer: context.systemsContext[0]?.manufacturer,
        model: context.systemsContext[0]?.model,
        previousMessages: context.recentMessages
      }
    });
    
    requestLogger.info('🔍 [CHAT ORCHESTRATOR] Pinecone retrieval completed', { 
      finalistsCount: retrievalResult.finalists.length,
      meta: retrievalResult.meta
    });
    
    return retrievalResult;
  } catch (error) {
    requestLogger.error('❌ [CHAT ORCHESTRATOR] Pinecone retrieval failed', { 
      error: error.message
    });
    
    return {
      finalists: [],
      error: error,
      meta: { error: error.message }
    };
  }
}

/**
 * Create fact-first response
 * @param {Object} factResponse - Fact response
 * @param {Object} context - Processing context
 * @returns {Promise<Object>} - Complete response
 */
async function createFactResponse(factResponse, context) {
  const requestLogger = logger.createRequestLogger();
  
  // Store user message
  const userMessage = await chatRepository.createChatMessage({
    threadId: context.threadId,
    role: 'user',
    content: context.userQuery,
    metadata: {
      originalQuery: context.userQuery,
      enhancedQuery: context.enhancedQuery,
      systemsContext: context.systemsContext.map(s => s.asset_uid),
      factMatch: true,
      factType: factResponse.metadata.factType,
      retrievalMethod: 'fact-first'
    }
  });
  
  // Store assistant message
  const assistantMessage = await chatRepository.createChatMessage({
    threadId: context.threadId,
    role: 'assistant',
    content: factResponse.content,
    metadata: {
      systemsContext: context.systemsContext.map(s => s.asset_uid),
      enhancedQuery: context.enhancedQuery,
      factMatch: true,
      factType: factResponse.metadata.factType,
      retrievalMethod: 'fact-first',
      sources: factResponse.sources
    }
  });
  
  // Update thread
  await chatRepository.updateChatThread(context.threadId, {
    updated_at: new Date().toISOString()
  });
  
  requestLogger.info('✅ [CHAT ORCHESTRATOR] Fact response created', { 
    factType: factResponse.metadata.factType,
    threadId: context.threadId
  });
  
  return {
    sessionId: context.sessionId,
    threadId: context.threadId,
    userMessage: {
      id: userMessage.id,
      content: userMessage.content,
      timestamp: userMessage.created_at
    },
    assistantMessage: {
      id: assistantMessage.id,
      content: assistantMessage.content,
      timestamp: assistantMessage.created_at,
      metadata: assistantMessage.metadata
    },
    systemsContext: context.systemsContext,
    retrievalMeta: {
      factMatch: true,
      factType: factResponse.metadata.factType,
      skippedPinecone: true,
      retrievalMethod: 'fact-first'
    }
  };
}

/**
 * Store messages and update thread
 * @param {string} userQuery - User query
 * @param {Object} assistantResponse - Assistant response
 * @param {Object} context - Processing context
 * @returns {Promise<Object>} - Complete response
 */
async function storeMessagesAndUpdateThread(userQuery, assistantResponse, context) {
  const requestLogger = logger.createRequestLogger();
  
  // Store user message
  const userMessage = await chatRepository.createChatMessage({
    threadId: context.threadId,
    role: 'user',
    content: userQuery,
    metadata: {
      originalQuery: userQuery,
      enhancedQuery: context.enhancedQuery,
      systemsContext: context.systemsContext.map(s => s.asset_uid),
      factMatch: false,
      factType: null,
      retrievalMethod: 'pinecone-fallback'
    }
  });
  
  // Store assistant message
  const assistantMessage = await chatRepository.createChatMessage({
    threadId: context.threadId,
    role: 'assistant',
    content: assistantResponse.content,
    metadata: {
      systemsContext: context.systemsContext.map(s => s.asset_uid),
      enhancedQuery: context.enhancedQuery,
      factMatch: false,
      factType: null,
      retrievalMethod: 'pinecone-fallback',
      sources: assistantResponse.sources,
      styleDetected: assistantResponse.styleDetected
    }
  });
  
  // Update thread
  await chatRepository.updateChatThread(context.threadId, {
    updated_at: new Date().toISOString()
  });
  
  return {
    sessionId: context.sessionId,
    threadId: context.threadId,
    userMessage: {
      id: userMessage.id,
      content: userMessage.content,
      timestamp: userMessage.created_at
    },
    assistantMessage: {
      id: assistantMessage.id,
      content: assistantMessage.content,
      timestamp: assistantMessage.created_at,
      metadata: assistantMessage.metadata
    },
    systemsContext: context.systemsContext,
    retrievalMeta: {
      factMatch: false,
      factType: null,
      skippedPinecone: false,
      retrievalMethod: 'pinecone-fallback'
    }
  };
}

/**
 * Handle summarization if needed
 * @param {Object} context - Processing context
 * @param {Object} result - Processing result
 */
async function handleSummarizationIfNeeded(context, result) {
  const requestLogger = logger.createRequestLogger();
  
  const totalMessages = context.recentMessages.length + 2; // +2 for user and assistant messages
  
  if (shouldSummarizeThread(totalMessages)) {
    try {
      const summary = await summarizeThread(context.recentMessages, context.systemsContext);
      await chatRepository.updateChatThread(context.threadId, {
        metadata: { 
          ...context.thread.metadata,
          summary,
          lastSummarizedAt: new Date().toISOString()
        }
      });
      requestLogger.info('📝 [CHAT ORCHESTRATOR] Conversation summarized', { 
        threadId: context.threadId, 
        summaryLength: summary.length 
      });
    } catch (summaryError) {
      requestLogger.warn('⚠️ [CHAT ORCHESTRATOR] Summary generation failed', { 
        error: summaryError.message,
        threadId: context.threadId 
      });
    }
  }
  
  // Generate thread name if needed
  if (!context.thread.name || context.thread.name === 'New Thread') {
    try {
      const threadName = await generateThreadName(context.recentMessages, context.systemsContext);
      await chatRepository.updateChatThread(context.threadId, { name: threadName });
      requestLogger.info('🏷️ [CHAT ORCHESTRATOR] Thread name generated', { 
        threadId: context.threadId, 
        threadName 
      });
    } catch (nameError) {
      requestLogger.warn('⚠️ [CHAT ORCHESTRATOR] Thread name generation failed', { 
        error: nameError.message,
        threadId: context.threadId 
      });
    }
  }
}

/**
 * Handle summarization intent
 * @param {string} userQuery - User query
 * @param {Object} options - Options
 * @returns {Promise<Object>} - Summarization response
 */
async function handleSummarizationIntent(userQuery, options) {
  // Implementation for summarization intent
  // This would be similar to the existing summarization logic
  throw new Error('Summarization intent not yet implemented');
}

/**
 * Handle asset summary intent
 * @param {string} userQuery - User query
 * @param {Object} options - Options
 * @returns {Promise<Object>} - Asset summary response
 */
async function handleAssetSummaryIntent(userQuery, options) {
  // Implementation for asset summary intent
  // This would be similar to the existing asset summary logic
  throw new Error('Asset summary intent not yet implemented');
}

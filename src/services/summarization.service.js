// src/services/summarization.service.js
// Thread summarization service extracted from enhanced-chat.service.js

import { summarizeConversation, generateChatName, generateAssetSummary } from './llm.service.js';
import { logger } from '../utils/logger.js';

/**
 * Summarize a conversation thread
 * @param {Array} messages - Conversation messages
 * @param {Array} systemsContext - Systems context
 * @returns {Promise<string>} - Generated summary
 */
export async function summarizeThread(messages, systemsContext = []) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    requestLogger.info('📝 [SUMMARIZATION] Starting thread summarization', { 
      messagesCount: messages.length,
      systemsContextCount: systemsContext.length
    });
    
    const summary = await summarizeConversation(messages, systemsContext);
    
    requestLogger.info('✅ [SUMMARIZATION] Thread summarized', { 
      summaryLength: summary.length
    });
    
    return summary;
  } catch (error) {
    requestLogger.error('❌ [SUMMARIZATION] Thread summarization failed', { 
      error: error.message,
      messagesCount: messages.length
    });
    throw error;
  }
}

/**
 * Generate a chat name for a thread
 * @param {Array} messages - Conversation messages
 * @param {Array} systemsContext - Systems context
 * @returns {Promise<string>} - Generated chat name
 */
export async function generateThreadName(messages, systemsContext = []) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    requestLogger.info('🏷️ [SUMMARIZATION] Generating thread name', { 
      messagesCount: messages.length,
      systemsContextCount: systemsContext.length
    });
    
    const threadName = await generateChatName(messages, systemsContext);
    
    requestLogger.info('✅ [SUMMARIZATION] Thread name generated', { 
      threadName
    });
    
    return threadName;
  } catch (error) {
    requestLogger.error('❌ [SUMMARIZATION] Thread name generation failed', { 
      error: error.message,
      messagesCount: messages.length
    });
    
    // Fallback to default name
    return 'New Thread';
  }
}

/**
 * Generate asset summary for a specific system
 * @param {string} assetUid - Asset UID
 * @param {Array} systemsContext - Systems context
 * @returns {Promise<string>} - Generated asset summary
 */
export async function generateSystemSummary(assetUid, systemsContext = []) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    requestLogger.info('📊 [SUMMARIZATION] Generating asset summary', { 
      assetUid,
      systemsContextCount: systemsContext.length
    });
    
    const summary = await generateAssetSummary(assetUid, systemsContext);
    
    requestLogger.info('✅ [SUMMARIZATION] Asset summary generated', { 
      assetUid,
      summaryLength: summary.length
    });
    
    return summary;
  } catch (error) {
    requestLogger.error('❌ [SUMMARIZATION] Asset summary generation failed', { 
      error: error.message,
      assetUid
    });
    throw error;
  }
}

/**
 * Check if thread should be summarized based on message count
 * @param {number} messageCount - Current message count
 * @param {Object} options - Options
 * @param {number} options.summaryFrequency - Frequency for summarization
 * @returns {boolean} - True if should summarize
 */
export function shouldSummarizeThread(messageCount, options = {}) {
  const { summaryFrequency = 5 } = options;
  return messageCount >= summaryFrequency;
}

/**
 * Get summarization metadata for a thread
 * @param {Array} messages - Conversation messages
 * @param {Array} systemsContext - Systems context
 * @returns {Object} - Summarization metadata
 */
export function getSummarizationMetadata(messages, systemsContext = []) {
  return {
    messageCount: messages.length,
    systemsContextCount: systemsContext.length,
    lastMessageTime: messages.length > 0 ? messages[messages.length - 1].created_at : null,
    firstMessageTime: messages.length > 0 ? messages[0].created_at : null,
    threadDuration: messages.length > 1 ? 
      new Date(messages[messages.length - 1].created_at) - new Date(messages[0].created_at) : 0
  };
}

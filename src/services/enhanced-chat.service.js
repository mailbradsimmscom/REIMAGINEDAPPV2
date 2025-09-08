// src/services/enhanced-chat.service.js
// Legacy wrapper that delegates to the new chat orchestrator service
// This maintains backward compatibility while using the new architecture

import { processUserMessage as orchestrateUserMessage } from './chat-orchestrator.service.js';
import { retrieveWithSpecBias as orchestrateRetrieveWithSpecBias } from './pinecone-retrieval.service.js';

/**
 * Legacy processUserMessage function - delegates to new orchestrator
 * @param {string} userQuery - User's query
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Complete chat response
 */
export async function processUserMessage(userQuery, options = {}) {
  return await orchestrateUserMessage(userQuery, options);
}

/**
 * Legacy retrieveWithSpecBias function - delegates to new service
 * @param {Object} params - Retrieval parameters
 * @returns {Promise<Object>} - Retrieval results
 */
export async function retrieveWithSpecBias(params) {
  return await orchestrateRetrieveWithSpecBias(params);
}

// Re-export other functions that might be used elsewhere
export { 
  processUserMessage as handleUserQuery 
} from './chat-orchestrator.service.js';

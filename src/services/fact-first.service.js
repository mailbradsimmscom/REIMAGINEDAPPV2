// src/services/fact-first.service.js
// Fact-first retrieval service using knowledge_facts materialized view

import knowledgeRepository from '../repositories/knowledge.repository.js';
import { formatFactAnswer } from '../utils/formatter.js';
import { logger } from '../utils/logger.js';

/**
 * Check if query matches any facts in the knowledge_facts materialized view
 * @param {string} query - The user query
 * @returns {Promise<Object|null>} - Fact match result or null
 */
export async function findFactMatch(query) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    requestLogger.info('🔍 [FACT-FIRST] Checking knowledge_facts for query', { 
      query: query.substring(0, 100) 
    });
    
    const factMatch = await knowledgeRepository.findFactMatchByQuery(query);
    
    if (factMatch) {
      requestLogger.info('🎯 [FACT-FIRST] Found matching fact', { 
        factType: factMatch.fact_type,
        confidence: factMatch.confidence || 1.0,
        docId: factMatch.doc_id
      });
      
      return {
        fact: factMatch,
        answer: formatFactAnswer(factMatch),
        confidence: factMatch.confidence || 1.0,
        factType: factMatch.fact_type,
        docId: factMatch.doc_id
      };
    } else {
      requestLogger.info('❌ [FACT-FIRST] No matching fact found', { 
        query: query.substring(0, 100) 
      });
      return null;
    }
  } catch (error) {
    requestLogger.warn('⚠️ [FACT-FIRST] Error checking knowledge_facts', { 
      error: error.message,
      query: query.substring(0, 100)
    });
    return null;
  }
}

/**
 * Get fact-first response for a query
 * @param {string} query - The user query
 * @param {Object} context - Additional context
 * @returns {Promise<Object|null>} - Formatted fact response or null
 */
export async function getFactFirstResponse(query, context = {}) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const factResult = await findFactMatch(query);
    
    if (!factResult) {
      return null;
    }
    
    // Create a complete response object
    const response = {
      content: factResult.answer,
      metadata: {
        source: 'knowledge_facts',
        factType: factResult.factType,
        confidence: factResult.confidence,
        docId: factResult.docId,
        retrievalMethod: 'fact-first'
      },
      sources: [{
        type: 'fact',
        factType: factResult.factType,
        confidence: factResult.confidence,
        docId: factResult.docId
      }]
    };
    
    requestLogger.info('✅ [FACT-FIRST] Returning fact answer', { 
      factType: factResult.factType,
      answerLength: factResult.answer.length,
      confidence: factResult.confidence
    });
    
    return response;
  } catch (error) {
    requestLogger.error('❌ [FACT-FIRST] Failed to get fact-first response', { 
      error: error.message,
      query: query.substring(0, 100)
    });
    return null;
  }
}

/**
 * Check if fact-first retrieval should be attempted
 * @param {string} query - The user query
 * @param {Object} context - Additional context
 * @returns {boolean} - True if fact-first should be attempted
 */
export function shouldAttemptFactFirst(query, context = {}) {
  // Always attempt fact-first retrieval for now
  // Could add logic here to skip for certain query types
  return true;
}

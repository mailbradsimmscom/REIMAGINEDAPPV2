/**
 * Answer Formatter Utility
 * Formats fact matches into user-friendly responses
 */

import { logger } from '../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Format a fact match into a user-friendly answer
 */
export function formatFactAnswer(fact) {
  try {
    if (!fact) {
      return 'No fact match found';
    }

    switch (fact.fact_type) {
      case 'spec':
        return formatSpecAnswer(fact);
      
      case 'intent_hint':
        return formatIntentAnswer(fact);
      
      case 'golden_test':
        return formatGoldenTestAnswer(fact);
      
      default:
        return 'Approved fact match found';
    }
  } catch (error) {
    requestLogger.error('Error formatting fact answer', { 
      error: error.message, 
      fact 
    });
    return 'Error formatting answer';
  }
}

/**
 * Format spec suggestion into answer
 */
function formatSpecAnswer(fact) {
  const { key, value, unit, context, page } = fact;
  
  let answer = `${key}: ${value}`;
  if (unit) {
    answer += ` ${unit}`;
  }
  
  // Add context if available
  if (context) {
    answer += ` (${context})`;
  }
  
  // Add page reference if available
  if (page) {
    answer += ` [Page ${page}]`;
  }
  
  return answer;
}

/**
 * Format intent hint into answer
 */
function formatIntentAnswer(fact) {
  const { intent, context, page } = fact;
  
  let answer = `Intent detected: ${intent}`;
  
  // Add context if available
  if (context) {
    answer += ` (${context})`;
  }
  
  // Add page reference if available
  if (page) {
    answer += ` [Page ${page}]`;
  }
  
  return answer;
}

/**
 * Format golden test into answer
 */
function formatGoldenTestAnswer(fact) {
  const { query, expected } = fact;
  
  return `Q: ${query}\nA: ${expected}`;
}

/**
 * Create a structured response object
 */
export function createFactResponse(fact, query) {
  return {
    answer: formatFactAnswer(fact),
    source: 'knowledge_facts',
    confidence: 'high',
    factType: fact.fact_type,
    docId: fact.doc_id,
    approvedAt: fact.approved_at,
    originalQuery: query,
    metadata: {
      page: fact.page,
      context: fact.context,
      confidence: fact.confidence
    }
  };
}

/**
 * Format multiple facts into a comprehensive answer
 */
export function formatMultipleFacts(facts, query) {
  if (!facts || facts.length === 0) {
    return 'No facts found for this query';
  }

  if (facts.length === 1) {
    return formatFactAnswer(facts[0]);
  }

  // Group facts by type
  const groupedFacts = facts.reduce((acc, fact) => {
    if (!acc[fact.fact_type]) {
      acc[fact.fact_type] = [];
    }
    acc[fact.fact_type].push(fact);
    return acc;
  }, {});

  let answer = `Found ${facts.length} relevant facts:\n\n`;
  
  // Add specs
  if (groupedFacts.spec) {
    answer += '**Specifications:**\n';
    groupedFacts.spec.forEach(fact => {
      answer += `• ${formatSpecAnswer(fact)}\n`;
    });
    answer += '\n';
  }
  
  // Add intents
  if (groupedFacts.intent_hint) {
    answer += '**Intent Hints:**\n';
    groupedFacts.intent_hint.forEach(fact => {
      answer += `• ${formatIntentAnswer(fact)}\n`;
    });
    answer += '\n';
  }
  
  // Add golden tests
  if (groupedFacts.golden_test) {
    answer += '**Golden Tests:**\n';
    groupedFacts.golden_test.forEach(fact => {
      answer += `• ${formatGoldenTestAnswer(fact)}\n`;
    });
  }
  
  return answer.trim();
}

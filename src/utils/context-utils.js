// src/utils/context-utils.js
// Context and follow-up detection utilities extracted from enhanced-chat.service.js

/**
 * Check if a query is a follow-up question that needs context
 * @param {string} query - The user query
 * @returns {boolean} - True if it's a follow-up question
 */
export function isFollowUpQuestion(query) {
  const q = query.trim().toLowerCase();
  const patterns = [
    /^(what|which)\s+(pressure|voltage|amperage|wattage|capacity|size|dimensions|weight|temperature|speed|flow|rate)\b/,
    /^(how\s+(much|many|long|fast|hot|cold|big|small|heavy|light))\b/,
    /^how\s+(do|to)\b/,
    /^(can|could|would|should|will)\s+(i|we|you|it|this|that)\b/,
    /^(does|do|is|are|was|were)\s+(it|this|that|there)\b/,
    /^(how|what|does|do|is|are|can)\b.*\b(it|this|that)\b/
  ];
  return patterns.some(rx => rx.test(q));
}

/**
 * Check if query contains ambiguous pronouns
 * @param {string} query - The user query
 * @returns {boolean} - True if contains ambiguous pronouns
 */
export function containsAmbiguousPronoun(query) {
  return /\b(it|this|that|them)\b/i.test(query);
}

/**
 * Extract equipment terms from query by removing common prefixes
 * @param {string} query - The user query
 * @returns {string} - Cleaned query with equipment terms
 */
export function extractEquipmentTerms(query) {
  // Remove common question prefixes and extract core equipment terms
  const cleanedQuery = query.toLowerCase()
    .replace(/tell me about (my |the |a |an )?/g, '')
    .replace(/what is (my |the |a |an )?/g, '')
    .replace(/how does (my |the |a |an )?/g, '')
    .replace(/how to (use |operate |run |start |stop )?/g, '')
    .replace(/show me (the |a |an )?/g, '')
    .replace(/explain (the |a |an )?/g, '')
    .replace(/describe (the |a |an )?/g, '')
    .replace(/^about\s+/g, '')
    .replace(/^the\s+/g, '')
    .trim();
  
  return cleanedQuery;
}

/**
 * Check if we have existing systems context from thread metadata or recent messages
 * @param {Object} threadMetadata - Thread metadata
 * @param {Array} recentMessages - Recent messages
 * @returns {boolean} - True if we have existing systems context
 */
export function hasExistingSystemsContext(threadMetadata, recentMessages) {
  const threadSystemsContext = threadMetadata?.systemsContext || [];
  const recentSystemsContext = recentMessages
    .filter(msg => msg.metadata?.systemsContext && msg.metadata.systemsContext.length > 0)
    .flatMap(msg => msg.metadata.systemsContext);
  
  return threadSystemsContext.length > 0 || recentSystemsContext.length > 0;
}

/**
 * Get existing systems context from thread metadata or recent messages
 * @param {Object} threadMetadata - Thread metadata
 * @param {Array} recentMessages - Recent messages
 * @returns {Array} - Systems context array
 */
export function getExistingSystemsContext(threadMetadata, recentMessages) {
  const threadSystemsContext = threadMetadata?.systemsContext || [];
  const recentSystemsContext = recentMessages
    .filter(msg => msg.metadata?.systemsContext && msg.metadata.systemsContext.length > 0)
    .flatMap(msg => msg.metadata.systemsContext);
  
  // Return the most recent systems context (from recent messages first, then thread metadata)
  if (recentSystemsContext.length > 0) {
    return recentSystemsContext;
  }
  return threadSystemsContext;
}

/**
 * Rewrite query with systems context for better understanding
 * @param {string} query - The user query
 * @param {Array} systemsContext - Systems context array
 * @returns {string} - Rewritten query with context
 */
export function contextRewrite(query, systemsContext) {
  if (!systemsContext?.length) return query;
  
  const sys = systemsContext[0];
  const make = (sys.manufacturer_norm || sys.manufacturer || '').trim();
  const model = (sys.model_norm || sys.model || '').trim();
  const label = [make, model].filter(Boolean).join(' ').trim() || sys.system_norm || 'this system';
  const q = query.trim();
  
  // If the label is already in the query, return as-is
  if (label && new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(q)) {
    return q;
  }
  
  // Replace ambiguous pronouns with specific system reference
  const itRegex = /\b(it|this|that|them)\b/i;
  if (itRegex.test(q)) {
    return q.replace(itRegex, `the ${label}`);
  }
  
  // Add context to common question patterns
  if (/^how\s+does\b/i.test(q)) return q.replace(/^how\s+does\b/i, `how does the ${label}`);
  if (/^how\s+to\b/i.test(q))   return q.replace(/^how\s+to\b/i,   `how to use the ${label}`);
  
  // Default: append context
  return `${q} — ${label}`;
}

/**
 * Create timeout wrapper for promises
 * @param {Promise} promise - The promise to wrap
 * @param {number} ms - Timeout in milliseconds
 * @param {string} onTimeoutMsg - Message for timeout error
 * @returns {Promise} - Promise with timeout
 */
export function withTimeout(promise, ms, onTimeoutMsg = 'Timed out') {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(onTimeoutMsg)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

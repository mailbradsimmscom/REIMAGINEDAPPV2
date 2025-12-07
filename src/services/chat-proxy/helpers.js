// src/services/chat-proxy/helpers.js
//
// Pure helper functions for chat-proxy.service.js
// These have no side effects and can be unit tested in isolation.

/**
 * Extract meaningful keywords from a query by removing stop words.
 * Used to improve equipment search accuracy.
 *
 * @param {string} query - The user's query
 * @returns {string} Space-separated keywords
 *
 * @example
 * extractKeywords('tell me about my Yanmar engine')
 * // Returns: 'yanmar engine'
 */
export function extractKeywords(query) {
  if (!query || typeof query !== 'string') {
    return '';
  }

  const stopWords = new Set([
    'tell', 'me', 'about', 'my', 'the', 'a', 'an', 'is', 'are',
    'what', 'how', 'when', 'where', 'why', 'which', 'who',
    'can', 'could', 'would', 'should', 'will',
    'do', 'does', 'did', 'has', 'have', 'had',
    'be', 'been', 'being',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'from', 'by',
    'it', 'its', 'this', 'that', 'these', 'those'
  ]);

  const words = query.toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));

  return words.join(' ');
}

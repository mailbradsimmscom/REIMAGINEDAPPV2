/**
 * Fuzzy matching utility for handling typos in maintenance tokens and units
 * Uses Levenshtein distance algorithm for approximate string matching
 */

export class FuzzyMatcher {
  constructor(options = {}) {
    this.maxDistance = options.maxDistance || 2;
    this.minLength = options.minLength || 3;
    this.minConfidence = options.minConfidence || 0.6;
  }

  /**
   * Calculate Levenshtein distance between two strings
   * @param {string} a - First string
   * @param {string} b - Second string
   * @returns {number} Edit distance
   */
  levenshteinDistance(a, b) {
    if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);
    
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
    
    // Initialize first row and column
    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
    
    // Fill the matrix
    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // deletion
          matrix[j - 1][i] + 1,     // insertion
          matrix[j - 1][i - 1] + cost // substitution
        );
      }
    }
    
    return matrix[b.length][a.length];
  }

  /**
   * Find the best fuzzy match for input against a list of candidates
   * @param {string} input - Input string to match
   * @param {string[]} candidates - Array of candidate strings
   * @returns {Object|null} Best match object or null if no good match found
   */
  findBestMatch(input, candidates) {
    if (!input || !candidates?.length) return null;
    
    const normalizedInput = input.toLowerCase().trim();
    if (normalizedInput.length < this.minLength) return null;

    let bestMatch = null;
    let bestScore = Infinity;

    for (const candidate of candidates) {
      const normalizedCandidate = candidate.toLowerCase();
      const distance = this.levenshteinDistance(normalizedInput, normalizedCandidate);
      
      if (distance <= this.maxDistance && distance < bestScore) {
        bestScore = distance;
        const confidence = 1 - (distance / Math.max(normalizedInput.length, normalizedCandidate.length));
        
        if (confidence >= this.minConfidence) {
          bestMatch = { 
            original: candidate, 
            distance, 
            confidence,
            normalized: normalizedCandidate
          };
        }
      }
    }

    return bestMatch;
  }

  /**
   * Find multiple fuzzy matches above confidence threshold
   * @param {string} input - Input string to match
   * @param {string[]} candidates - Array of candidate strings
   * @returns {Array} Array of match objects sorted by confidence
   */
  findMultipleMatches(input, candidates) {
    if (!input || !candidates?.length) return [];
    
    const normalizedInput = input.toLowerCase().trim();
    if (normalizedInput.length < this.minLength) return [];

    const matches = [];

    for (const candidate of candidates) {
      const normalizedCandidate = candidate.toLowerCase();
      const distance = this.levenshteinDistance(normalizedInput, normalizedCandidate);
      
      if (distance <= this.maxDistance) {
        const confidence = 1 - (distance / Math.max(normalizedInput.length, normalizedCandidate.length));
        
        if (confidence >= this.minConfidence) {
          matches.push({ 
            original: candidate, 
            distance, 
            confidence,
            normalized: normalizedCandidate
          });
        }
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Check if input is likely a typo of any candidate
   * @param {string} input - Input string to check
   * @param {string[]} candidates - Array of candidate strings
   * @returns {boolean} True if likely typo found
   */
  isLikelyTypo(input, candidates) {
    const match = this.findBestMatch(input, candidates);
    return match !== null;
  }
}

// Default instance for common use cases
export const fuzzyMatcher = new FuzzyMatcher();

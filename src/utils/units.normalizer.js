/**
 * Units normalization utility with fuzzy matching support
 * Handles unit typos and provides canonical unit forms
 */

import fs from 'node:fs/promises';
import { fuzzyMatcher } from './fuzzyMatcher.js';
import { logger } from './logger.js';
import { metrics } from './metrics.js';

// Units lexicon cache
let UNITS_LEXICON = null;

/**
 * Load units lexicon from config file
 * @returns {Object} Units lexicon with canonical forms and aliases
 */
async function loadUnitsLexicon() {
  if (UNITS_LEXICON) return UNITS_LEXICON;
  
  try {
    const url = new URL('../config/lexicons/units.json', import.meta.url);
    UNITS_LEXICON = JSON.parse(await fs.readFile(url, 'utf-8'));
    
    // Build alias → canonical map for fast lookup
    const aliasMap = new Map();
    const disambiguationMap = new Map();
    
    for (const [category, units] of Object.entries(UNITS_LEXICON)) {
      for (const unit of units) {
        for (const alias of unit.aliases) {
          aliasMap.set(alias.toLowerCase(), unit.canonical);
          
          // Store disambiguation hints if available
          if (unit.disambiguateBy) {
            disambiguationMap.set(alias.toLowerCase(), unit.disambiguateBy);
          }
        }
      }
    }
    
    UNITS_LEXICON.__aliasMap = aliasMap;
    UNITS_LEXICON.__disambiguationMap = disambiguationMap;
    
    logger.info('Units lexicon loaded successfully', { 
      categories: Object.keys(UNITS_LEXICON).length - 2, // Subtract __aliasMap and __disambiguationMap
      totalAliases: aliasMap.size
    });
    
  } catch (error) {
    logger.warn('Failed to load units lexicon, using fallback', { error: error.message });
    // Fallback lexicon
    UNITS_LEXICON = {
      pressure: [
        { canonical: "bar", aliases: ["bar"] },
        { canonical: "kPa", aliases: ["kpa", "kPa"] },
        { canonical: "psi", aliases: ["psi"] }
      ],
      power: [
        { canonical: "kW", aliases: ["kw", "kW"] },
        { canonical: "hp", aliases: ["hp", "horsepower"] }
      ],
      __aliasMap: new Map([
        ["bar", "bar"], ["kpa", "kPa"], ["psi", "psi"],
        ["kw", "kW"], ["hp", "hp"], ["horsepower", "hp"]
      ]),
      __disambiguationMap: new Map()
    };
  }
  
  return UNITS_LEXICON;
}

/**
 * Get the unit category for a canonical unit
 * @param {string} canonical - Canonical unit form
 * @param {Object} lexicon - Units lexicon
 * @returns {string} Unit category or 'unknown'
 */
function getUnitCategory(canonical, lexicon) {
  for (const [category, units] of Object.entries(lexicon)) {
    if (category.startsWith('__')) continue;
    if (units.some(unit => unit.canonical === canonical)) {
      return category;
    }
  }
  return 'unknown';
}

/**
 * Check if context hints suggest a specific unit meaning
 * @param {string} unit - Unit to check
 * @param {string} hint - Context hint
 * @param {Object} lexicon - Units lexicon
 * @returns {string|null} Suggested canonical form or null
 */
function checkDisambiguation(unit, hint, lexicon) {
  if (!hint || !lexicon.__disambiguationMap) return null;
  
  const disambiguationHints = lexicon.__disambiguationMap.get(unit.toLowerCase());
  if (!disambiguationHints) return null;
  
  const hintLower = hint.toLowerCase();
  const matches = disambiguationHints.filter(hintWord => hintLower.includes(hintWord));
  
  return matches.length > 0 ? lexicon.__aliasMap.get(unit.toLowerCase()) : null;
}

/**
 * Normalize a unit token with fuzzy matching support
 * @param {string} token - Unit token to normalize
 * @param {Object} options - Options for normalization
 * @param {string} options.hint - Context hint for disambiguation
 * @param {boolean} options.fuzzy - Enable fuzzy matching (default: true)
 * @returns {Object} Normalization result
 */
export async function normalizeUnitToken(token, options = {}) {
  const { hint = '', fuzzy = true } = options;
  const requestLogger = logger.createRequestLogger();
  metrics.startTimer('units_normalization');
  
  if (!token || typeof token !== 'string') {
    metrics.recordSuccess('units_normalization', false, { error: 'invalid_token' });
    metrics.endTimer('units_normalization');
    return { canonical: null, ambiguous: false, fuzzy: false, error: 'Invalid token' };
  }
  
  try {
    const lexicon = await loadUnitsLexicon();
    const normalizedToken = token.toLowerCase().trim();
    
    // Exact match first
    let canonical = lexicon.__aliasMap.get(normalizedToken);
    if (canonical) {
      const category = getUnitCategory(canonical, lexicon);
      
      metrics.recordSuccess('units_normalization', true, { 
        match_type: 'exact',
        category,
        fuzzy: false 
      });
      
      requestLogger.info('Unit exact match found', { 
        token, 
        canonical, 
        category,
        fuzzy: false 
      });
      
      metrics.endTimer('units_normalization');
      return { 
        canonical, 
        ambiguous: false, 
        fuzzy: false,
        category,
        original: token
      };
    }
    
    // Check disambiguation with context hint
    if (hint) {
      const disambiguated = checkDisambiguation(normalizedToken, hint, lexicon);
      if (disambiguated) {
        const category = getUnitCategory(disambiguated, lexicon);
        
        metrics.recordSuccess('units_normalization', true, { 
          match_type: 'disambiguated',
          category,
          fuzzy: false 
        });
        
        requestLogger.info('Unit disambiguated with context', { 
          token, 
          canonical: disambiguated, 
          category,
          hint: hint.substring(0, 50),
          fuzzy: false 
        });
        
        metrics.endTimer('units_normalization');
        return { 
          canonical: disambiguated, 
          ambiguous: false, 
          fuzzy: false,
          category,
          original: token,
          disambiguated: true
        };
      }
    }
    
    // Fuzzy matching if enabled
    if (fuzzy) {
      const allAliases = Array.from(lexicon.__aliasMap.keys());
      const fuzzyMatch = fuzzyMatcher.findBestMatch(normalizedToken, allAliases);
      
      if (fuzzyMatch) {
        canonical = lexicon.__aliasMap.get(fuzzyMatch.normalized);
        const category = getUnitCategory(canonical, lexicon);
        
        metrics.recordSuccess('units_normalization', true, { 
          match_type: 'fuzzy',
          category,
          fuzzy: true,
          confidence: fuzzyMatch.confidence
        });
        
        metrics.incrementCounter('fuzzy_matching', { 
          operation: 'units_normalization',
          type: 'typo_correction'
        });
        
        requestLogger.info('Unit fuzzy match found', { 
          token, 
          canonical, 
          category,
          confidence: fuzzyMatch.confidence,
          matched: fuzzyMatch.original,
          fuzzy: true 
        });
        
        metrics.endTimer('units_normalization');
        return { 
          canonical, 
          ambiguous: false, 
          fuzzy: true,
          confidence: fuzzyMatch.confidence,
          category,
          original: token,
          matched: fuzzyMatch.original
        };
      }
    }
    
    // No match found
    metrics.recordSuccess('units_normalization', false, { 
      reason: 'no_match',
      fuzzy,
      hint_provided: !!hint,
      input_length: normalizedToken.length
    });
    
    requestLogger.info('Unit normalization failed', { 
      token, 
      fuzzy, 
      hint: hint ? 'provided' : 'none',
      inputLength: normalizedToken.length
    });
    
    metrics.endTimer('units_normalization');
    return { 
      canonical: null, 
      ambiguous: false, 
      fuzzy: false,
      original: token
    };
    
  } catch (error) {
    requestLogger.error('Error in unit normalization', { 
      token, 
      error: error.message 
    });
    
    metrics.recordSuccess('units_normalization', false, { 
      error: error.message 
    });
    
    metrics.endTimer('units_normalization');
    return { 
      canonical: null, 
      ambiguous: false, 
      fuzzy: false,
      error: error.message,
      original: token
    };
  }
}

/**
 * Normalize multiple unit tokens in a text
 * @param {string} text - Text containing unit tokens
 * @param {Object} options - Options for normalization
 * @returns {Array} Array of normalization results
 */
export async function normalizeUnitsInText(text, options = {}) {
  if (!text || typeof text !== 'string') return [];
  
  // Extract potential unit tokens (simple regex for now)
  const unitPattern = /\b[a-zA-Z°]+(?:\·|\-|·)?[a-zA-Z°]*\b/g;
  const tokens = text.match(unitPattern) || [];
  
  const results = [];
  for (const token of tokens) {
    const result = await normalizeUnitToken(token, options);
    if (result.canonical) {
      results.push(result);
    }
  }
  
  return results;
}

/**
 * Get all available unit categories
 * @returns {Array} Array of unit categories
 */
export async function getUnitCategories() {
  const lexicon = await loadUnitsLexicon();
  return Object.keys(lexicon).filter(key => !key.startsWith('__'));
}

/**
 * Get all units in a specific category
 * @param {string} category - Unit category
 * @returns {Array} Array of units in the category
 */
export async function getUnitsInCategory(category) {
  const lexicon = await loadUnitsLexicon();
  return lexicon[category] || [];
}

import fs from 'node:fs/promises';
import { fuzzyMatcher } from './fuzzyMatcher.js';
import { logger } from './logger.js';
import { metrics } from './metrics.js';

// Spec-looking tokens: numbers + units
// expand if needed (kPa, gph, L/h, rpm, Ah, Wh, kWh, MPa, etc.)
export const SPEC_RX = /\b(\d+(\.\d+)?)\s?(psi|bar|v|a|kw|w|hz|°c|°f|nm|mm|cm|l\/min)\b/i;

// Maintenance lexicon cache
let MAINTENANCE_LEXICON = null;

/**
 * Load maintenance lexicon from config file
 * @returns {Object} Maintenance lexicon with tokens and regexes
 */
async function loadMaintenanceLexicon() {
  if (MAINTENANCE_LEXICON) return MAINTENANCE_LEXICON;
  
  try {
    const url = new URL('../config/lexicons/maintenance.json', import.meta.url);
    MAINTENANCE_LEXICON = JSON.parse(await fs.readFile(url, 'utf-8'));
    logger.info('Maintenance lexicon loaded successfully', { 
      tokenCount: MAINTENANCE_LEXICON.maintenance_tokens?.length || 0,
      regexCount: MAINTENANCE_LEXICON.interval_regexes?.length || 0
    });
  } catch (error) {
    logger.warn('Failed to load maintenance lexicon, using fallback', { error: error.message });
    // Fallback lexicon
    MAINTENANCE_LEXICON = {
      maintenance_tokens: [
        "filter", "filters", "replace", "replacement", "interval", "maintenance", 
        "service", "hours", "year", "schedule", "flush", "flushing"
      ],
      interval_regexes: [
        "every\\s+\\d+(?:-\\d+)?\\s+(?:hours?|days?|weeks?|months?|years?)",
        "once\\s+per\\s+(?:day|week|month|year)",
        "\\b\\d+\\s*(?:hours?|days?|weeks?|months?|years?)\\b"
      ]
    };
  }
  
  return MAINTENANCE_LEXICON;
}

/**
 * Extract potential maintenance terms from text
 * @param {string} text - Text to analyze
 * @returns {string[]} Array of potential maintenance terms
 */
function extractMaintenanceTerms(text) {
  if (!text || typeof text !== 'string') return [];
  
  // Extract words that could be maintenance terms
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  return words.filter(word => word.length >= 3);
}

/**
 * Check if text contains maintenance-related content using exact and fuzzy matching
 * @param {string} text - Text to check
 * @param {Object} lexicon - Maintenance lexicon
 * @returns {Object} Result with match details
 */
async function checkMaintenanceContent(text, lexicon) {
  if (!text || typeof text !== 'string') return { hasMaintenance: false, matches: [] };
  
  const requestLogger = logger.createRequestLogger();
  const matches = [];
  
  // Check exact matches with maintenance tokens
  const maintTokens = new RegExp(
    `\\b(?:${lexicon.maintenance_tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    'i'
  );
  
  if (maintTokens.test(text)) {
    matches.push({ type: 'exact_token', confidence: 1.0 });
  }
  
  // Check interval regexes
  const intervalRegexes = lexicon.interval_regexes.map(r => new RegExp(r, 'i'));
  const hasInterval = intervalRegexes.some(rx => rx.test(text));
  
  if (hasInterval) {
    matches.push({ type: 'interval_regex', confidence: 1.0 });
  }
  
  // If no exact matches, try fuzzy matching
  if (matches.length === 0) {
    const terms = extractMaintenanceTerms(text);
    for (const term of terms) {
      const fuzzyMatch = fuzzyMatcher.findBestMatch(term, lexicon.maintenance_tokens);
      if (fuzzyMatch) {
        matches.push({ 
          type: 'fuzzy_token', 
          confidence: fuzzyMatch.confidence,
          original: term,
          matched: fuzzyMatch.original
        });
        
        requestLogger.info('Fuzzy maintenance match found', {
          original: term,
          matched: fuzzyMatch.original,
          confidence: fuzzyMatch.confidence
        });
      }
    }
  }
  
  return {
    hasMaintenance: matches.length > 0,
    matches
  };
}

/**
 * Enhanced spec filter that includes maintenance content detection
 * @param {Array} chunks - Array of chunks to filter
 * @returns {Array} Filtered chunks that contain specs or maintenance content
 */
export async function filterSpecLike(chunks) {
  const requestLogger = logger.createRequestLogger();
  metrics.startTimer('maintenance_detection');
  
  if (!Array.isArray(chunks) || chunks.length === 0) {
    metrics.recordSuccess('maintenance_detection', true, { reason: 'empty_input' });
    metrics.endTimer('maintenance_detection');
    return [];
  }
  
  try {
    const lexicon = await loadMaintenanceLexicon();
    
    const filtered = [];
    let specsCount = 0;
    let maintenanceCount = 0;
    let fuzzyMatches = 0;
    let exactMatches = 0;
    
    for (const chunk of chunks) {
      const text = chunk?.chunk?.content ?? chunk?.metadata?.content ?? chunk?.content ?? "";
      
      if (!text) continue;
      
      // Check for spec content (existing logic)
      const hasSpecs = SPEC_RX.test(text);
      
      // Check for maintenance content (new logic)
      const maintenanceResult = await checkMaintenanceContent(text, lexicon);
      
      if (hasSpecs || maintenanceResult.hasMaintenance) {
        const filterReason = hasSpecs ? 'specs' : 'maintenance';
        
        if (hasSpecs) specsCount++;
        if (maintenanceResult.hasMaintenance) maintenanceCount++;
        
        // Count match types
        maintenanceResult.matches.forEach(match => {
          if (match.type === 'fuzzy_token') {
            fuzzyMatches++;
            metrics.incrementCounter('fuzzy_matching', { 
              operation: 'maintenance_detection',
              type: 'typo_correction'
            });
          } else if (match.type === 'exact_token') {
            exactMatches++;
          }
        });
        
        filtered.push({
          ...chunk,
          _filterReason: filterReason,
          _maintenanceMatches: maintenanceResult.matches
        });
      }
    }
    
    // Record metrics
    metrics.recordMetric('maintenance_detection', filtered.length, {
      input_count: chunks.length,
      specs_count: specsCount,
      maintenance_count: maintenanceCount,
      fuzzy_matches: fuzzyMatches,
      exact_matches: exactMatches
    });
    
    metrics.recordSuccess('maintenance_detection', true, {
      input_count: chunks.length,
      output_count: filtered.length,
      specs_count: specsCount,
      maintenance_count: maintenanceCount
    });
    
    requestLogger.info('Enhanced specFilter completed', {
      input: chunks.length,
      output: filtered.length,
      specsCount,
      maintenanceCount,
      fuzzyMatches,
      exactMatches
    });
    
    return filtered;
    
  } catch (error) {
    requestLogger.error('Error in enhanced specFilter', { error: error.message });
    metrics.recordSuccess('maintenance_detection', false, { error: error.message });
    
    // Fallback to original behavior
    const fallbackResult = chunks.filter(h => {
      const text = h?.chunk?.content ?? h?.metadata?.content ?? h?.content ?? "";
      return SPEC_RX.test(text);
    });
    
    metrics.recordSuccess('maintenance_detection', true, { reason: 'fallback' });
    return fallbackResult;
    
  } finally {
    metrics.endTimer('maintenance_detection');
  }
}

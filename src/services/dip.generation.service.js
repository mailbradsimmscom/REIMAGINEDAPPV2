/**
 * DIP (Document Intelligence Packet) generation service
 * Generates DIP and Suggestions files after document processing
 * This service can be called after document ingestion is complete
 */

import { getSupabaseStorageClient } from '../repositories/supabaseClient.js';
import { createDefaultDIP, createDefaultSuggestions } from '../schemas/ingestion.schema.js';
import { logger } from '../utils/logger.js';

const BUCKET = 'documents';

/**
 * Generate DIP and Suggestions for a processed document
 * @param {string} docId - Document ID
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generation result
 */
export async function generateDIPAndSuggestions(docId, options = {}) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    if (!docId || typeof docId !== 'string') {
      throw new Error('Valid document ID is required');
    }
    
    requestLogger.info('Starting DIP and Suggestions generation', { docId });
    
    // Get Supabase Storage client
    const storage = getSupabaseStorageClient();
    if (!storage) {
      throw new Error('Storage service unavailable');
    }
    
    // Get document chunks from Pinecone (via sidecar)
    const chunks = await getDocumentChunks(docId);
    
    // Generate DIP from chunks
    const dip = await generateDIP(docId, chunks, options);
    
    // Generate Suggestions from DIP
    const suggestions = await generateSuggestions(docId, dip, options);
    
    // Store DIP and Suggestions in Supabase Storage
    const storageResults = await Promise.allSettled([
      storeDIP(storage, docId, dip),
      storeSuggestions(storage, docId, suggestions)
    ]);
    
    const result = {
      doc_id: docId,
      dip_generated: storageResults[0].status === 'fulfilled',
      suggestions_generated: storageResults[1].status === 'fulfilled',
      dip_path: `doc_intelligence_packet_${docId}.json`,
      suggestions_path: `ingestion_suggestions_${docId}.json`,
      generated_at: new Date().toISOString(),
      errors: []
    };
    
    // Collect any storage errors
    storageResults.forEach((storageResult, index) => {
      if (storageResult.status === 'rejected') {
        const type = index === 0 ? 'DIP' : 'Suggestions';
        result.errors.push(`${type} storage failed: ${storageResult.reason.message}`);
      }
    });
    
    requestLogger.info('DIP and Suggestions generation completed', {
      docId,
      dipGenerated: result.dip_generated,
      suggestionsGenerated: result.suggestions_generated,
      action: 'generate_dip_suggestions',
      timestamp: result.generated_at
    });
    
    return result;
    
  } catch (error) {
    requestLogger.error('Failed to generate DIP and Suggestions', {
      docId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Get document chunks from Pinecone (via sidecar)
 * @param {string} docId - Document ID
 * @returns {Promise<Array>} Document chunks
 */
async function getDocumentChunks(docId) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    // For now, we'll simulate getting chunks
    // In a real implementation, this would query Pinecone or the sidecar
    const mockChunks = [
      {
        id: `${docId}_page_1_0`,
        content: 'Kenyon BBQ Grill System - Operating Instructions',
        type: 'heading',
        page: 1
      },
      {
        id: `${docId}_page_1_1`,
        content: 'The Kenyon BBQ grill system requires regular maintenance including filter replacement every 100-120 hours.',
        type: 'text',
        page: 1
      },
      {
        id: `${docId}_page_2_0`,
        content: 'Operating pressure: 15 psi. Power consumption: 2.5 kW.',
        type: 'text',
        page: 2
      }
    ];
    
    requestLogger.info('Retrieved document chunks', { docId, chunkCount: mockChunks.length });
    return mockChunks;
    
  } catch (error) {
    requestLogger.error('Failed to get document chunks', { docId, error: error.message });
    throw error;
  }
}

/**
 * Generate DIP from document chunks
 * @param {string} docId - Document ID
 * @param {Array} chunks - Document chunks
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generated DIP
 */
async function generateDIP(docId, chunks, options = {}) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    // Start with default DIP structure
    const dip = createDefaultDIP(docId);
    
    // Extract entities from chunks
    const entities = extractEntities(chunks);
    dip.entities = entities;
    
    // Extract specifications from chunks
    const specifications = extractSpecifications(chunks);
    dip.specifications = specifications;
    
    // Extract maintenance information
    const maintenance = extractMaintenance(chunks);
    dip.maintenance = maintenance;
    
    // Calculate quality metrics
    dip.quality = {
      confidence_score: calculateConfidenceScore(chunks),
      completeness_score: calculateCompletenessScore(chunks),
      accuracy_score: 0.85, // Placeholder
      processing_time_ms: Date.now() - new Date(dip.timestamp).getTime()
    };
    
    requestLogger.info('DIP generated', {
      docId,
      entitiesCount: Object.keys(entities.aliases).length,
      specificationsCount: Object.values(specifications).reduce((sum, arr) => sum + arr.length, 0),
      maintenanceCount: maintenance.intervals.length + maintenance.procedures.length
    });
    
    return dip;
    
  } catch (error) {
    requestLogger.error('Failed to generate DIP', { docId, error: error.message });
    throw error;
  }
}

/**
 * Generate Suggestions from DIP
 * @param {string} docId - Document ID
 * @param {Object} dip - Generated DIP
 * @param {Object} options - Generation options
 * @returns {Promise<Object>} Generated Suggestions
 */
async function generateSuggestions(docId, dip, options = {}) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    // Start with default Suggestions structure
    const suggestions = createDefaultSuggestions(docId);
    
    // Generate entity alias suggestions
    suggestions.entities.add_aliases = generateEntityAliases(dip.entities);
    
    // Generate intent hints
    suggestions.intents.hints = generateIntentHints(dip.maintenance);
    
    // Generate playbook suggestions
    suggestions.playbooks = generatePlaybookSuggestions(dip.maintenance);
    
    // Generate unit suggestions
    suggestions.units.suggest_add = generateUnitSuggestions(dip.specifications);
    
    // Generate golden test suggestions
    suggestions.tests.seed_goldens = generateGoldenTests(dip.maintenance);
    
    // Calculate suggestion quality
    suggestions.suggestion_quality = {
      confidence_score: 0.80,
      impact_score: 0.75,
      risk_score: 0.15
    };
    
    requestLogger.info('Suggestions generated', {
      docId,
      entityAliases: Object.keys(suggestions.entities.add_aliases).length,
      intentHints: suggestions.intents.hints.length,
      playbooks: Object.keys(suggestions.playbooks).length,
      units: suggestions.units.suggest_add.length,
      tests: suggestions.tests.seed_goldens.length
    });
    
    return suggestions;
    
  } catch (error) {
    requestLogger.error('Failed to generate Suggestions', { docId, error: error.message });
    throw error;
  }
}

/**
 * Extract entities from chunks
 * @param {Array} chunks - Document chunks
 * @returns {Object} Extracted entities
 */
function extractEntities(chunks) {
  const entities = {
    manufacturers: [],
    models: [],
    systems: [],
    components: [],
    aliases: {}
  };
  
  // Simple entity extraction (in real implementation, this would use NLP)
  const text = chunks.map(c => c.content).join(' ');
  
  // Extract manufacturers
  const manufacturerMatches = text.match(/\b(Kenyon|ZEN|Marine|Grill)\b/gi);
  if (manufacturerMatches) {
    entities.manufacturers = [...new Set(manufacturerMatches.map(m => m.toLowerCase()))];
  }
  
  // Extract models
  const modelMatches = text.match(/\b(BBQ|150|Grill|System)\b/gi);
  if (modelMatches) {
    entities.models = [...new Set(modelMatches.map(m => m.toLowerCase()))];
  }
  
  // Extract systems
  entities.systems = ['grill system', 'bbq system'];
  
  // Extract components
  entities.components = ['filter', 'burner', 'control panel'];
  
  // Generate aliases
  entities.aliases = {
    'Kenyon': ['kenyon', 'kenyon marine'],
    'BBQ': ['barbecue', 'grill', 'bbq']
  };
  
  return entities;
}

/**
 * Extract specifications from chunks
 * @param {Array} chunks - Document chunks
 * @returns {Object} Extracted specifications
 */
function extractSpecifications(chunks) {
  const specifications = {
    pressure: [],
    power: [],
    flow: [],
    temperature: [],
    dimensions: []
  };
  
  const text = chunks.map(c => c.content).join(' ');
  
  // Extract pressure
  const pressureMatch = text.match(/(\d+)\s*psi/gi);
  if (pressureMatch) {
    specifications.pressure.push({
      value: parseInt(pressureMatch[0]),
      unit: 'psi',
      context: 'operating pressure',
      confidence: 0.95
    });
  }
  
  // Extract power
  const powerMatch = text.match(/(\d+\.?\d*)\s*kW/gi);
  if (powerMatch) {
    specifications.power.push({
      value: parseFloat(powerMatch[0]),
      unit: 'kW',
      context: 'power consumption',
      confidence: 0.90
    });
  }
  
  return specifications;
}

/**
 * Extract maintenance information from chunks
 * @param {Array} chunks - Document chunks
 * @returns {Object} Extracted maintenance info
 */
function extractMaintenance(chunks) {
  const maintenance = {
    intervals: [],
    procedures: [],
    warnings: [],
    cautions: []
  };
  
  const text = chunks.map(c => c.content).join(' ');
  
  // Extract maintenance intervals
  const intervalMatch = text.match(/every\s+(\d+(?:-\d+)?)\s+hours/gi);
  if (intervalMatch) {
    maintenance.intervals.push({
      task: 'filter replacement',
      interval: intervalMatch[0],
      confidence: 0.85
    });
  }
  
  // Extract procedures
  maintenance.procedures.push({
    task: 'cleaning',
    steps: ['turn off power', 'remove debris', 'clean surfaces'],
    confidence: 0.80
  });
  
  // Extract warnings
  maintenance.warnings = ['Do not operate without proper ventilation'];
  
  return maintenance;
}

/**
 * Generate entity alias suggestions
 * @param {Object} entities - Extracted entities
 * @returns {Object} Entity alias suggestions
 */
function generateEntityAliases(entities) {
  const suggestions = {};
  
  // Suggest additional aliases for known entities
  if (entities.manufacturers.includes('kenyon')) {
    suggestions['Kenyon'] = ['kenyon grills', 'kenyon marine grills'];
  }
  
  if (entities.models.includes('bbq')) {
    suggestions['BBQ'] = ['barbecue', 'grill', 'bbq'];
  }
  
  return suggestions;
}

/**
 * Generate intent hints
 * @param {Object} maintenance - Maintenance information
 * @returns {Array} Intent hints
 */
function generateIntentHints(maintenance) {
  const hints = [];
  
  if (maintenance.intervals.length > 0) {
    hints.push({
      intent: 'maintenance',
      raise_to: 0.8,
      reason: 'frequent maintenance terms found'
    });
  }
  
  if (maintenance.procedures.length > 0) {
    hints.push({
      intent: 'procedure',
      raise_to: 0.7,
      reason: 'maintenance procedures detected'
    });
  }
  
  return hints;
}

/**
 * Generate playbook suggestions
 * @param {Object} maintenance - Maintenance information
 * @returns {Object} Playbook suggestions
 */
function generatePlaybookSuggestions(maintenance) {
  const playbooks = {};
  
  if (maintenance.intervals.length > 0) {
    playbooks['maintenance'] = {
      boost_add: ['filter', 'replacement', 'interval'],
      filters_add: ['every\\s+\\d+\\s+hours'],
      confidence: 0.85
    };
  }
  
  return playbooks;
}

/**
 * Generate unit suggestions
 * @param {Object} specifications - Specifications
 * @returns {Array} Unit suggestions
 */
function generateUnitSuggestions(specifications) {
  const suggestions = [];
  
  // Suggest common unit aliases
  suggestions.push({
    alias: 'kilowat',
    suggestedGroup: 'power',
    evidence: 'typo in document',
    count: 3
  });
  
  return suggestions;
}

/**
 * Generate golden test suggestions
 * @param {Object} maintenance - Maintenance information
 * @returns {Array} Golden test suggestions
 */
function generateGoldenTests(maintenance) {
  const tests = [];
  
  if (maintenance.intervals.length > 0) {
    tests.push('How often should I change the filter?');
    tests.push('What is the maintenance schedule?');
  }
  
  if (maintenance.procedures.length > 0) {
    tests.push('How do I clean the system?');
  }
  
  return tests;
}

/**
 * Calculate confidence score
 * @param {Array} chunks - Document chunks
 * @returns {number} Confidence score
 */
function calculateConfidenceScore(chunks) {
  // Simple confidence calculation based on chunk count and content length
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
  const avgLength = totalLength / chunks.length;
  
  // Higher confidence for more chunks and longer average content
  return Math.min(0.95, 0.5 + (chunks.length * 0.05) + (avgLength / 1000 * 0.1));
}

/**
 * Calculate completeness score
 * @param {Array} chunks - Document chunks
 * @returns {number} Completeness score
 */
function calculateCompletenessScore(chunks) {
  // Simple completeness calculation
  const text = chunks.map(c => c.content).join(' ');
  const hasEntities = /\b(Kenyon|BBQ|Grill)\b/i.test(text);
  const hasSpecs = /\b(\d+)\s*(psi|kW)\b/i.test(text);
  const hasMaintenance = /\b(maintenance|filter|replacement)\b/i.test(text);
  
  let score = 0;
  if (hasEntities) score += 0.4;
  if (hasSpecs) score += 0.3;
  if (hasMaintenance) score += 0.3;
  
  return score;
}

/**
 * Store DIP in Supabase Storage
 * @param {Object} storage - Supabase Storage client
 * @param {string} docId - Document ID
 * @param {Object} dip - DIP data
 * @returns {Promise<void>}
 */
async function storeDIP(storage, docId, dip) {
  const fileName = `doc_intelligence_packet_${docId}.json`;
  const filePath = fileName;
  
  const { error } = await storage.storage
    .from(BUCKET)
    .upload(filePath, JSON.stringify(dip, null, 2), {
      contentType: 'application/json',
      upsert: true
    });
  
  if (error) {
    throw new Error(`Failed to store DIP: ${error.message}`);
  }
}

/**
 * Store Suggestions in Supabase Storage
 * @param {Object} storage - Supabase Storage client
 * @param {string} docId - Document ID
 * @param {Object} suggestions - Suggestions data
 * @returns {Promise<void>}
 */
async function storeSuggestions(storage, docId, suggestions) {
  const fileName = `ingestion_suggestions_${docId}.json`;
  const filePath = fileName;
  
  const { error } = await storage.storage
    .from(BUCKET)
    .upload(filePath, JSON.stringify(suggestions, null, 2), {
      contentType: 'application/json',
      upsert: true
    });
  
  if (error) {
    throw new Error(`Failed to store Suggestions: ${error.message}`);
  }
}

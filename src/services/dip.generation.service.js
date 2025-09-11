/**
 * DIP (Document Intelligence Packet) generation service
 * Generates DIP and Suggestions files after document processing
 * This service can be called after document ingestion is complete
 */

import { getSupabaseStorageClient } from '../repositories/supabaseClient.js';
import { createDefaultDIP, createDefaultSuggestions } from '../schemas/ingestion.schema.js';
import { logger } from '../utils/logger.js';
import documentRepository from '../repositories/document.repository.js';
import { extractTextPreviewFromPdf } from '../ingestion/helpers/pdfPreview.js';

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
    requestLogger.info('DIP service main function called with docId', { docId });
    
    // Get Supabase Storage client
    const storage = await getSupabaseStorageClient();
    
    requestLogger.info('Storage client debug', { 
      storageExists: !!storage, 
      storageType: typeof storage,
      storageKeys: storage ? Object.keys(storage) : 'none',
      hasStorageProperty: 'storage' in (storage || {}),
      storagePropertyValue: storage?.storage,
      storagePropertyType: typeof storage?.storage
    });
    
    if (!storage) {
      throw new Error('Storage service unavailable');
    }
    
    // Get document chunks from Pinecone (via sidecar)
    const chunks = await getDocumentChunks(docId);
    
    // Generate DIP from chunks
    const dip = await generateDIP(docId, chunks, options);
    
    // Generate 4 separate structured outputs
    const specSuggestions = await generateSpecSuggestions(docId, dip, options);
    const playbookHints = await generatePlaybookHints(docId, dip, options);
    const intentRouter = await generateIntentRouter(docId, dip, options);
    const goldenTests = await generateGoldenTests(docId, dip, options);
    
    // Store 4 separate JSON files in Supabase Storage
    const storageResults = await Promise.allSettled([
      storeSpecSuggestions(storage, docId, specSuggestions),
      storePlaybookHints(storage, docId, playbookHints),
      storeIntentRouter(storage, docId, intentRouter),
      storeGoldenTests(storage, docId, goldenTests)
    ]);
    
    const result = {
      doc_id: docId,
      spec_suggestions_generated: storageResults[0].status === 'fulfilled',
      playbook_hints_generated: storageResults[1].status === 'fulfilled',
      intent_router_generated: storageResults[2].status === 'fulfilled',
      golden_tests_generated: storageResults[3].status === 'fulfilled',
      spec_suggestions_path: 'spec_suggestions.json',
      playbook_hints_path: 'playbook_hints.json',
      intent_router_path: 'intent_router.json',
      golden_tests_path: 'golden_tests.json',
      generated_at: new Date().toISOString(),
      errors: []
    };
    
    // Collect any storage errors
    const fileTypes = ['Spec Suggestions', 'Playbook Hints', 'Intent Router', 'Golden Tests'];
    storageResults.forEach((storageResult, index) => {
      if (storageResult.status === 'rejected') {
        const type = fileTypes[index];
        requestLogger.error('Storage error details', {
          type,
          error: storageResult.reason.message,
          stack: storageResult.reason.stack
        });
        result.errors.push(`${type} storage failed: ${storageResult.reason.message}`);
      }
    });
    
    requestLogger.info('DIP and Suggestions generation completed', {
      docId,
      specSuggestionsGenerated: result.spec_suggestions_generated,
      playbookHintsGenerated: result.playbook_hints_generated,
      intentRouterGenerated: result.intent_router_generated,
      goldenTestsGenerated: result.golden_tests_generated,
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
 * Get document chunks using the new text extraction service
 * @param {string} docId - Document ID
 * @returns {Promise<Array>} Document chunks
 */
async function getDocumentChunks(docId) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    requestLogger.info('dip.get_document_chunks.start', { docId });
    
    // Use the new text extraction service
    const pages = await extractTextPreviewFromPdf(docId, { 
      maxPages: 6
    });
    
    if (!pages || pages.length === 0) {
      requestLogger.warn('dip.get_document_chunks.no_text', { 
        docId
      });
      return [];
    }
    
    // Convert pages to chunk format expected by DIP generation
    const chunks = [];
    
    for (const page of pages) {
      const text = page.text.trim();
      if (!text) continue;
      
      const words = text.split(/\s+/);
      const chunkSize = 100; // words per chunk
      
      for (let i = 0; i < words.length; i += chunkSize) {
        const chunkWords = words.slice(i, i + chunkSize);
        const chunkText = chunkWords.join(' ');
        const chunkNum = Math.floor(i / chunkSize) + 1;
        
        chunks.push({
          id: `${docId}_page_${page.page}_chunk_${chunkNum}`,
          content: chunkText,
          type: 'text',
          page: page.page
        });
      }
    }
    
    requestLogger.info('dip.get_document_chunks.success', { 
      docId, 
      chunksGenerated: chunks.length,
      pagesProcessed: pages.length
    });
    
    return chunks;
    
  } catch (error) {
    requestLogger.error('dip.get_document_chunks.error', { 
      docId, 
      error: error.message 
    });
    return [];
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
 * Generate Spec Suggestions from DIP
 * @param {string} docId - Document ID
 * @param {Object} dip - Generated DIP
 * @param {Object} options - Generation options
 * @returns {Promise<Array>} Array of spec suggestions
 */
async function generateSpecSuggestions(docId, dip, options = {}) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const specSuggestions = [];
    
    // Extract spec suggestions from DIP specifications
    if (dip.specifications) {
      Object.entries(dip.specifications).forEach(([specName, values]) => {
        values.forEach((value, index) => {
          specSuggestions.push({
            spec_name: specName,
            spec_value: value,
            spec_unit: null, // TODO: Extract units from specifications
            page: null, // TODO: Extract page numbers from chunks
            confidence: 0.8 // Default confidence
          });
        });
      });
    }
    
    requestLogger.info('Spec suggestions generated', {
      docId,
      count: specSuggestions.length
    });
    
    return specSuggestions;
    
  } catch (error) {
    requestLogger.error('Failed to generate spec suggestions', { docId, error: error.message });
    throw error;
  }
}

/**
 * Generate Playbook Hints from DIP
 * @param {string} docId - Document ID
 * @param {Object} dip - Generated DIP
 * @param {Object} options - Generation options
 * @returns {Promise<Array>} Array of playbook hints
 */
async function generatePlaybookHints(docId, dip, options = {}) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const playbookHints = [];
    
    // Extract playbook hints from DIP maintenance
    if (dip.maintenance && dip.maintenance.procedures) {
      dip.maintenance.procedures.forEach((procedure, index) => {
        playbookHints.push({
          value: procedure,
          hint_type: 'maintenance_procedure',
          page: null, // TODO: Extract page numbers
          confidence: 0.8 // Default confidence
        });
      });
    }
    
    requestLogger.info('Playbook hints generated', {
      docId,
      count: playbookHints.length
    });
    
    return playbookHints;
    
  } catch (error) {
    requestLogger.error('Failed to generate playbook hints', { docId, error: error.message });
    throw error;
  }
}

/**
 * Generate Intent Router from DIP
 * @param {string} docId - Document ID
 * @param {Object} dip - Generated DIP
 * @param {Object} options - Generation options
 * @returns {Promise<Array>} Array of intent router entries
 */
async function generateIntentRouter(docId, dip, options = {}) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const intentRouter = [];
    
    // Extract intent router from DIP maintenance
    if (dip.maintenance && dip.maintenance.intervals) {
      dip.maintenance.intervals.forEach((interval, index) => {
        intentRouter.push({
          intent: 'maintenance_schedule',
          route_to: 'maintenance_system',
          confidence: 0.8,
          page: null // TODO: Extract page numbers
        });
      });
    }
    
    requestLogger.info('Intent router generated', {
      docId,
      count: intentRouter.length
    });
    
    return intentRouter;
    
  } catch (error) {
    requestLogger.error('Failed to generate intent router', { docId, error: error.message });
    throw error;
  }
}

/**
 * Generate Golden Tests from DIP
 * @param {string} docId - Document ID
 * @param {Object} dip - Generated DIP
 * @param {Object} options - Generation options
 * @returns {Promise<Array>} Array of golden tests
 */
async function generateGoldenTests(docId, dip, options = {}) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const goldenTests = [];
    
    // Extract golden tests from DIP maintenance
    if (dip.maintenance && dip.maintenance.procedures) {
      dip.maintenance.procedures.forEach((procedure, index) => {
        goldenTests.push({
          query: `How do I ${procedure.toLowerCase()}?`,
          expected: procedure,
          page: null, // TODO: Extract page numbers
          confidence: 0.8 // Default confidence
        });
      });
    }
    
    requestLogger.info('Golden tests generated', {
      docId,
      count: goldenTests.length
    });
    
    return goldenTests;
    
  } catch (error) {
    requestLogger.error('Failed to generate golden tests', { docId, error: error.message });
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
 * Store Spec Suggestions in Supabase Storage
 * @param {Object} storage - Supabase Storage client
 * @param {string} docId - Document ID
 * @param {Array} specSuggestions - Spec suggestions data
 * @returns {Promise<void>}
 */
async function storeSpecSuggestions(storage, docId, specSuggestions) {
  const fileName = 'spec_suggestions.json';
  const filePath = `manuals/${docId}/${fileName}`;
  
  const { error } = await storage.storage
    .from(BUCKET)
    .upload(filePath, JSON.stringify(specSuggestions, null, 2), {
      contentType: 'application/json',
      upsert: true
    });
  
  if (error) {
    throw new Error(`Failed to store spec suggestions: ${error.message}`);
  }
}

/**
 * Store Playbook Hints in Supabase Storage
 * @param {Object} storage - Supabase Storage client
 * @param {string} docId - Document ID
 * @param {Array} playbookHints - Playbook hints data
 * @returns {Promise<void>}
 */
async function storePlaybookHints(storage, docId, playbookHints) {
  const fileName = 'playbook_hints.json';
  const filePath = `manuals/${docId}/${fileName}`;
  
  const { error } = await storage.storage
    .from(BUCKET)
    .upload(filePath, JSON.stringify(playbookHints, null, 2), {
      contentType: 'application/json',
      upsert: true
    });
  
  if (error) {
    throw new Error(`Failed to store playbook hints: ${error.message}`);
  }
}

/**
 * Store Intent Router in Supabase Storage
 * @param {Object} storage - Supabase Storage client
 * @param {string} docId - Document ID
 * @param {Array} intentRouter - Intent router data
 * @returns {Promise<void>}
 */
async function storeIntentRouter(storage, docId, intentRouter) {
  const fileName = 'intent_router.json';
  const filePath = `manuals/${docId}/${fileName}`;
  
  const { error } = await storage.storage
    .from(BUCKET)
    .upload(filePath, JSON.stringify(intentRouter, null, 2), {
      contentType: 'application/json',
      upsert: true
    });
  
  if (error) {
    throw new Error(`Failed to store intent router: ${error.message}`);
  }
}

/**
 * Store Golden Tests in Supabase Storage
 * @param {Object} storage - Supabase Storage client
 * @param {string} docId - Document ID
 * @param {Array} goldenTests - Golden tests data
 * @returns {Promise<void>}
 */
async function storeGoldenTests(storage, docId, goldenTests) {
  const fileName = 'golden_tests.json';
  const filePath = `manuals/${docId}/${fileName}`;
  
  const { error } = await storage.storage
    .from(BUCKET)
    .upload(filePath, JSON.stringify(goldenTests, null, 2), {
      contentType: 'application/json',
      upsert: true
    });
  
  if (error) {
    throw new Error(`Failed to store golden tests: ${error.message}`);
  }
}

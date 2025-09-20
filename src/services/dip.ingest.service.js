import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { logger } from '../utils/logger.js';

/**
 * Service for ingesting DIP JSON outputs into Supabase database tables
 * Handles normalization and insertion of spec_suggestions, playbook_hints, intent_router, and golden_tests
 */

/**
 * Ingest DIP JSON outputs into database tables
 * @param {Object} params - Parameters
 * @param {string} params.docId - Document ID
 * @param {Object} [params.paths] - Optional storage paths from Step 29
 * @returns {Promise<Object>} Summary of insertions
 */
export async function ingestDipOutputsToDb({ docId, paths = null, systemMetadata = null }) {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase client unavailable');
  }

  logger.info('Starting DIP JSON ingestion to database', { docId });

  // Build storage paths if not provided
  const storagePaths = paths || {
    spec_suggestions: `manuals/${docId}/DIP/${docId}_spec_suggestions_an.json`,
    playbook_hints: `manuals/${docId}/DIP/${docId}_playbook_hints_an.json`,
    intent_router: `manuals/${docId}/DIP/${docId}_intent_router_an.json`,
    golden_tests: `manuals/${docId}/DIP/${docId}_golden_rules_an.json`
  };

  const results = {
    doc_id: docId,
    inserted: {
      spec_suggestions: 0,
      playbook_hints: 0,
      intent_router: 0,
      golden_tests: 0
    }
  };

  try {
    // Process each JSON file (skip if path is null)
    const promises = [];
    if (storagePaths.spec_suggestions) {
      promises.push(processSpecSuggestions(supabase, docId, storagePaths.spec_suggestions, results, systemMetadata));
    }
    if (storagePaths.playbook_hints) {
      promises.push(processPlaybookHints(supabase, docId, storagePaths.playbook_hints, results, systemMetadata));
    }
    if (storagePaths.intent_router) {
      promises.push(processIntentRouter(supabase, docId, storagePaths.intent_router, results, systemMetadata));
    }
    if (storagePaths.golden_tests) {
      promises.push(processGoldenTests(supabase, docId, storagePaths.golden_tests, results, systemMetadata));
    }
    
    await Promise.all(promises);

    logger.info('DIP JSON ingestion completed', results);
    return results;

  } catch (error) {
    logger.error('DIP JSON ingestion failed', { docId, error: error.message });
    throw error;
  }
}

/**
 * Process spec_suggestions_an.json and insert into staging_spec_suggestions table
 */
async function processSpecSuggestions(supabase, docId, storagePath, results, systemMetadata) {
  try {
    // Fetch JSON from Supabase Storage
    const jsonData = await fetchJsonFromStorage(supabase, storagePath);
    if (!jsonData || !jsonData.specifications || !Array.isArray(jsonData.specifications) || jsonData.specifications.length === 0) {
      logger.info('No spec_suggestions data to process', { docId });
      return;
    }

    // Clean up existing rows for this doc_id
    const { error: deleteError } = await supabase
      .from('staging_spec_suggestions')
      .delete()
      .eq('doc_id', docId);

    if (deleteError) {
      logger.warn('Failed to cleanup existing spec_suggestions', { docId, error: deleteError.message });
    }

    // Normalize and prepare insert data with Anthropic JSON structure
    const insertData = jsonData.specifications
      .filter(item => {
        // Skip rows with missing required fields
        if (!item.parameter) {
          logger.warn('Skipping spec_suggestion with missing parameter', { docId, item });
          return false;
        }
        return true;
      })
      .map(item => {
        // Convert value to number if possible, otherwise use null
        let convertedValue = null;
        if (item.converted_value !== undefined && item.converted_value !== null) {
          convertedValue = item.converted_value;
        } else if (item.value && item.value !== '.' && item.value !== 'N/A' && item.value !== '---') {
          const numValue = parseFloat(item.value);
          if (!isNaN(numValue)) {
            convertedValue = numValue;
          }
        }
        
        return {
          doc_id: docId,
          manufacturer_norm: systemMetadata?.manufacturer_norm || null,
          model_norm: systemMetadata?.model_norm || null,
          asset_uid: systemMetadata?.asset_uid || null,
          description: item.models ? item.models.join(', ') : '',
          parameter: item.parameter || '',
          normalized_parameter: item.normalized_parameter || '',
          parameter_aliases: item.parameter_aliases || [],
          value: item.value || '',
          range: item.range || '',
          units: item.units || '',
          normalized_units: item.normalized_units || '',
          converted_value: convertedValue,
          category: item.category || '',
          search_terms: item.search_terms || [],
          concept_group: item.concept_group || '',
          references: item.references || [],
          status: 'pending'
        };
      });

    // Batch insert
    const { data, error } = await supabase
      .from('staging_spec_suggestions')
      .insert(insertData);

    if (error) {
      logger.error('Failed to insert spec_suggestions', { docId, error: error.message });
      throw error;
    }

    results.inserted.spec_suggestions = insertData.length;
    logger.info('Spec suggestions processed', { docId, count: insertData.length });

  } catch (error) {
    logger.error('Failed to process spec_suggestions', { docId, error: error.message });
    throw error;
  }
}

/**
 * Process playbook_hints_an.json and insert into staging_playbook_hints table
 */
async function processPlaybookHints(supabase, docId, storagePath, results, systemMetadata) {
  try {
    // Fetch JSON from Supabase Storage
    const jsonData = await fetchJsonFromStorage(supabase, storagePath);
    if (!jsonData || !jsonData.playbook_hints || !Array.isArray(jsonData.playbook_hints) || jsonData.playbook_hints.length === 0) {
      logger.info('No playbook_hints data to process', { docId });
      return;
    }

    // Clean up existing rows for this doc_id
    const { error: deleteError } = await supabase
      .from('staging_playbook_hints')
      .delete()
      .eq('doc_id', docId);

    if (deleteError) {
      logger.warn('Failed to cleanup existing playbook_hints', { docId, error: deleteError.message });
    }

    // Normalize and prepare insert data with Anthropic JSON structure
    const insertData = jsonData.playbook_hints
      .filter(item => {
        // Skip rows with missing required fields
        if (!item.title) {
          logger.warn('Skipping playbook_hint with missing title', { docId, item });
          return false;
        }
        return true;
      })
      .map(item => ({
        doc_id: docId,
        manufacturer_norm: systemMetadata?.manufacturer_norm || null,
        model_norm: systemMetadata?.model_norm || null,
        asset_uid: systemMetadata?.asset_uid || null,
        system_norm: systemMetadata?.system_norm || null,
        subsystem_norm: systemMetadata?.subsystem_norm || null,
        description: item.models ? item.models.join(', ') : '',
        title: item.title || 'Untitled Procedure',
        steps: Array.isArray(item.steps) ? item.steps : [],
        expected_outcome: item.expected_outcome || null,
        preconditions: Array.isArray(item.preconditions) ? item.preconditions : [],
        error_codes: Array.isArray(item.error_codes) ? item.error_codes : [],
        page: item.page || null,
        confidence: typeof item.confidence === 'number' ? item.confidence : null,
        status: 'pending'
      }));

    // Batch insert
    const { data, error } = await supabase
      .from('staging_playbook_hints')
      .insert(insertData);

    if (error) {
      logger.error('Failed to insert playbook_hints', { docId, error: error.message });
      throw error;
    }

    results.inserted.playbook_hints = insertData.length;
    logger.info('Playbook hints processed', { docId, count: insertData.length });

  } catch (error) {
    logger.error('Failed to process playbook_hints', { docId, error: error.message });
    throw error;
  }
}

/**
 * Process intent_router_an.json and insert into staging_intent_router table
 */
async function processIntentRouter(supabase, docId, storagePath, results, systemMetadata) {
  try {
    // Fetch JSON from Supabase Storage
    const jsonData = await fetchJsonFromStorage(supabase, storagePath);
    if (!jsonData || !jsonData.intent_routes || !Array.isArray(jsonData.intent_routes) || jsonData.intent_routes.length === 0) {
      logger.info('No intent_routes data to process', { docId });
      return;
    }

    // Clean up existing rows for this doc_id
    const { error: deleteError } = await supabase
      .from('staging_intent_router')
      .delete()
      .eq('doc_id', docId);

    if (deleteError) {
      logger.warn('Failed to cleanup existing intent_router', { docId, error: deleteError.message });
    }

    // Normalize and prepare insert data with Anthropic JSON structure
    const insertData = jsonData.intent_routes
      .filter(item => {
        // Skip rows with missing required fields
        if (!item.question) {
          logger.warn('Skipping intent_router with missing question', { docId, item });
          return false;
        }
        return true;
      })
      .map(item => ({
        doc_id: docId,
        manufacturer_norm: systemMetadata?.manufacturer_norm || null,
        model_norm: systemMetadata?.model_norm || null,
        asset_uid: systemMetadata?.asset_uid || null,
        description: item.models ? item.models.join(', ') : '',
        question: item.question || '',
        question_variations: item.question_variations || [],
        answer: item.answer || '',
        question_type: item.question_type || '',
        references: item.references || [],
        created_by: 'system',
        status: 'pending'
      }));

    // Batch insert
    const { data, error } = await supabase
      .from('staging_intent_router')
      .insert(insertData);

    if (error) {
      logger.error('Failed to insert intent_router', { docId, error: error.message });
      throw error;
    }

    results.inserted.intent_router = insertData.length;
    logger.info('Intent router processed', { docId, count: insertData.length });

  } catch (error) {
    logger.error('Failed to process intent_router', { docId, error: error.message });
    throw error;
  }
}

/**
 * Process golden_rules_an.json and insert into staging_golden_tests table
 */
async function processGoldenTests(supabase, docId, storagePath, results, systemMetadata) {
  try {
    // Fetch JSON from Supabase Storage
    const jsonData = await fetchJsonFromStorage(supabase, storagePath);
    if (!jsonData || !jsonData.golden_rules || !Array.isArray(jsonData.golden_rules) || jsonData.golden_rules.length === 0) {
      logger.info('No golden_rules data to process', { docId });
      return;
    }

    // Clean up existing rows for this doc_id
    const { error: deleteError } = await supabase
      .from('staging_golden_tests')
      .delete()
      .eq('doc_id', docId);

    if (deleteError) {
      logger.warn('Failed to cleanup existing golden_tests', { docId, error: deleteError.message });
    }

    // Normalize and prepare insert data with Anthropic JSON structure
    const insertData = jsonData.golden_rules
      .filter(item => {
        // Skip rows with missing required fields
        if (!item.query) {
          logger.warn('Skipping golden_rule with missing query', { docId, item });
          return false;
        }
        return true;
      })
      .map(item => ({
        doc_id: docId,
        manufacturer_norm: systemMetadata?.manufacturer_norm || null,
        model_norm: systemMetadata?.model_norm || null,
        asset_uid: systemMetadata?.asset_uid || null,
        description: item.models ? item.models.join(', ') : '',
        query: item.query || '',
        expected: item.expected_value || '',
        test_method: item.test_method || '',
        failure_indication: item.failure_indication || '',
        related_procedures: item.related_procedures || [],
        status: 'pending'
      }));

    // Batch insert
    const { data, error } = await supabase
      .from('staging_golden_tests')
      .insert(insertData);

    if (error) {
      logger.error('Failed to insert golden_tests', { docId, error: error.message });
      throw error;
    }

    results.inserted.golden_tests = insertData.length;
    logger.info('Golden tests processed', { docId, count: insertData.length });

  } catch (error) {
    logger.error('Failed to process golden_tests', { docId, error: error.message });
    throw error;
  }
}

/**
 * Fetch JSON data from Supabase Storage with retry logic for race conditions
 * @param {Object} supabase - Supabase client
 * @param {string} storagePath - Storage path to the JSON file
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} retryDelay - Delay between retries in ms (default: 2000)
 * @returns {Promise<Object>} Parsed JSON data
 */
async function fetchJsonFromStorage(supabase, storagePath, maxRetries = 3, retryDelay = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { data, error } = await supabase.storage
        .from('documents')
        .download(storagePath);

      if (error) {
        if (error.message.includes('404') || error.message.includes('not found')) {
          if (attempt < maxRetries) {
            logger.info(`JSON file not found, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`, { storagePath });
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            continue;
          }
          logger.info('JSON file not found in storage after all retries', { storagePath });
          return null;
        }
        throw error;
      }

      if (!data) {
        if (attempt < maxRetries) {
          logger.info(`No data returned, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`, { storagePath });
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
        logger.info('No data returned from storage after all retries', { storagePath });
        return null;
      }

      const text = await data.text();
      const jsonData = JSON.parse(text);

      // Anthropic JSON files are objects with arrays inside, not arrays directly
      logger.info('JSON file fetched successfully', { storagePath, attempt });
      return jsonData;

    } catch (error) {
      if (error.message.includes('404') || error.message.includes('not found')) {
        if (attempt < maxRetries) {
          logger.info(`JSON file not found, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`, { storagePath });
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
        logger.info('JSON file not found in storage after all retries', { storagePath });
        return null;
      }
      
      if (attempt < maxRetries) {
        logger.warn(`Failed to fetch JSON, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`, { storagePath, error: error.message });
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }
      
      logger.error('Failed to fetch JSON from storage after all retries', { storagePath, error: error.message });
      throw error;
    }
  }
}

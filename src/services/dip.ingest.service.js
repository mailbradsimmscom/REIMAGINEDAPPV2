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
export async function ingestDipOutputsToDb({ docId, paths = null }) {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase client unavailable');
  }

  logger.info('Starting DIP JSON ingestion to database', { docId });

  // Build storage paths if not provided
  const storagePaths = paths || {
    spec_suggestions: `manuals/${docId}/DIP/${docId}_spec_suggestions.json`,
    playbook_hints: `manuals/${docId}/DIP/${docId}_playbook_hints.json`,
    intent_router: `manuals/${docId}/DIP/${docId}_intent_router.json`,
    golden_tests: `manuals/${docId}/DIP/${docId}_golden_tests.json`
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
      promises.push(processSpecSuggestions(supabase, docId, storagePaths.spec_suggestions, results));
    }
    if (storagePaths.playbook_hints) {
      promises.push(processPlaybookHints(supabase, docId, storagePaths.playbook_hints, results));
    }
    if (storagePaths.intent_router) {
      promises.push(processIntentRouter(supabase, docId, storagePaths.intent_router, results));
    }
    if (storagePaths.golden_tests) {
      promises.push(processGoldenTests(supabase, docId, storagePaths.golden_tests, results));
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
 * Process spec_suggestions.json and insert into spec_suggestions table
 */
async function processSpecSuggestions(supabase, docId, storagePath, results) {
  try {
    // Fetch JSON from Supabase Storage
    const jsonData = await fetchJsonFromStorage(supabase, storagePath);
    if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) {
      logger.info('No spec_suggestions data to process', { docId });
      return;
    }

    // Clean up existing rows for this doc_id
    const { error: deleteError } = await supabase
      .from('staging_spec_suggestions')
      .delete()
      .eq('doc_id', docId);

    if (deleteError) {
      logger.warning('Failed to cleanup existing spec_suggestions', { docId, error: deleteError.message });
    }

    // Normalize and prepare insert data with correct schema mapping
    const insertData = jsonData
      .filter(item => {
        // Skip rows with missing required fields
        if (!item.spec_name) {
          logger.warning('Skipping spec_suggestion with missing spec_name', { docId, item });
          return false;
        }
        return true;
      })
      .map(item => {
        // Convert spec_value to number if possible, otherwise use null
        let specValue = null;
        if (item.spec_value && item.spec_value !== '.' && item.spec_value !== 'N/A' && item.spec_value !== '---') {
          const numValue = parseFloat(item.spec_value);
          if (!isNaN(numValue)) {
            specValue = numValue;
          }
        }
        
        return {
          doc_id: docId,
          spec_name: item.spec_name, // Required field
          spec_value: specValue, // Numeric or null
          spec_unit: item.spec_unit || null,
          page: typeof item.page === 'number' ? item.page : null,
          context: item.context || '', // Empty string if not provided
          confidence: typeof item.confidence === 'number' ? item.confidence : null,
          bbox: item.bbox || null,
          status: 'pending' // Always pending for new records
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
 * Process playbook_hints.json and insert into playbook_hints table
 */
async function processPlaybookHints(supabase, docId, storagePath, results) {
  try {
    // Fetch JSON from Supabase Storage
    const jsonData = await fetchJsonFromStorage(supabase, storagePath);
    if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) {
      logger.info('No playbook_hints data to process', { docId });
      return;
    }

    // Clean up existing rows for this doc_id
    const { error: deleteError } = await supabase
      .from('staging_playbook_hints')
      .delete()
      .eq('doc_id', docId);

    if (deleteError) {
      logger.warning('Failed to cleanup existing playbook_hints', { docId, error: deleteError.message });
    }

    // Normalize and prepare insert data
    const insertData = jsonData.map(item => ({
      doc_id: docId,
      test_name: 'Playbook Hint', // Fixed literal as specified
      test_type: 'procedure', // Set to procedure for playbook hints
      description: item.hint || null,
      steps: [], // Empty JSON array as specified
      expected_result: 'See documentation', // Fixed literal as specified
      page: item.page || null,
      confidence: item.confidence || null
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
 * Process intent_router.json and insert into intent_router table
 */
async function processIntentRouter(supabase, docId, storagePath, results) {
  try {
    // Fetch JSON from Supabase Storage
    const jsonData = await fetchJsonFromStorage(supabase, storagePath);
    if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) {
      logger.info('No intent_router data to process', { docId });
      return;
    }

    // Clean up existing rows for this doc_id
    const { error: deleteError } = await supabase
      .from('staging_intent_router')
      .delete()
      .eq('doc_id', docId);

    if (deleteError) {
      logger.warning('Failed to cleanup existing intent_router', { docId, error: deleteError.message });
    }

    // Normalize and prepare insert data
    // Use whatever "pattern-like" field the sidecar provided if present.
    // Fall back to item.intent (but do NOT prefix or duplicate noise).
    const insertData = jsonData
      .map(item => {
        const raw = (item.pattern ?? item.intent ?? item.hint ?? item.description ?? '').toString().trim();
        if (!raw) return null; // skip empties

        return {
          doc_id: docId,
          pattern: raw,          // ← clean, no "[doc:…]" prefix
          intent: null,          // let the cleaner/LLM fill this later
          route_to: null,        // let the cleaner/LLM/system mapping fill
          intent_hint_id: null,
          created_by: 'system'
        };
      })
      .filter(Boolean);

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
 * Process golden_tests.json and insert into golden_tests table
 */
async function processGoldenTests(supabase, docId, storagePath, results) {
  try {
    // Fetch JSON from Supabase Storage
    const jsonData = await fetchJsonFromStorage(supabase, storagePath);
    if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) {
      logger.info('No golden_tests data to process', { docId });
      return;
    }

    // Clean up existing unapproved rows for this doc_id
    const { error: deleteError } = await supabase
      .from('staging_golden_tests')
      .delete()
      .eq('doc_id', docId)
      .is('approved_by', null)
      .is('approved_at', null);

    if (deleteError) {
      logger.warning('Failed to cleanup existing golden_tests', { docId, error: deleteError.message });
    }

    // Normalize and prepare insert data
    const insertData = jsonData.map(item => ({
      doc_id: docId,
      query: item.query || null,
      expected: item.expected || null,
      approved_by: 'system', // Set to 'system' instead of null
      approved_at: null // As specified
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
 * Fetch JSON data from Supabase Storage
 * @param {Object} supabase - Supabase client
 * @param {string} storagePath - Storage path to the JSON file
 * @returns {Promise<Array>} Parsed JSON data
 */
async function fetchJsonFromStorage(supabase, storagePath) {
  try {
    const { data, error } = await supabase.storage
      .from('documents')
      .download(storagePath);

    if (error) {
      if (error.message.includes('404') || error.message.includes('not found')) {
        logger.info('JSON file not found in storage', { storagePath });
        return [];
      }
      throw error;
    }

    if (!data) {
      logger.info('No data returned from storage', { storagePath });
      return [];
    }

    const text = await data.text();
    const jsonData = JSON.parse(text);

    if (!Array.isArray(jsonData)) {
      logger.warning('JSON data is not an array', { storagePath });
      return [];
    }

    return jsonData;

  } catch (error) {
    if (error.message.includes('404') || error.message.includes('not found')) {
      logger.info('JSON file not found in storage', { storagePath });
      return [];
    }
    logger.error('Failed to fetch JSON from storage', { storagePath, error: error.message });
    throw error;
  }
}

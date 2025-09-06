/**
 * Admin DIP generation route
 * Provides endpoint to generate DIP and Suggestions for processed documents
 */

import { Router } from 'express';
import { generateDIPAndSuggestions } from '../services/dip.generation.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * POST /admin/dip/generate/:docId
 * Generate DIP and Suggestions for a document
 */
router.post('/admin/dip/generate/:docId', async (req, res) => {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const { docId } = req.params;
    const { options = {} } = req.body;
    
    if (!docId || typeof docId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid document ID is required',
        requestId: requestLogger.requestId
      });
    }
    
    requestLogger.info('Generating DIP and Suggestions', { docId });
    
    // Generate DIP and Suggestions
    const result = await generateDIPAndSuggestions(docId, options);
    
    requestLogger.info('DIP and Suggestions generation completed', {
      docId,
      dipGenerated: result.dip_generated,
      suggestionsGenerated: result.suggestions_generated
    });
    
    res.json({
      success: true,
      data: result,
      requestId: requestLogger.requestId
    });
    
  } catch (error) {
    requestLogger.error('Failed to generate DIP and Suggestions', {
      docId: req.params.docId,
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to generate DIP and Suggestions',
      details: error.message,
      requestId: requestLogger.requestId
    });
  }
});

/**
 * GET /admin/dip/status/:docId
 * Check if DIP and Suggestions exist for a document
 */
router.get('/admin/dip/status/:docId', async (req, res) => {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const { docId } = req.params;
    
    if (!docId || typeof docId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid document ID is required',
        requestId: requestLogger.requestId
      });
    }
    
    requestLogger.info('Checking DIP status', { docId });
    
    // Check if DIP and Suggestions files exist
    const { getSupabaseStorageClient } = await import('../repositories/supabaseClient.js');
    const storage = getSupabaseStorageClient();
    
    if (!storage) {
      return res.status(500).json({
        success: false,
        error: 'Storage service unavailable',
        requestId: requestLogger.requestId
      });
    }
    
    const [dipExists, suggestionsExists] = await Promise.allSettled([
      checkFileExists(storage, `doc_intelligence_packet_${docId}.json`),
      checkFileExists(storage, `ingestion_suggestions_${docId}.json`)
    ]);
    
    const status = {
      doc_id: docId,
      dip_exists: dipExists.status === 'fulfilled' && dipExists.value,
      suggestions_exists: suggestionsExists.status === 'fulfilled' && suggestionsExists.value,
      checked_at: new Date().toISOString()
    };
    
    requestLogger.info('DIP status checked', {
      docId,
      dipExists: status.dip_exists,
      suggestionsExists: status.suggestions_exists
    });
    
    res.json({
      success: true,
      data: status,
      requestId: requestLogger.requestId
    });
    
  } catch (error) {
    requestLogger.error('Failed to check DIP status', {
      docId: req.params.docId,
      error: error.message
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to check DIP status',
      details: error.message,
      requestId: requestLogger.requestId
    });
  }
});

/**
 * Helper function to check if file exists in storage
 * @param {Object} storage - Supabase Storage client
 * @param {string} fileName - File name to check
 * @returns {Promise<boolean>} True if file exists
 */
async function checkFileExists(storage, fileName) {
  try {
    const { data, error } = await storage.storage
      .from('documents')
      .download(fileName);
    
    return !error && data;
  } catch (error) {
    return false;
  }
}

export default router;

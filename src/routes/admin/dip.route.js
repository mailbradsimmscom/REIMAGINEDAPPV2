/**
 * Admin DIP generation route
 * Provides endpoint to generate DIP and Suggestions for processed documents
 */

import { Router } from 'express';
import { generateDIPAndSuggestions } from '../../services/dip.generation.service.js';
import { logger } from '../../utils/logger.js';
import { z } from 'zod';
import express from 'express';
import { validateResponse } from '../../middleware/validateResponse.js';
import { EnvelopeSchema } from '../../schemas/envelope.schema.js';

const router = Router();

// Add validateResponse middleware
router.use(validateResponse(EnvelopeSchema));

// Probe: always 200 to verify mount path
router.get('/_probe', (req, res) => {
  res.json({ ok: true, where: 'dip' });
});

// Zod schemas
const DocIdParam = z.object({ docId: z.string().min(8) });

/**
 * POST /admin/dip/generate/:docId
 * Generate DIP and Suggestions for a document
 */
router.post('/generate/:docId', express.json({ limit: '1mb' }), async (req, res, next) => {
  try {
    const { docId } = DocIdParam.parse(req.params);
    const { options = {} } = req.body;
    
    const requestLogger = logger.createRequestLogger();
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
    next(error);
  }
});

/**
 * GET /admin/dip/status/:docId
 * Check if DIP and Suggestions exist for a document
 */
router.get('/status/:docId', async (req, res, next) => {
  try {
    const { docId } = DocIdParam.parse(req.params);
    
    const requestLogger = logger.createRequestLogger();
    requestLogger.info('Checking DIP status', { docId });
    
    // Check if DIP and Suggestions files exist
    const { getSupabaseStorageClient } = await import('../../repositories/supabaseClient.js');
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
    next(error);
  }
});

/**
 * GET /admin/dip/download/:docId
 * Download DIP file for a document
 */
router.get('/download/:docId', async (req, res, next) => {
  try {
    const { docId } = DocIdParam.parse(req.params);
    
    const requestLogger = logger.createRequestLogger();
    requestLogger.info('Downloading DIP', { docId });
    
    // Get Supabase Storage client
    const { getSupabaseStorageClient } = await import('../../repositories/supabaseClient.js');
    const storage = getSupabaseStorageClient();
    
    if (!storage) {
      return res.status(500).json({
        success: false,
        error: 'Storage service unavailable',
        requestId: requestLogger.requestId
      });
    }
    
    const fileName = `doc_intelligence_packet_${docId}.json`;
    const { data, error } = await storage.storage
      .from('documents')
      .download(fileName);
    
    if (error || !data) {
      return res.status(404).json({
        success: false,
        error: 'DIP file not found',
        requestId: requestLogger.requestId
      });
    }
    
    // Convert blob to buffer
    const buffer = await data.arrayBuffer();
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(buffer));
    
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/suggestions/download/:docId
 * Download Suggestions file for a document
 */
router.get('/suggestions/download/:docId', async (req, res, next) => {
  try {
    const { docId } = DocIdParam.parse(req.params);
    
    const requestLogger = logger.createRequestLogger();
    requestLogger.info('Downloading Suggestions', { docId });
    
    // Get Supabase Storage client
    const { getSupabaseStorageClient } = await import('../../repositories/supabaseClient.js');
    const storage = getSupabaseStorageClient();
    
    if (!storage) {
      return res.status(500).json({
        success: false,
        error: 'Storage service unavailable',
        requestId: requestLogger.requestId
      });
    }
    
    const fileName = `ingestion_suggestions_${docId}.json`;
    const { data, error } = await storage.storage
      .from('documents')
      .download(fileName);
    
    if (error || !data) {
      return res.status(404).json({
        success: false,
        error: 'Suggestions file not found',
        requestId: requestLogger.requestId
      });
    }
    
    // Convert blob to buffer
    const buffer = await data.arrayBuffer();
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(buffer));
    
  } catch (error) {
    next(error);
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

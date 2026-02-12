import express from 'express';
import { logger } from '../../utils/logger.js';
import { sidecarFetch } from '../../utils/sidecar-fetch.js';
import { adminGate } from '../../middleware/admin.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

/**
 * GET /admin/pinecone-admin/models
 * Get all models with manual=true and their chunk counts from Pinecone
 */
router.get('/models', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();

  try {
    // Get all systems with manual=true
    const supabase = await getSupabaseClient();
    const { data: systems, error } = await supabase
      .from('systems')
      .select('manufacturer_norm, model_norm')
      .eq('manual', true)
      .order('manufacturer_norm');

    if (error) throw error;

    // Get Python sidecar URL
    const { getEnv } = await import('../../config/env.js');
    const { PYTHON_SIDECAR_URL = 'http://localhost:8000', PINECONE_NAMESPACE = 'REIMAGINEDDOCS' } = getEnv();

    // Query Pinecone for chunk count for each model
    const modelsWithCounts = await Promise.all(
      systems.map(async (system) => {
        try {
          const response = await sidecarFetch('/v1/pinecone/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: 'test',
              topK: 10000,
              namespace: PINECONE_NAMESPACE,
              filter: { primary_models: system.model_norm },
              includeMetadata: false,
              includeValues: false
            })
          });

          const data = await response.json();
          const chunkCount = data.matches?.length || 0;

          return {
            manufacturer: system.manufacturer_norm,
            model: system.model_norm,
            chunkCount
          };
        } catch (error) {
          requestLogger.error('Failed to get chunk count', {
            model: system.model_norm,
            error: error.message
          });
          return {
            manufacturer: system.manufacturer_norm,
            model: system.model_norm,
            chunkCount: 0
          };
        }
      })
    );

    return res.json({
      success: true,
      data: modelsWithCounts,
      requestId: requestLogger.requestId
    });
  } catch (error) {
    requestLogger.error('Failed to get models', { error: error.message });
    next(error);
  }
});

/**
 * POST /admin/pinecone-admin/chunks
 * Get all chunks for a specific model
 */
router.post('/chunks', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { model } = req.body;

    if (!model) {
      return res.status(400).json({
        success: false,
        error: 'model is required',
        requestId: requestLogger.requestId
      });
    }

    // Get Python sidecar URL
    const { getEnv } = await import('../../config/env.js');
    const { PYTHON_SIDECAR_URL = 'http://localhost:8000', PINECONE_NAMESPACE = 'REIMAGINEDDOCS' } = getEnv();

    const response = await sidecarFetch('/v1/pinecone/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'test',
        topK: 10000,
        namespace: PINECONE_NAMESPACE,
        filter: { primary_models: model },
        includeMetadata: true,
        includeValues: false
      })
    });

    const data = await response.json();

    return res.json({
      success: true,
      data: {
        model,
        chunks: data.matches || [],
        count: data.matches?.length || 0
      },
      requestId: requestLogger.requestId
    });
  } catch (error) {
    requestLogger.error('Failed to get chunks', { error: error.message });
    next(error);
  }
});

/**
 * DELETE /admin/pinecone-admin/chunks
 * Delete chunks by vector IDs
 */
router.delete('/chunks', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { vectorIds } = req.body;

    if (!vectorIds || !Array.isArray(vectorIds) || vectorIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'vectorIds array is required',
        requestId: requestLogger.requestId
      });
    }

    // Get Python sidecar URL
    const { getEnv } = await import('../../config/env.js');
    const { PYTHON_SIDECAR_URL = 'http://localhost:8000', PINECONE_NAMESPACE = 'REIMAGINEDDOCS' } = getEnv();

    const response = await sidecarFetch('/v1/pinecone/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: vectorIds,
        namespace: PINECONE_NAMESPACE
      })
    });

    const data = await response.json();

    requestLogger.info('Deleted Pinecone vectors', {
      count: vectorIds.length,
      namespace: PINECONE_NAMESPACE
    });

    return res.json({
      success: true,
      data: {
        deletedCount: vectorIds.length,
        vectorIds
      },
      requestId: requestLogger.requestId
    });
  } catch (error) {
    requestLogger.error('Failed to delete chunks', { error: error.message });
    next(error);
  }
});

export default router;

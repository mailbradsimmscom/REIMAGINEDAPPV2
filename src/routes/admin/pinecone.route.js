import express from 'express';
import { logger } from '../../utils/logger.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { AdminPineconeEnvelope } from '../../schemas/admin.schema.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { z } from 'zod';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// Apply response validation to all routes in this file
router.use(validateResponse(AdminPineconeEnvelope));

// Admin pinecone query schema
const adminPineconeQuerySchema = z.object({}).passthrough();

// GET /admin/pinecone - Get Pinecone status
router.get('/', 
  validate(adminPineconeQuerySchema, 'query'),
  async (req, res, next) => {
  try {
    const requestLogger = logger.createRequestLogger();
    const { getEnv } = await import('../../config/env.js');
    const { PYTHON_SIDECAR_URL = 'http://localhost:8000', PINECONE_INDEX, PINECONE_NAMESPACE = '__default__' } = getEnv();
    
    // Check sidecar health
    let sidecarHealth = { status: 'unknown', error: null };
    try {
      const healthResponse = await fetch(`${PYTHON_SIDECAR_URL}/health`);
      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        sidecarHealth = { 
          status: 'healthy', 
          version: healthData.version,
          tesseractAvailable: healthData.tesseract_available
        };
      } else {
        sidecarHealth = { status: 'unhealthy', error: `HTTP ${healthResponse.status}` };
      }
    } catch (error) {
      sidecarHealth = { status: 'unreachable', error: error.message };
    }
    
    // First check health
    const healthResponse = await fetch(`${PYTHON_SIDECAR_URL}/health`);
    if (!healthResponse.ok) {
      throw new Error(`Sidecar health check failed: ${healthResponse.status}`);
    }
    
    const healthData = await healthResponse.json();
    
    // Then get Pinecone stats
    const statsResponse = await fetch(`${PYTHON_SIDECAR_URL}/v1/pinecone/stats`);
    let statsData = null;
    
    if (statsResponse.ok) {
      statsData = await statsResponse.json();
      requestLogger.info('Pinecone stats retrieved', { 
        totalVectors: statsData?.total_vector_count,
        dimension: statsData?.dimension
      });
    } else {
      requestLogger.warn('Failed to get Pinecone stats', { 
        status: statsResponse.status,
        statusText: statsResponse.statusText 
      });
    }
    
    // Get basic Pinecone info from environment
    const pineconeData = {
      status: healthData.status === 'healthy' ? 'Connected' : 'Disconnected',
      index: PINECONE_INDEX,
      namespace: PINECONE_NAMESPACE,
      vectors: statsData?.total_vector_count || 'N/A',
      totalVectors: statsData?.total_vector_count || 0,
      dimension: statsData?.dimension || 'N/A',
      indexFullness: '0.0%',
      lastChecked: new Date().toISOString(),
      sidecarHealth: sidecarHealth
    };

    const envelope = {
      success: true,
      data: pineconeData
    };

    return enforceResponse(res, envelope);
    
    requestLogger.info('Pinecone status retrieved', { 
      status: pineconeData.status,
      index: pineconeData.index,
      vectorCount: pineconeData.vectors
    });
    
  } catch (error) {
    next(error);
  }
});

// Method not allowed for all other methods
router.all('/', (req, res) => {
  return enforceResponse(res, {
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  }, 405);
});

export default router;

import express from 'express';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import { adminGate } from '../../middleware/admin.js';
import { adminPineconeResponseSchema } from '../../schemas/admin.schema.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { z } from 'zod';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

const EnvelopeOk = z.object({
  success: z.literal(true),
  data: z.any()
});

// GET /admin/pinecone - Get Pinecone status
router.get('/', async (req, res, next) => {
  try {
    const requestLogger = logger.createRequestLogger();
    const sidecarUrl = env.sidecarUrl || 'http://localhost:8000';
    
    // Check sidecar health
    let sidecarHealth = { status: 'unknown', error: null };
    try {
      const healthResponse = await fetch(`${sidecarUrl}/health`);
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
    const healthResponse = await fetch(`${sidecarUrl}/health`);
    if (!healthResponse.ok) {
      throw new Error(`Sidecar health check failed: ${healthResponse.status}`);
    }
    
    const healthData = await healthResponse.json();
    
    // Then get Pinecone stats
    const statsResponse = await fetch(`${sidecarUrl}/v1/pinecone/stats`);
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
      index: env.pineconeIndex,
      namespace: env.pineconeNamespace,
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

    res.json(enforceResponse(EnvelopeOk, envelope));
    
    requestLogger.info('Pinecone status retrieved', { 
      status: pineconeData.status,
      index: pineconeData.index,
      vectorCount: pineconeData.vectors
    });
    
  } catch (error) {
    next(error);
  }
});

export default router;

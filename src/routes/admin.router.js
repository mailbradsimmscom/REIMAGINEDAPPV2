import express from 'express';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { adminGate } from '../middleware/admin.js';
import { 
  adminLogsQuerySchema, 
  adminLogsResponseSchema, 
  adminSystemsResponseSchema, 
  adminPineconeResponseSchema,
  adminJobsResponseSchema,
  adminDocumentsResponseSchema,
  adminManufacturersResponseSchema,
  adminModelsQuerySchema,
  adminModelsResponseSchema
} from '../schemas/admin.schema.js';

const router = express.Router();

// Apply admin gate middleware to all admin routes
router.use(adminGate);

// GET /admin - Admin dashboard page
router.get('/', async (req, res, next) => {
  try {
    const adminHtmlPath = join(process.cwd(), 'src/public/admin.html');
    const content = await fs.readFile(adminHtmlPath);
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Admin dashboard not found' });
  }
});

// GET /admin/health - Get system health status
router.get('/health', async (req, res, next) => {
  try {
    const healthData = {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: env.nodeEnv,
      version: env.appVersion
    };

    const responseData = {
      success: true,
      data: healthData
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /admin/logs - Get log files
router.get('/logs', async (req, res, next) => {
  try {
    const { level, limit, correlationId } = req.query;
    
    // Build query parameters object
    const queryParams = {};
    if (level !== undefined) queryParams.level = level;
    if (limit !== undefined) queryParams.limit = limit;
    if (correlationId !== undefined) queryParams.correlationId = correlationId;

    // Validate query parameters
    const validationResult = adminLogsQuerySchema.safeParse(queryParams);
    
    if (!validationResult.success) {
      const error = new Error('Invalid query parameters');
      error.name = 'ZodError';
      error.errors = validationResult.error.errors;
      throw error;
    }

    // TODO: Implement actual log retrieval
    const logsData = {
      logs: [],
      count: 0,
      level: level || 'all',
      limit: limit || 100
    };

    const responseData = {
      success: true,
      data: logsData
    };

    // Validate response data
    // TODO: Re-enable response validation after debugging
    // const responseValidation = adminLogsResponseSchema.safeParse(responseData);
    // if (!responseValidation.success) {
    //   throw new Error('Invalid response format');
    // }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /admin/systems - Get systems statistics
router.get('/systems', async (req, res, next) => {
  try {
    const supabase = getSupabaseClient();
    const { count: documentsCount } = await supabase.from('documents').select('*', { count: 'exact', head: true });
    const { count: jobsCount } = await supabase.from('jobs').select('*', { count: 'exact', head: true });
    const { count: totalSystems } = await supabase.from('systems').select('*', { count: 'exact', head: true });

    const systemsData = {
      totalSystems: totalSystems || 0,
      lastUpdated: new Date().toISOString(),
      databaseStatus: 'connected',
      documentsCount: documentsCount || 0,
      jobsCount: jobsCount || 0
    };

    const responseData = {
      success: true,
      data: systemsData
    };

    // Validate response data
    // TODO: Re-enable response validation after debugging
    // const responseValidation = adminSystemsResponseSchema.safeParse(responseData);
    // if (!responseValidation.success) {
    //   throw new Error('Invalid response format');
    // }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /admin/manufacturers - Get manufacturers statistics
router.get('/manufacturers', async (req, res, next) => {
  try {
    const supabase = getSupabaseClient();
    
    // Get manufacturers count
    const { count: manufacturersCount } = await supabase
      .from('systems')
      .select('manufacturer_norm', { count: 'exact', head: true });

    // Get top manufacturers
    const { data: topManufacturers } = await supabase
      .from('systems')
      .select('manufacturer_norm')
      .not('manufacturer_norm', 'is', null)
      .order('manufacturer_norm', { ascending: true });

    const manufacturersData = {
      total: manufacturersCount || 0,
      top: topManufacturers || [],
      lastUpdated: new Date().toISOString()
    };

    const responseData = {
      success: true,
      data: manufacturersData
    };

    // Validate response data
    const responseValidation = adminManufacturersResponseSchema.safeParse(responseData);
    if (!responseValidation.success) {
      throw new Error('Invalid response format');
    }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /admin/models - Get models statistics
router.get('/models', async (req, res, next) => {
  try {
    const { manufacturer } = req.query;
    
    // Validate query parameters
    // TODO: Re-enable query validation after debugging
    // const validationResult = adminModelsQuerySchema.safeParse({ manufacturer });
    // 
    // if (!validationResult.success) {
    //   const error = new Error('Invalid query parameters');
    //   error.name = 'ZodError';
    //   error.errors = validationResult.error.errors;
    //   throw error;
    // }

    const supabase = getSupabaseClient();
    
    let query = supabase
      .from('systems')
      .select('model_norm, manufacturer_norm')
      .not('model_norm', 'is', null);

    if (manufacturer) {
      query = query.eq('manufacturer_norm', manufacturer);
    }

    const { data: models } = await query.order('model_norm', { ascending: true });

    const modelsData = {
      models: models || [],
      count: models?.length || 0,
      manufacturer: manufacturer || 'all',
      lastUpdated: new Date().toISOString()
    };

    const responseData = {
      success: true,
      data: modelsData
    };

    // Validate response data
    const responseValidation = adminModelsResponseSchema.safeParse(responseData);
    if (!responseValidation.success) {
      throw new Error('Invalid response format');
    }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /admin/pinecone - Get Pinecone status
router.get('/pinecone', async (req, res, next) => {
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

    const responseData = {
      success: true,
      data: pineconeData
    };

    // Validate response data
    // TODO: Re-enable response validation after debugging
    // const responseValidation = adminPineconeResponseSchema.safeParse(responseData);
    // if (!responseValidation.success) {
    //   throw new Error('Invalid response format');
    // }
    
    res.json(responseData);
    
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

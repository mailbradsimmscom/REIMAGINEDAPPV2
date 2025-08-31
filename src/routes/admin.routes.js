import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { getSupabaseClient } from '../repositories/supabaseClient.js';

// Admin authentication middleware (simple for now)
function requireAdmin(req, res, next) {
  // TODO: Implement proper admin authentication
  // For now, allow access to admin routes
  next();
}

// Get admin dashboard page
export async function adminDashboardRoute(req, res) {
  try {
    const adminHtmlPath = join(process.cwd(), 'src/public/admin.html');
    const content = await fs.readFile(adminHtmlPath);
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Admin dashboard not found' }));
  }
}

// Get system health status
export async function adminHealthRoute(req, res) {
  try {
    const healthData = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: env.nodeEnv,
      version: env.appVersion
    };

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: healthData
    }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      error: error.message,
      type: 'admin_health_error'
    }));
  }
}

// Get log files (real implementation)
export async function adminLogsRoute(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const level = url.searchParams.get('level') || 'all';
    const limit = url.searchParams.get('limit') || '100';
    const correlationId = url.searchParams.get('correlationId');

    const logs = await logger.readLogs({
      level,
      limit: parseInt(limit),
      correlationId
    });

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: {
        logs,
        count: logs.length,
        timestamp: new Date().toISOString()
      }
    }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      error: error.message,
      type: 'admin_logs_error'
    }));
  }
}

// Get systems overview
export async function adminSystemsRoute(req, res) {
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
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: systemsData
    }));
  } catch (dbError) {
    const requestLogger = logger.createRequestLogger();
    requestLogger.error('Failed to fetch systems data', { error: dbError.message });
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Database connection failed' }));
  }
}

// Get manufacturers for dropdown
export async function adminManufacturersRoute(req, res) {
  try {
    const supabase = getSupabaseClient();
    const { data: manufacturers, error } = await supabase
      .from('systems')
      .select('manufacturer_norm')
      .not('manufacturer_norm', 'is', null)
      .order('manufacturer_norm');
    
    if (error) throw error;
    
    // Get unique manufacturers
    const uniqueManufacturers = [...new Set(manufacturers.map(item => item.manufacturer_norm))];
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: { manufacturers: uniqueManufacturers }
    }));
  } catch (error) {
    const requestLogger = logger.createRequestLogger();
    requestLogger.error('Failed to fetch manufacturers', { error: error.message });
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Failed to fetch manufacturers' }));
  }
}

// Get models for selected manufacturer
export async function adminModelsRoute(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const manufacturer = url.searchParams.get('manufacturer');
    
    if (!manufacturer) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Manufacturer parameter required' }));
      return;
    }
    
    const supabase = getSupabaseClient();
    const { data: models, error } = await supabase
      .from('systems')
      .select('canonical_model_id')
      .eq('manufacturer_norm', manufacturer)
      .not('canonical_model_id', 'is', null)
      .order('canonical_model_id');
    
    if (error) throw error;
    
    // Get unique models
    const uniqueModels = [...new Set(models.map(item => item.canonical_model_id))];
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: { models: uniqueModels }
    }));
  } catch (error) {
    const requestLogger = logger.createRequestLogger();
    requestLogger.error('Failed to fetch models', { error: error.message });
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Failed to fetch models' }));
  }
}

// Get Pinecone status and metrics
export async function adminPineconeRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    // Call Python sidecar to get Pinecone status
    const sidecarUrl = env.pythonSidecarUrl;
    
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
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: pineconeData
    }));
    
    requestLogger.info('Pinecone status retrieved', { 
      status: pineconeData.status,
      index: pineconeData.index,
      vectorCount: pineconeData.vectors
    });
    
  } catch (error) {
    requestLogger.error('Failed to get Pinecone status', { error: error.message });
    
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to get Pinecone status',
      details: error.message
    }));
  }
}

export const adminRoutes = {
  adminDashboardRoute,
  adminHealthRoute,
  adminLogsRoute,
  adminSystemsRoute,
  adminManufacturersRoute,
  adminModelsRoute,
  adminPineconeRoute
};

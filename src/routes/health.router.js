// src/routes/health.router.js
import express from 'express';
import { getExternalServiceStatus } from '../services/guards/index.js';
import { validate } from '../middleware/validate.js';
import { validateResponse } from '../middleware/validateResponse.js';
import { 
  BasicHealthEnvelope, 
  ServiceStatusEnvelope, 
  ReadinessEnvelope,
  EmptyQuery
} from '../schemas/health.schema.js';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';

const router = express.Router();

// GET /health - Basic health check
router.get('/', 
  validate(EmptyQuery, 'query'),
  validateResponse(BasicHealthEnvelope),
  (req, res) => {
  const envelope = {
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }
  };

  return res.json(envelope);
});

// GET /health/services - Check external service status
router.get('/services', 
  validate(EmptyQuery, 'query'),
  validateResponse(ServiceStatusEnvelope),
  async (req, res) => {
  try {
    const serviceStatus = await getExternalServiceStatus();
    
    const allServicesHealthy = Object.values(serviceStatus).every(status => status === true);
    
    const envelope = {
      success: true,
      data: {
        status: allServicesHealthy ? 'healthy' : 'degraded',
        services: serviceStatus,
        timestamp: new Date().toISOString()
      }
    };

    return res.json(envelope);
  } catch (error) {
    const envelope = {
      success: false,
      data: null,
      error: {
        code: 'HEALTH_CHECK_FAILED',
        message: 'Failed to check service status',
        details: { error: error.message }
      }
    };

    return res.status(503).json(envelope);
  }
});

// GET /health/ready - Readiness check (for Kubernetes)
router.get('/ready', 
  validate(EmptyQuery, 'query'),
  validateResponse(ReadinessEnvelope),
  async (req, res) => {
  try {
    const serviceStatus = await getExternalServiceStatus();
    
    // Consider ready if at least Supabase is available (core dependency)
    const isReady = serviceStatus.supabase === true;
    
    if (isReady) {
      const envelope = {
        success: true,
        data: {
          status: 'ready',
          timestamp: new Date().toISOString()
        }
      };

      return res.json(envelope);
    } else {
      const envelope = {
        success: false,
        data: null,
        error: {
          code: 'NOT_READY',
          message: 'Application not ready - core services unavailable',
          details: { services: serviceStatus }
        }
      };

      return res.status(503).json(envelope);
    }
  } catch (error) {
    const envelope = {
      success: false,
      data: null,
      error: {
        code: 'READINESS_CHECK_FAILED',
        message: 'Failed to check readiness',
        details: { error: error.message }
      }
          };

      return res.status(503).json(envelope);
    }
  });

// GET /health/live - Liveness check (for Kubernetes)
router.get('/live', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    },
    requestId: res.locals?.requestId ?? null
  });
});

// GET /health/monitoring - Runtime monitoring check
router.get('/monitoring', async (req, res) => {
  try {
    const requestLogger = req.requestLogger || logger.createRequestLogger();
    
    // Run runtime monitoring checks
    const monitoringResults = await runRuntimeMonitoringChecks();
    
    const hasCriticalIssues = monitoringResults.criticalErrors > 0;
    const hasWarnings = monitoringResults.warnings > 0;
    
    const status = hasCriticalIssues ? 'critical' : hasWarnings ? 'warning' : 'healthy';
    
    res.json({
      success: true,
      data: {
        status,
        timestamp: new Date().toISOString(),
        monitoring: monitoringResults,
        summary: {
          criticalErrors: monitoringResults.criticalErrors,
          warnings: monitoringResults.warnings,
          info: monitoringResults.info
        }
      },
      requestId: res.locals?.requestId ?? null
    });
  } catch (error) {
    const requestLogger = req.requestLogger || logger.createRequestLogger();
    requestLogger.error('Runtime monitoring check failed', { error: error.message });
    
    res.status(503).json({
      success: false,
      data: null,
      error: {
        code: 'MONITORING_CHECK_FAILED',
        message: 'Failed to run runtime monitoring checks',
        details: { error: error.message }
      },
      requestId: res.locals?.requestId ?? null
    });
  }
});

// Helper function to run runtime monitoring checks
async function runRuntimeMonitoringChecks() {
  const results = {
    criticalErrors: 0,
    warnings: 0,
    info: 0,
    checks: {}
  };
  
  try {
    // Check 1: "Cannot set headers" errors (critical)
    const doubleSendErrors = await checkLogPattern("Cannot set headers");
    results.checks.doubleSendErrors = {
      count: doubleSendErrors.count,
      status: doubleSendErrors.count > 0 ? 'critical' : 'healthy',
      recent: doubleSendErrors.recent
    };
    if (doubleSendErrors.count > 0) results.criticalErrors++;
    
    // Check 2: Validation stack traces (warning)
    const validationErrors = await checkLogPattern("ValidationError|ZodError");
    results.checks.validationErrors = {
      count: validationErrors.count,
      status: validationErrors.count > 0 ? 'warning' : 'healthy',
      recent: validationErrors.recent
    };
    if (validationErrors.count > 0) results.warnings++;
    
    // Check 3: Method guard violations (info)
    const methodGuardViolations = await checkLogPattern("METHOD_NOT_ALLOWED");
    results.checks.methodGuardViolations = {
      count: methodGuardViolations.count,
      status: 'info',
      recent: methodGuardViolations.recent
    };
    results.info += methodGuardViolations.count;
    
    // Check 4: Admin authentication failures (info)
    const adminAuthFailures = await checkLogPattern("ADMIN_DISABLED|FORBIDDEN");
    results.checks.adminAuthFailures = {
      count: adminAuthFailures.count,
      status: 'info',
      recent: adminAuthFailures.recent
    };
    results.info += adminAuthFailures.count;
    
    // Check 5: Service disabled errors (info)
    const serviceDisabledErrors = await checkLogPattern("PINECONE_DISABLED|SERVICE_DISABLED");
    results.checks.serviceDisabledErrors = {
      count: serviceDisabledErrors.count,
      status: 'info',
      recent: serviceDisabledErrors.recent
    };
    results.info += serviceDisabledErrors.count;
    
    // Check 6: Error rate analysis
    const errorRate = await analyzeErrorRate();
    results.checks.errorRate = {
      rate: errorRate.rate,
      totalErrors: errorRate.totalErrors,
      totalRequests: errorRate.totalRequests,
      status: errorRate.rate > 10 ? 'critical' : errorRate.rate > 5 ? 'warning' : 'healthy'
    };
    if (errorRate.rate > 10) results.criticalErrors++;
    else if (errorRate.rate > 5) results.warnings++;
    
  } catch (error) {
    results.checks.error = {
      message: error.message,
      status: 'error'
    };
    results.criticalErrors++;
  }
  
  return results;
}

// Helper function to check log patterns
async function checkLogPattern(pattern) {
  try {
    const { execSync } = await import('child_process');
    
    // Count occurrences
    const countResult = execSync(`find logs/ -name "*.log" -exec grep -c "${pattern}" {} \\; 2>/dev/null | awk '{sum += $1} END {print sum}'`, { encoding: 'utf8' });
    const count = parseInt(countResult.trim()) || 0;
    
    // Get recent occurrences
    const recentResult = execSync(`find logs/ -name "*.log" -exec grep "${pattern}" {} \\; 2>/dev/null | tail -3`, { encoding: 'utf8' });
    const recent = recentResult.trim().split('\n').filter(line => line.length > 0);
    
    return { count, recent };
  } catch (error) {
    return { count: 0, recent: [] };
  }
}

// Helper function to analyze error rate
async function analyzeErrorRate() {
  try {
    const { execSync } = await import('child_process');
    
    // Count total errors
    const errorResult = execSync(`find logs/ -name "*.log" -exec grep -c "ERROR" {} \\; 2>/dev/null | awk '{sum += $1} END {print sum}'`, { encoding: 'utf8' });
    const totalErrors = parseInt(errorResult.trim()) || 0;
    
    // Count total requests
    const requestResult = execSync(`find logs/ -name "*.log" -exec grep -c "GET\\|POST\\|PUT\\|DELETE" {} \\; 2>/dev/null | awk '{sum += $1} END {print sum}'`, { encoding: 'utf8' });
    const totalRequests = parseInt(requestResult.trim()) || 0;
    
    const rate = totalRequests > 0 ? (totalErrors * 100 / totalRequests) : 0;
    
    return { rate, totalErrors, totalRequests };
  } catch (error) {
    return { rate: 0, totalErrors: 0, totalRequests: 0 };
  }
}

export default router;

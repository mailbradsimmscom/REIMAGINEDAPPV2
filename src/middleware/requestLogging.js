import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

const requestLogger = logger.createRequestLogger();

// In-memory store for request metrics (in production, this would be Redis or a database)
const requestMetrics = {
  requests: new Map(),
  errors: [],
  lastCleanup: Date.now()
};

// Cleanup old data every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
const DATA_RETENTION = 24 * 60 * 60 * 1000; // 24 hours

function cleanupOldData() {
  const now = Date.now();
  if (now - requestMetrics.lastCleanup < CLEANUP_INTERVAL) return;
  
  requestMetrics.lastCleanup = now;
  
  // Remove old requests
  for (const [requestId, data] of requestMetrics.requests) {
    if (now - data.timestamp > DATA_RETENTION) {
      requestMetrics.requests.delete(requestId);
    }
  }
  
  // Remove old errors
  requestMetrics.errors = requestMetrics.errors.filter(
    error => now - error.timestamp < DATA_RETENTION
  );
  
  requestLogger.info('Cleaned up old request metrics', {
    remainingRequests: requestMetrics.requests.size,
    remainingErrors: requestMetrics.errors.length
  });
}

// Request logging middleware
export function requestLoggingMiddleware(req, res, next) {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || uuidv4();
  
  // Add requestId to request object for use in other middleware
  req.requestId = requestId;
  req.startTime = startTime;
  req.requestLogger = requestLogger;
  
  // Store request start data
  const requestData = {
    requestId,
    method: req.method,
    route: req.route?.path || req.path,
    userAgent: req.get('User-Agent'),
    timestamp: startTime,
    startTime
  };
  
  requestMetrics.requests.set(requestId, requestData);
  
  // Log request start
  requestLogger.info('Request started', {
    requestId,
    method: req.method,
    route: req.route?.path || req.path,
    userAgent: req.get('User-Agent')
  });
  
  next();
}

// Get aggregated metrics
export function getRequestMetrics(timeframe = '15m') {
  const now = Date.now();
  const timeWindows = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000
  };
  const windowMs = timeWindows[timeframe] || timeWindows['15m'];
  const startTime = now - windowMs;
  
  // Filter requests within timeframe
  const recentRequests = Array.from(requestMetrics.requests.values())
    .filter(req => req.timestamp >= startTime);
  
  const recentErrors = requestMetrics.errors
    .filter(error => error.timestamp >= startTime);
  
  // Calculate metrics
  const totalRequests = recentRequests.length;
  const successCount = recentRequests.filter(req => req.success).length;
  const errorCount = recentErrors.length;
  const errorRate = totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0;
  
  // Calculate P95 latency
  const latencies = recentRequests
    .map(req => req.duration)
    .filter(duration => duration !== undefined)
    .sort((a, b) => a - b);
  
  const p95Index = Math.floor(latencies.length * 0.95);
  const p95Latency = latencies[p95Index] || 0;
  
  // Calculate requests per minute
  const requestsPerMinute = totalRequests / (windowMs / (60 * 1000));
  
  // Calculate average response size
  const avgResponseSize = recentRequests.length > 0 
    ? recentRequests.reduce((sum, req) => sum + (req.responseSize || 0), 0) / recentRequests.length
    : 0;
  
  return {
    timeframe,
    windowStart: new Date(startTime).toISOString(),
    windowEnd: new Date(now).toISOString(),
    totalRequests,
    successCount,
    errorCount,
    errorRate,
    p95Latency,
    requestsPerMinute,
    avgResponseSize,
    recentErrors: recentErrors.slice(-10), // Last 10 errors
    dataSource: 'live'
  };
}

// Get all request metrics (for debugging)
export function getAllRequestMetrics() {
  return {
    totalRequests: requestMetrics.requests.size,
    totalErrors: requestMetrics.errors.length,
    lastCleanup: new Date(requestMetrics.lastCleanup).toISOString(),
    sampleRequests: Array.from(requestMetrics.requests.values()).slice(-5),
    sampleErrors: requestMetrics.errors.slice(-5)
  };
}

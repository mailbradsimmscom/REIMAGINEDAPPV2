import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';

/**
 * Admin authentication middleware
 * Protects all /admin/* routes with simple header-based auth
 */
export function adminGate(req, res, next) {
  const requestLogger = req.requestLogger || logger.createRequestLogger();
  const env = getEnv({ loose: true });
  
  // Simple admin token check
  const adminToken = req.headers['x-admin-token'] || req.headers['authorization'];
  const expectedToken = env.ADMIN_TOKEN;
  
  if (!adminToken || adminToken !== expectedToken) {
    requestLogger.warn('Admin access denied', {
      url: req.url,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    const statusCode = !adminToken ? 401 : 403;
    const message = !adminToken ? 'Admin token required' : 'Invalid admin token';
    
    return res.status(statusCode).json({
      success: false,
      code: !adminToken ? 'UNAUTHORIZED' : 'FORBIDDEN',
      message
    });
  }
  
  requestLogger.info('Admin access granted', { url: req.url });
  next();
}

/**
 * Optional admin gate - only checks if token is provided
 * Useful for routes that can work with or without admin access
 */
export function optionalAdminGate(req, res, next) {
  const env = getEnv({ loose: true });
  const adminToken = req.headers['x-admin-token'] || req.headers['authorization'];
  const expectedToken = env.ADMIN_TOKEN;
  
  if (expectedToken && adminToken && adminToken === expectedToken) {
    req.isAdmin = true;
  } else {
    req.isAdmin = false;
  }
  
  next();
}

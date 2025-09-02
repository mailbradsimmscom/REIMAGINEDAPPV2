import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * Admin authentication middleware
 * Protects all /admin/* routes with simple header-based auth
 */
export function adminGate(req, res, next) {
  const requestLogger = req.requestLogger || logger.createRequestLogger();
  
  // Simple admin token check
  const adminToken = req.headers['x-admin-token'] || req.headers['authorization'];
  const expectedToken = env.adminToken;
  
  if (!adminToken || adminToken !== expectedToken) {
    requestLogger.warn('Admin access denied', {
      url: req.url,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    return res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Admin access required'
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
  const adminToken = req.headers['x-admin-token'] || req.headers['authorization'];
  const expectedToken = env.adminToken;
  
  if (expectedToken && adminToken && adminToken === expectedToken) {
    req.isAdmin = true;
  } else {
    req.isAdmin = false;
  }
  
  next();
}

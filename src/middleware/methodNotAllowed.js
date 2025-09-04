import { logger } from '../utils/logger.js';

/**
 * Middleware to handle method not allowed (405) responses
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export function methodNotAllowed(req, res, next) {
  const requestLogger = req.requestLogger || logger.createRequestLogger();
  
  // DEBUG: Add methodNotAllowed tracing
  console.log('🔍 [METHOD_NOT_ALLOWED]', req.method, req.originalUrl, '→', req.url, 'allowedMethods:', req.route?.methods || []);
  
  requestLogger.warn('Method not allowed', {
    method: req.method,
    url: req.url,
    allowedMethods: req.route?.methods || []
  });
  
  return res.status(405).json({
    success: false,
    data: null,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} method not allowed for ${req.url}`
    }
  });
}

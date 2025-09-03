import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { ERR } from '../constants/errorCodes.js';

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  
  const requestLogger = req.requestLogger || logger.createRequestLogger();
  
  // Handle Zod validation errors
  if (err instanceof z.ZodError) {
    requestLogger.warn('Validation error', { 
      url: req.url, 
      method: req.method,
      issues: err.issues 
    });
    
    return res.status(400).json({
      success: false,
      data: null,
      error: { 
        code: ERR.BAD_REQUEST, 
        message: 'Validation failed',
        details: err.issues 
      },
      requestId: res.locals?.requestId ?? null,
    });
  }
  
  // Handle other errors
  const status = Number(err.status) || 500;
  const code = err.code || (status === 400 ? ERR.BAD_REQUEST : ERR.INTERNAL);
  const message = err.message || (status === 400 ? 'Validation failed' : 'Unexpected error');

  if (status >= 500) {
    requestLogger.error('Server error', { 
      error: err.message, 
      stack: err.stack,
      url: req.url,
      method: req.method
    });
  }

  return res.status(status).json({
    success: false,
    data: null,
    error: { code, message },
    requestId: res.locals?.requestId ?? null,
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    data: null,
    error: {
      code: ERR.NOT_FOUND,
      message: 'Route not found'
    }
  });
}

export function methodNotAllowed(allowedMethods = []) {
  return (req, res) => {
    res.status(405).json({
      success: false,
      data: null,
      error: {
        code: ERR.METHOD_NOT_ALLOWED,
        message: `${req.method} method not allowed for ${req.url}`,
        details: { allowedMethods }
      }
    });
  };
}

export default errorHandler;

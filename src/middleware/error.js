import { logger } from '../utils/logger.js';

/**
 * Central error handling middleware for Express
 * Maps all errors to your consistent response envelope format
 */
export function errorHandler(err, req, res, next) {
  const requestLogger = req.requestLogger || logger.createRequestLogger();
  
  // Log the error
  requestLogger.error('Express error handler caught error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  
  // Determine status code based on error type
  let statusCode = 500;
  let errorMessage = 'Internal Server Error';
  
  if (err.name === 'ZodError') {
    // Zod validation errors
    statusCode = 400;
    errorMessage = 'Invalid request data';
  } else if (err.name === 'SyntaxError' && err.status === 400) {
    // JSON parsing errors
    statusCode = 400;
    errorMessage = 'Invalid JSON in request body';
  } else if (err.status) {
    // Express error with status
    statusCode = err.status;
    errorMessage = err.message;
  } else if (err.message && err.message.includes('required')) {
    // Missing required fields
    statusCode = 400;
    errorMessage = err.message;
  } else if (err.message && err.message.includes('invalid')) {
    // Invalid data
    statusCode = 400;
    errorMessage = err.message;
  }
  
  // Send error response in your envelope format
  res.status(statusCode).json({
    success: false,
    error: errorMessage,
    ...(err.name === 'ZodError' && { details: err.errors }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

/**
 * 404 handler for unmatched routes
 */
export function notFoundHandler(req, res) {
  const requestLogger = req.requestLogger || logger.createRequestLogger();
  
  requestLogger.warn('404 Not Found', { url: req.url });
  
  res.status(404).json({
    success: false,
    error: 'Not Found'
  });
}

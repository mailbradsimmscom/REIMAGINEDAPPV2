import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

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
  
  // Determine status code and error details based on error type
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let errorMessage = 'Internal Server Error';
  let details = null;
  
  if (err.name === 'ZodError') {
    // Zod validation errors
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    errorMessage = 'Invalid request data';
    details = err.errors;
  } else if (err.name === 'SyntaxError' && err.status === 400) {
    // JSON parsing errors
    statusCode = 400;
    errorCode = 'INVALID_JSON';
    errorMessage = 'Invalid JSON in request body';
  } else if (err.name === 'PayloadTooLargeError') {
    // Payload size limit exceeded
    statusCode = 413;
    errorCode = 'PAYLOAD_TOO_LARGE';
    errorMessage = 'Request payload too large';
  } else if (err.status) {
    // Express error with status
    statusCode = err.status;
    errorCode = getErrorCode(err.status);
    errorMessage = err.message;
  } else if (err.message && err.message.includes('required')) {
    // Missing required fields
    statusCode = 400;
    errorCode = 'MISSING_REQUIRED_FIELD';
    errorMessage = err.message;
  } else if (err.message && err.message.includes('invalid')) {
    // Invalid data
    statusCode = 400;
    errorCode = 'INVALID_DATA';
    errorMessage = err.message;
  }
  
  // Send error response in your envelope format
  res.status(statusCode).json({
    success: false,
    code: errorCode,
    message: errorMessage,
    ...(details && { details }),
    ...(env.nodeEnv === 'development' && { stack: err.stack })
  });
}

/**
 * Helper function to map HTTP status codes to error codes
 */
function getErrorCode(status) {
  switch (status) {
    case 400: return 'BAD_REQUEST';
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 405: return 'METHOD_NOT_ALLOWED';
    case 409: return 'CONFLICT';
    case 422: return 'UNPROCESSABLE_ENTITY';
    case 429: return 'TOO_MANY_REQUESTS';
    case 500: return 'INTERNAL_ERROR';
    case 502: return 'BAD_GATEWAY';
    case 503: return 'SERVICE_UNAVAILABLE';
    default: return 'INTERNAL_ERROR';
  }
}

/**
 * 404 handler for unmatched routes
 */
export function notFoundHandler(req, res) {
  const requestLogger = req.requestLogger || logger.createRequestLogger();
  
  requestLogger.warn('404 Not Found', { url: req.url });
  
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: 'Not Found'
  });
}

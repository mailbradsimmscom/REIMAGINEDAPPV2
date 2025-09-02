import { env } from '../config/env.js';

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err); // <-- Prevent double-send

  const status = Number(err.statusCode || err.status || 500);
  const code = String(err.code || 'INTERNAL');

  return res.status(status).json({
    success: false,
    error: {
      code,
      message: err.message || 'Internal server error',
      ...(err.details ? { details: err.details } : {})
    }
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found'
    }
  });
}

export default errorHandler;

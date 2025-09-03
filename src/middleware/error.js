export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  return res.status(status).json({
    success: false,
    error: { code: err.code || 'INTERNAL', message: err.message || 'Unexpected error' },
    requestId: res.locals?.requestId ?? null,
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

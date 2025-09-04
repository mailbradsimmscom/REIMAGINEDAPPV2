import { logger } from '../utils/logger.js';
import { ENV } from '../config/env.js';

export function trace404(req, _res, next) {
  if (ENV.NODE_ENV === 'production') return next();
  logger.createRequestLogger().warn('404 trace', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    routeBases: ['/health','/systems','/chat','/chat/enhanced','/document','/admin/docs','/pinecone'],
  });
  next();
}

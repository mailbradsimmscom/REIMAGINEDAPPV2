// src/index.js
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import app from './app.js';
import { logger } from './utils/logger.js';

import { securityHeaders, basicRateLimit } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { adminGate } from './middleware/admin.js';
import { trace404 } from './middleware/trace404.js';

// Routers
import healthRouter from './routes/health.router.js';
import systemsRouter from './routes/systems.router.js';
import chatRouter from './routes/chat/index.js';
import documentRouter from './routes/document/index.js';
import pineconeRouter from './routes/pinecone.router.js';
import adminRouter from './routes/admin/index.js';
import testNormalizerRouter from './routes/test-normalizer.route.js';

import pineconeRepository from './repositories/pinecone.repository.js';
import { attachConfigInspector } from './debug/config.js';
import { attachRouteDebugger } from './debug/routes.js';
import { ensureLexicons } from './startup/configGuard.service.js';

// Ensure critical lexicon files exist at startup
ensureLexicons().catch(err => {
  logger.warn('Config guard failed (non-fatal)', { error: err.message });
});

// Safe mount function to identify failing routers
function safeMount(base, router) {
  try { 
    app.use(base, router); 
    logger.info('mounted', { base }); 
  }
  catch (e) { 
    logger.error('MOUNT_FAILED', { base, error: e.message }); 
    throw e; 
  }
}

// --- global headers / rate limit (keep these light; helmet is already in app.js) ---
app.use(securityHeaders);
app.use(basicRateLimit);

// Log namespace choice on startup (dev only)
pineconeRepository.logNamespaceChoiceOnce().catch(err => {
  logger.warn('Failed to log namespace choice', { error: err.message });
});

// Attach config inspector (dev only)
attachConfigInspector(app);

// --- mount routers ---
safeMount('/health', healthRouter);
safeMount('/systems', systemsRouter);
safeMount('/chat', chatRouter);
safeMount('/document', documentRouter);  // alias for backward compatibility
safeMount('/pinecone', pineconeRouter);
safeMount('/admin/docs', documentRouter);  // mount BEFORE /admin to avoid conflicts
safeMount('/admin/api', adminRouter);
safeMount('/test-normalizer', testNormalizerRouter);

// Mount route debugger (dev only) - AFTER routers are mounted
attachRouteDebugger(app);

// --- static/public (optional; app.js already serves / and /app.js) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/public', (req, res, next) => next()); // placeholder if you add static later

// --- 404 + error handlers (must be last) ---
app.use(trace404);
app.use(notFoundHandler);
app.use(errorHandler);

// graceful shutdown logs
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});
process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

export default app;



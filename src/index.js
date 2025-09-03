// src/index.js
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import app from './app.js';
import { logger } from './utils/logger.js';

import { securityHeaders, basicRateLimit } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { adminGate } from './middleware/admin.js';

// Routers
import healthRouter from './routes/health.router.js';
import systemsRouter from './routes/systems.router.js';
import chatRouter from './routes/chat/index.js';
import documentRouter from './routes/document/index.js';
import pineconeRouter from './routes/pinecone.router.js';
import adminRouter from './routes/admin/index.js';

// --- global headers / rate limit (keep these light; helmet is already in app.js) ---
app.use(securityHeaders);
app.use(basicRateLimit);

// --- mount routers ---
app.use('/health', healthRouter);
app.use('/systems', systemsRouter);
app.use('/chat/enhanced', chatRouter);
app.use('/chat', chatRouter);  // alias for backward compatibility
app.use('/admin/docs', documentRouter);
app.use('/document', documentRouter);  // alias for backward compatibility
app.use('/pinecone', pineconeRouter);
app.use('/admin', adminGate, adminRouter);

// --- static/public (optional; app.js already serves / and /app.js) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/public', (req, res, next) => next()); // placeholder if you add static later

// --- 404 + error handlers (must be last) ---
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



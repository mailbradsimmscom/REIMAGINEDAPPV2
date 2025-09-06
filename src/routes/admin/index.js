import express from 'express';
import { adminOnly } from '../../middleware/admin.js';
import dashboardRouter from './dashboard.route.js';
import healthRouter from './health.route.js';
import systemsRouter from './systems.route.js';
import logsRouter from './logs.route.js';
import manufacturersRouter from './manufacturers.route.js';
import modelsRouter from './models.route.js';
import pineconeRouter from './pinecone.route.js';
import metricsRouter from './metrics.route.js';

const router = express.Router();

// Mount dashboard route FIRST (no auth required for HTML page)
router.use('/', dashboardRouter);

// Apply admin gate to all API routes
router.use(adminOnly);

// Mount all other routes (these require admin auth)
router.use('/health', healthRouter);
router.use('/systems', systemsRouter);
router.use('/logs', logsRouter);
router.use('/manufacturers', manufacturersRouter);
router.use('/models', modelsRouter);
router.use('/pinecone', pineconeRouter);
router.use('/metrics', metricsRouter);

export default router;

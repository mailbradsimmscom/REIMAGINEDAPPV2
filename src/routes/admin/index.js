import express from 'express';
import { adminOnly } from '../../middleware/admin.js';
import dashboardRouter from './dashboard.route.js';
import healthRouter from './health.route.js';
import systemsRouter from './systems.route.js';
import logsRouter from './logs.route.js';
import manufacturersRouter from './manufacturers.route.js';
import modelsRouter from './models.route.js';
import pineconeRouter from './pinecone.route.js';

const router = express.Router();

// Apply admin gate to all routes in this router
router.use(adminOnly);

// Mount dashboard route (no auth required)
router.use('/', dashboardRouter);

// Mount all other routes
router.use('/health', healthRouter);
router.use('/systems', systemsRouter);
router.use('/logs', logsRouter);
router.use('/manufacturers', manufacturersRouter);
router.use('/models', modelsRouter);
router.use('/pinecone', pineconeRouter);

export default router;

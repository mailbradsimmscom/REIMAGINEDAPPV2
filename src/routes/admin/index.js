import express from 'express';
import { adminGate } from '../../middleware/admin.js';
import dashboardRouter from './dashboard.route.js';
import healthRouter from './health.route.js';
import systemsRouter from './systems.route.js';
import logsRouter from './logs.route.js';
import manufacturersRouter from './manufacturers.route.js';
import modelsRouter from './models.route.js';
import pineconeRouter from './pinecone.route.js';

const router = express.Router();

// Mount dashboard route (no auth required)
router.use('/', dashboardRouter);

// Apply admin gate to all API routes
router.use('/health', adminGate, healthRouter);
router.use('/systems', adminGate, systemsRouter);
router.use('/logs', adminGate, logsRouter);
router.use('/manufacturers', adminGate, manufacturersRouter);
router.use('/models', adminGate, modelsRouter);
router.use('/pinecone', adminGate, pineconeRouter);

export default router;

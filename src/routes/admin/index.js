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
import suggestionsRouter from './suggestions.route.js';
import systemsMinimalRoute from "./systems-minimal.route.js";
import snapshotsRouter from './snapshots.route.js';
import textExtractionRouter from './text-extraction.route.js';
import jobsRouter from './jobs.route.js';
import documentRouter from '../document/index.js';
import chunksRouter from './chunks.route.js';
import intentRouter from './intent-router.route.js';
import playbooksRouter from './playbooks.route.js';
import goldenTestsRouter from './golden-tests.route.js';

const router = express.Router();

// Apply admin gate to all API routes
router.use(adminOnly);

// Add trace middleware to track admin requests
router.use((req, res, next) => {
  // Lightweight trace for admin subtree
  req._traceStart = Date.now();
  next();
});

// Mount all other routes (these require admin auth)
router.use('/health', healthRouter);
router.use('/systems', systemsRouter);
router.use('/logs', logsRouter);
router.use('/manufacturers', manufacturersRouter);
router.use('/models', modelsRouter);
router.use('/pinecone', pineconeRouter);
router.use('/metrics', metricsRouter);
router.use('/snapshots', snapshotsRouter);
router.use('/suggestions', suggestionsRouter);
router.use("/systems/minimal", systemsMinimalRoute);
router.use('/text-extraction', textExtractionRouter);
router.use('/jobs', jobsRouter);
router.use('/docs', documentRouter);
router.use('/chunks', chunksRouter);
router.use('/intent-router', intentRouter);
router.use('/playbooks', playbooksRouter);
router.use('/golden-tests', goldenTestsRouter);

// Place AFTER all routes mounted to see fall-throughs
// If we reach this, nothing matched in /admin
router.use((req, res, next) => {
  const took = Date.now() - (req._traceStart ?? Date.now());
  // Only log misses in /admin to avoid noise
  // eslint-disable-next-line no-console
  console.warn(`[ADMIN MISS] ${req.method} ${req.originalUrl} (${took}ms)`);
  next();
});

export default router;

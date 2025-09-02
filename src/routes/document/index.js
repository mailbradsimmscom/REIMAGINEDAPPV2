import express from 'express';
import ingestRouter from './ingest.route.js';
import jobsRouter from './jobs.route.js';
import jobStatusRouter from './job-status.route.js';
import documentsRouter from './documents.route.js';
import getOneRouter from './get-one.route.js';

const router = express.Router();

// Mount individual route modules
router.use('/ingest', ingestRouter);
router.use('/jobs', jobsRouter);
router.use('/jobs', jobStatusRouter); // This will handle /jobs/:jobId
router.use('/documents', documentsRouter);
router.use('/documents', getOneRouter); // This will handle /documents/:docId

export default router;

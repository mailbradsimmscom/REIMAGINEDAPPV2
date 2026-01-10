/**
 * Funnel Router
 * Pipeline statistics and visualization
 */

import express from 'express';
import statsRouter from './stats.route.js';

const router = express.Router();

router.use('/stats', statsRouter);

export default router;

// src/routes/supplies/index.js
import express from 'express';
import suppliesRoute from './supplies.route.js';
import configRoute from './config.route.js';

const router = express.Router();

// Config routes for managing dropdowns (categories, units, locations)
// Mount BEFORE the catch-all supplies route
router.use('/config', configRoute);

// Mount supplies routes (catch-all)
router.use('/', suppliesRoute);

export default router;

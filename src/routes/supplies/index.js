// src/routes/supplies/index.js
import express from 'express';
import suppliesRoute from './supplies.route.js';
import configRoute from './config.route.js';

const router = express.Router();

// Mount supplies routes
router.use('/', suppliesRoute);

// Config routes for managing dropdowns (categories, units, locations)
router.use('/config', configRoute);

export default router;

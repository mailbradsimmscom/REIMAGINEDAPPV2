// src/routes/supplies/index.js
import express from 'express';
import suppliesRoute from './supplies.route.js';
import configRoute from './config.route.js';
import quickAddRouter from './quick-add.route.js';

const router = express.Router();

// Quick-add audit routes — mount BEFORE catch-all
router.use('/quick-add', quickAddRouter);

// Config routes for managing dropdowns (categories, units, locations)
router.use('/config', configRoute);

// Mount supplies routes (catch-all)
router.use('/', suppliesRoute);

export default router;

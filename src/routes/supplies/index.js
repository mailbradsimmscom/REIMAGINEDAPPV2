// src/routes/supplies/index.js
import express from 'express';
import suppliesRoute from './supplies.route.js';

const router = express.Router();

// Mount supplies routes
router.use('/', suppliesRoute);

// Future routes (uncomment when implemented)
// import inventoryRoute from './inventory.route.js';
// import configRoute from './config.route.js';
// router.use('/inventory', inventoryRoute);
// router.use('/config', configRoute);

export default router;

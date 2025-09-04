import express from 'express';
import { validateResponse } from '../../middleware/validateResponse.js';
import { EnvelopeSchema } from '../../schemas/envelope.schema.js';
import processRouter from './process.route.js';
import historyRouter from './history.route.js';
import listRouter from './list.route.js';
import contextRouter from './context.route.js';
import deleteRouter from './delete.route.js';
import sessionDeleteRouter from './session-delete.route.js';

const router = express.Router();

// Apply response validation to all chat routes
router.use(validateResponse(EnvelopeSchema)); // gate all /chat/*

// Mount individual route modules
router.use('/process', processRouter);
router.use('/history', historyRouter);
router.use('/list', listRouter);
router.use('/context', contextRouter);
router.use('/delete', deleteRouter);
router.use('/', sessionDeleteRouter); // This will handle /:sessionId

export default router;

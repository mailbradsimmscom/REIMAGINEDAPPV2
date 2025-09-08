import express from 'express';
import { validateResponse } from '../../middleware/validateResponse.js';
import { EnvelopeSchema } from '../../schemas/envelope.schema.js';
import processRouter from './process.route.js';
import historyRouter from './history.route.js';
import listRouter from './list.route.js';
import contextRouter from './context.route.js';
import deleteRouter from './delete.route.js';
import sessionDeleteRouter from './session-delete.route.js';
import threadBySessionRouter from './thread-by-session.route.js';

const router = express.Router();

// Apply response validation to all chat routes
router.use(validateResponse(EnvelopeSchema)); // gate all /chat/*

// Mount individual route modules
router.use('/process', processRouter);
router.use('/history', historyRouter);
router.use('/list', listRouter);
router.use('/context', contextRouter);
router.use('/delete', deleteRouter);
router.use('/thread', threadBySessionRouter);

// NEW: compatibility alias for the UI's /chat/enhanced/* paths
router.use('/enhanced/process', processRouter);
router.use('/enhanced/history', historyRouter);
router.use('/enhanced/list', listRouter);
router.use('/enhanced/context', contextRouter);
router.use('/enhanced/delete', deleteRouter);
router.use('/enhanced/thread', threadBySessionRouter);

// Keep this last so it doesn't swallow unknown subpaths
// param-scoped delete, LAST (so it can't see 'enhanced')
router.use('/:sessionId', sessionDeleteRouter);

export default router;

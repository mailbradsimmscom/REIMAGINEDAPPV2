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
import sessionsRouter from './sessions.route.js';
import threadsRouter from './threads.route.js';
import messagesRouter from './messages.route.js';

const router = express.Router();

router.use(sessionsRouter);
router.use(threadsRouter);
router.use(messagesRouter);

router.use(validateResponse(EnvelopeSchema));

// Both /chat/process and /chat/enhanced/process use the same router
// Response format: data.assistantMessage is an OBJECT with content, role, sources
processRouter._mountPath = '/process';
router.use('/process', processRouter);
historyRouter._mountPath = '/history';
router.use('/history', historyRouter);
listRouter._mountPath = '/list';
router.use('/list', listRouter);
contextRouter._mountPath = '/context';
router.use('/context', contextRouter);
deleteRouter._mountPath = '/delete';
router.use('/delete', deleteRouter);
threadBySessionRouter._mountPath = '/thread';
router.use('/thread', threadBySessionRouter);

// /chat/enhanced/* - aliases to the same routes for backward compatibility
router.use('/enhanced/process', processRouter);
router.use('/enhanced/history', historyRouter);
router.use('/enhanced/list', listRouter);
router.use('/enhanced/context', contextRouter);
router.use('/enhanced/delete', deleteRouter);
router.use('/enhanced/thread', threadBySessionRouter);

// Keep this last so it doesn't swallow unknown subpaths
// param-scoped delete, LAST (so it can't see 'enhanced')
sessionDeleteRouter._mountPath = '/:sessionId';
router.use('/:sessionId', sessionDeleteRouter);
// Also support /chat/enhanced/:sessionId for consistency
router.use('/enhanced/:sessionId', sessionDeleteRouter);

export default router;

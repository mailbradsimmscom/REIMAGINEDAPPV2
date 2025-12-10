import express from 'express';
import { validateResponse } from '../../middleware/validateResponse.js';
import { EnvelopeSchema } from '../../schemas/envelope.schema.js';
import processSimpleRouter from './process-simple.route.js';  // Simple contract (string assistantMessage)
import processEnhancedRouter from './process.route.js';       // Rich contract (object assistantMessage)
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

// /chat/process - Simple contract: data.assistantMessage is a STRING
// Used by tests and external callers
// Set _mountPath for Express 5 route introspection (see src/debug/routes.js)
processSimpleRouter._mountPath = '/process';
router.use('/process', processSimpleRouter);
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

// /chat/enhanced/* - Rich contract: data.assistantMessage is an OBJECT with content, role, etc.
// Used by the UI for full message display
processEnhancedRouter._mountPath = '/enhanced/process';
router.use('/enhanced/process', processEnhancedRouter);
// Note: historyRouter etc are reused, their _mountPath was set above
// The route debugger will use the last-set _mountPath, which is fine for this use case
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

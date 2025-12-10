import express from 'express';
import { deleteChatSession } from '../../repositories/chat.repository.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { methodNotAllowed } from '../../utils/methodNotAllowed.js';
import { ERR } from '../../constants/errorCodes.js';
import {
  ChatDeleteEnvelope,
  chatDeletePathSchema
} from '../../schemas/chat.schema.js';

const router = express.Router({ mergeParams: true });
router.use(validateResponse(ChatDeleteEnvelope));

// Because it's mounted at /:sessionId(...), the handler path is '/'
router.delete(
  '/',
  validate(chatDeletePathSchema, 'params'),
  requireServices(['supabase']),
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;

      const result = await deleteChatSession(sessionId);
      
      // Check if session was found and deleted
      // Repository throws 404 error if not found, so if we get here, it was deleted
      const envelope = {
        success: true,
        data: {
          sessionId,
          deleted: true
        }
      };

      return res.status(200).json(envelope);
    } catch (error) {
      // Handle NOT_FOUND errors explicitly
      // Check both string code and numeric status
      if (error.code === 'NOT_FOUND' || error.code === ERR.NOT_FOUND || error.status === 404 || (error.message && error.message.includes('not found'))) {
        return res.status(404).json({
          success: false,
          data: null,
          error: {
            code: ERR.NOT_FOUND,
            message: error.message || 'Session not found'
          },
          requestId: res.locals?.requestId ?? null
        });
      }
      // Other errors (DB failures, etc.) go to error middleware
      next(error);
    }
  }
);

// Optional: leaf-local 405 (kept AFTER handler)
router.all('/', methodNotAllowed);

export default router;

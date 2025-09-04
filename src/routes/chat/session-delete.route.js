import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { methodNotAllowed } from '../../utils/methodNotAllowed.js';
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
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;
      
      await enhancedChatService.deleteChatSession(sessionId);
      
      const envelope = {
        success: true,
        data: {
          sessionId,
          deleted: true
        }
      };

      return res.json(envelope);
    } catch (error) {
      next(error);
    }
  }
);

// Optional: leaf-local 405 (kept AFTER handler)
router.all('/', methodNotAllowed);

export default router;

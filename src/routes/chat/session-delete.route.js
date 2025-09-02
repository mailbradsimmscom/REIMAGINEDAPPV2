import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validate } from '../../middleware/validate.js';
import { 
  chatDeletePathSchema,
  chatDeleteResponseSchema 
} from '../../schemas/chat.schema.js';

const router = express.Router();

// DELETE /chat/enhanced/:sessionId - Delete chat session (path)
router.delete('/:sessionId', 
  validate(chatDeletePathSchema, 'params'),
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;
      
      await enhancedChatService.deleteChatSession(sessionId);
      
      res.json({
        success: true,
        data: {
          sessionId,
          deleted: true
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

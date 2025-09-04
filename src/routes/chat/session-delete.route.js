import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { ChatDeleteEnvelope } from '../../schemas/chat.schema.js';
import { 
  chatDeletePathSchema
} from '../../schemas/chat.schema.js';

const router = express.Router();

// Apply response validation to all routes in this file
router.use(validateResponse(ChatDeleteEnvelope));

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

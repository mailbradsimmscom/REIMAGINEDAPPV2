import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validate } from '../../middleware/validate.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { 
  chatDeleteRequestSchema,
  chatDeleteResponseSchema 
} from '../../schemas/chat.schema.js';

const router = express.Router();

// DELETE /chat/enhanced/delete - Delete chat session (body)
router.delete('/', 
  validate(chatDeleteRequestSchema, 'body'),
  async (req, res, next) => {
    try {
      const { sessionId } = req.body;
      
      await enhancedChatService.deleteChatSession(sessionId);
      
      const envelope = {
        success: true,
        data: {
          sessionId,
          deleted: true
        },
        timestamp: new Date().toISOString()
      };

      return res.json(enforceResponse(chatDeleteResponseSchema, envelope));
    } catch (error) {
      next(error);
    }
  }
);

export default router;

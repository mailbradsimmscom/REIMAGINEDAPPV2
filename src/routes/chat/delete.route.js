import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validate } from '../../middleware/validate.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { ChatDeleteEnvelope } from '../../schemas/chat.schema.js';
import { 
  chatDeleteRequestSchema
} from '../../schemas/chat.schema.js';

const router = express.Router();

// Apply response validation to all routes in this file
router.use(validateResponse(ChatDeleteEnvelope));

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

      return enforceResponse(res, envelope, 200);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validateResponse } from '../../middleware/responseValidation.js';
import { chatDeleteResponseSchema } from '../../schemas/chat.schema.js';

const router = express.Router();

// DELETE /chat/enhanced/delete - Delete chat session
router.delete('/', validateResponse(chatDeleteResponseSchema, 'chat'), async (req, res, next) => {
  try {
    const { sessionId } = req.body;

    await enhancedChatService.deleteChatSession(sessionId);

    const responseData = {
      success: true,
      data: {
        sessionId: sessionId,
        deleted: true
      },
      timestamp: new Date().toISOString()
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

export default router;

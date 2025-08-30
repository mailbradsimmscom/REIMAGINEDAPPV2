import chatService from '../services/chat.service.js';
import { URL } from 'node:url';

export async function chatProcessMessageRoute(req, res) {
  try {
    // Parse request body
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const { message, sessionId, threadId } = JSON.parse(body);
        
        if (!message || typeof message !== 'string') {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({
            error: 'Message is required and must be a string',
            type: 'chat_validation_error',
            timestamp: new Date().toISOString()
          }));
          return;
        }
        
        // Process the message
        const result = await chatService.processUserMessage(message, {
          sessionId,
          threadId,
          contextSize: 4
        });
        
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          success: true,
          data: result,
          timestamp: new Date().toISOString()
        }));
        
      } catch (parseError) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          error: 'Invalid JSON in request body',
          type: 'chat_parse_error',
          timestamp: new Date().toISOString()
        }));
      }
    });
    
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      error: error.message,
      type: 'chat_process_error',
      context: error.context,
      timestamp: new Date().toISOString()
    }));
  }
}

export async function chatGetHistoryRoute(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const threadId = url.searchParams.get('threadId');
    const limit = url.searchParams.get('limit');
    
    if (!threadId) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        error: 'threadId is required',
        type: 'chat_history_error',
        timestamp: new Date().toISOString()
      }));
      return;
    }
    
    const messages = await chatService.getChatHistory(threadId, {
      limit: limit ? Math.min(Number(limit), 100) : 50
    });
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: {
        threadId,
        messages,
        count: messages.length
      },
      timestamp: new Date().toISOString()
    }));
    
  } catch (error) {
    let statusCode = 500;
    if (error.message.includes('not found')) {
      statusCode = 404;
    }
    
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      error: error.message,
      type: 'chat_history_error',
      context: error.context,
      timestamp: new Date().toISOString()
    }));
  }
}

export async function chatListChatsRoute(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const limit = url.searchParams.get('limit');
    const cursor = url.searchParams.get('cursor');
    
    const chats = await chatService.listUserChats({
      limit: limit ? Math.min(Number(limit), 50) : 25,
      cursor
    });
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: {
        chats,
        count: chats.length,
        nextCursor: chats.length > 0 ? chats[chats.length - 1].updated_at : null
      },
      timestamp: new Date().toISOString()
    }));
    
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      error: error.message,
      type: 'chat_list_error',
      context: error.context,
      timestamp: new Date().toISOString()
    }));
  }
}

export async function chatGetContextRoute(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const threadId = url.searchParams.get('threadId');
    
    if (!threadId) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        error: 'threadId is required',
        type: 'chat_context_error',
        timestamp: new Date().toISOString()
      }));
      return;
    }
    
    const context = await chatService.getChatContext(threadId);
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: context,
      timestamp: new Date().toISOString()
    }));
    
  } catch (error) {
    let statusCode = 500;
    if (error.message.includes('not found')) {
      statusCode = 404;
    }
    
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      error: error.message,
      type: 'chat_context_error',
      context: error.context,
      timestamp: new Date().toISOString()
    }));
  }
}

export const chatRoutes = {
  chatProcessMessageRoute,
  chatGetHistoryRoute,
  chatListChatsRoute,
  chatGetContextRoute
};

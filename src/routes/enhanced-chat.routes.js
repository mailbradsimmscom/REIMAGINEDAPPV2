import enhancedChatService from '../services/enhanced-chat.service.js';
import { logger } from '../utils/logger.js';
import { validate } from '../middleware/validate.js';
import { 
  chatListQuerySchema, 
  chatListResponseSchema,
  chatProcessRequestSchema,
  chatErrorSchema 
} from '../schemas/chat.schema.js';

export async function enhancedChatProcessMessageRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ 
        success: false,
        error: 'Method not allowed' 
      }));
      return;
    }

    let body;
    try {
      body = await getRequestBody(req);
    } catch (parseError) {
      requestLogger.error('Failed to parse request body', { error: parseError.message });
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ 
        success: false,
        error: 'Invalid JSON in request body' 
      }));
      return;
    }

    const { message, sessionId, threadId } = body;
    
    // Validate request body
    const validationResult = chatProcessRequestSchema.safeParse(body);
    if (!validationResult.success) {
      requestLogger.error('Invalid request body', { errors: validationResult.error.errors });
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ 
        success: false,
        error: 'Invalid request data',
        details: validationResult.error.errors
      }));
      return;
    }

    const { message: validatedMessage, sessionId: validatedSessionId, threadId: validatedThreadId } = validationResult.data;
    
    if (!validatedMessage || typeof validatedMessage !== 'string') {
      requestLogger.error('Invalid message parameter', { message: typeof validatedMessage });
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ 
        success: false,
        error: 'Message is required and must be a string' 
      }));
      return;
    }

    requestLogger.info('Processing enhanced chat message', { 
      messageLength: validatedMessage.length,
      sessionId: validatedSessionId || 'new',
      threadId: validatedThreadId || 'new'
    });

    const result = await enhancedChatService.processUserMessage(validatedMessage, {
      sessionId: validatedSessionId,
      threadId: validatedThreadId,
      contextSize: 5
    });

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: {
        sessionId: result.sessionId,
        threadId: result.threadId,
        userMessage: {
          id: result.userMessage.id,
          content: result.userMessage.content,
          role: result.userMessage.role,
          createdAt: result.userMessage.created_at
        },
        assistantMessage: {
          id: result.assistantMessage.id,
          content: result.assistantMessage.content,
          role: result.assistantMessage.role,
          createdAt: result.assistantMessage.created_at,
          sources: result.assistantMessage.metadata?.sources || []
        },
        systemsContext: result.systemsContext,
        enhancedQuery: result.enhancedQuery,
        sources: result.sources
      },
      timestamp: new Date().toISOString()
    }));

    requestLogger.info('Enhanced chat message processed successfully', {
      sessionId: result.sessionId,
      threadId: result.threadId,
      systemsFound: result.systemsContext.length,
      sourcesFound: result.sources.length
    });

  } catch (error) {
    requestLogger.error('Failed to process enhanced chat message', { 
      error: error.message,
      stack: error.stack
    });

    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to process message',
      details: error.message,
      timestamp: new Date().toISOString()
    }));
  }
}

export async function enhancedChatGetHistoryRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const threadId = url.searchParams.get('threadId');
    const limit = parseInt(url.searchParams.get('limit') || '50');

    if (!threadId) {
      requestLogger.error('Missing threadId parameter');
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'threadId parameter is required' }));
      return;
    }

    requestLogger.info('Getting enhanced chat history', { threadId, limit });

    const messages = await enhancedChatService.getChatHistory(threadId, { limit });

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: {
        threadId,
        messages: messages.map(msg => ({
          id: msg.id,
          content: msg.content,
          role: msg.role,
          createdAt: msg.created_at,
          metadata: msg.metadata
        })),
        count: messages.length
      },
      timestamp: new Date().toISOString()
    }));

    requestLogger.info('Enhanced chat history retrieved successfully', {
      threadId,
      messageCount: messages.length
    });

  } catch (error) {
    requestLogger.error('Failed to get enhanced chat history', { 
      error: error.message,
      stack: error.stack
    });

    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to get chat history',
      details: error.message,
      timestamp: new Date().toISOString()
    }));
  }
}

export async function enhancedChatListChatsRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const queryParams = {
      limit: url.searchParams.get('limit') || '25',
      cursor: url.searchParams.get('cursor')
    };

    const { limit, cursor } = queryParams;

    requestLogger.info('Listing enhanced chat sessions', { limit, cursor: cursor || 'none' });

    const chats = await enhancedChatService.listUserChats({ limit, cursor });

    const responseData = {
      success: true,
      data: {
        chats: chats.map(chat => ({
          id: chat.id,
          name: chat.name,
          description: chat.description,
          createdAt: chat.created_at,
          updatedAt: chat.updated_at,
          latestThread: chat.latestThread ? {
            id: chat.latestThread.id,
            name: chat.latestThread.name,
            createdAt: chat.latestThread.created_at,
            updatedAt: chat.latestThread.updated_at,
            metadata: chat.latestThread.metadata
          } : null
        })),
        count: chats.length,
        nextCursor: chats.length === limit ? chats[chats.length - 1]?.updated_at : null
      },
      timestamp: new Date().toISOString()
    };

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(responseData));

    requestLogger.info('Enhanced chat sessions listed successfully', {
      sessionCount: chats.length,
      hasNextCursor: chats.length === limit
    });

  } catch (error) {
    requestLogger.error('Failed to list enhanced chat sessions', { 
      error: error.message,
      stack: error.stack
    });

    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to list chat sessions',
      details: error.message,
      timestamp: new Date().toISOString()
    }));
  }
}

export async function enhancedChatGetContextRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const threadId = url.searchParams.get('threadId');

    if (!threadId) {
      requestLogger.error('Missing threadId parameter');
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'threadId parameter is required' }));
      return;
    }

    requestLogger.info('Getting enhanced chat context', { threadId });

    const context = await enhancedChatService.getChatContext(threadId);

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: {
        session: {
          id: context.session.id,
          name: context.session.name,
          description: context.session.description,
          createdAt: context.session.created_at,
          updatedAt: context.session.updated_at
        },
        thread: {
          id: context.thread.id,
          name: context.thread.name,
          createdAt: context.thread.created_at,
          updatedAt: context.thread.updated_at,
          metadata: context.thread.metadata
        },
        messages: context.messages.map(msg => ({
          id: msg.id,
          content: msg.content,
          role: msg.role,
          createdAt: msg.created_at,
          metadata: msg.metadata
        })),
        context: context.context
      },
      timestamp: new Date().toISOString()
    }));

    requestLogger.info('Enhanced chat context retrieved successfully', {
      threadId,
      messageCount: context.messages.length,
      hasSummary: !!context.context.summary
    });

  } catch (error) {
    requestLogger.error('Failed to get enhanced chat context', { 
      error: error.message,
      stack: error.stack
    });

    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to get chat context',
      details: error.message,
      timestamp: new Date().toISOString()
    }));
  }
}

async function getRequestBody(req) {
  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    
    try {
      const parsed = JSON.parse(rawBody);
      return parsed;
    } catch (parseError) {
      throw new Error(`Invalid JSON: ${parseError.message}`);
    }
  } catch (error) {
    throw new Error(`Failed to read request body: ${error.message}`);
  }
}

export async function enhancedChatDeleteRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    if (req.method !== 'DELETE') {
      res.statusCode = 405;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body;
    try {
      body = await getRequestBody(req);
    } catch (parseError) {
      requestLogger.error('Failed to parse request body', { error: parseError.message });
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid JSON in request body' }));
      return;
    }

    const { sessionId } = body;
    
    if (!sessionId) {
      requestLogger.error('Missing sessionId parameter');
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'sessionId is required' }));
      return;
    }

    requestLogger.info('Deleting enhanced chat session', { sessionId });

    await enhancedChatService.deleteChatSession(sessionId);

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: {
        sessionId: sessionId,
        deleted: true
      },
      timestamp: new Date().toISOString()
    }));

    requestLogger.info('Enhanced chat session deleted successfully', { sessionId });

  } catch (error) {
    requestLogger.error('Failed to delete enhanced chat session', { 
      error: error.message,
      stack: error.stack
    });

    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to delete chat session',
      details: error.message,
      timestamp: new Date().toISOString()
    }));
  }
}

export const enhancedChatRoutes = {
  enhancedChatProcessMessageRoute,
  enhancedChatGetHistoryRoute,
  enhancedChatListChatsRoute,
  enhancedChatGetContextRoute,
  enhancedChatDeleteRoute
};

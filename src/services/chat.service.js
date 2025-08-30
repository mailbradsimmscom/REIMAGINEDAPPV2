import { searchSystemsSvc } from './systems.service.js';
import { enhanceQuery, summarizeConversation, generateChatName } from './llm.service.js';
import chatRepository from '../repositories/chat.repository.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export async function processUserMessage(userQuery, { sessionId, threadId, contextSize = 4 } = {}) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    requestLogger.info('Processing user message', { userQuery: userQuery.substring(0, 100), sessionId, threadId });
    
    // Step 1: Search systems table for relevant context
    const systemsResults = await searchSystemsSvc(userQuery, { limit: 5 });
    const systemsContext = systemsResults.items || [];
    
    requestLogger.info('Systems search completed', { 
      query: userQuery.substring(0, 100), 
      resultsCount: systemsContext.length 
    });
    
    // Step 2: Enhance the query using LLM and systems context
    let enhancedQuery = userQuery;
    if (systemsContext.length > 0) {
      try {
        enhancedQuery = await enhanceQuery(userQuery, systemsContext);
        requestLogger.info('Query enhanced successfully', { 
          originalQuery: userQuery.substring(0, 100),
          enhancedQuery: enhancedQuery.substring(0, 100)
        });
      } catch (llmError) {
        requestLogger.warn('LLM enhancement failed, using original query', { 
          error: llmError.message,
          originalQuery: userQuery.substring(0, 100)
        });
      }
    }
    
    // Step 3: Create or get chat session/thread if needed
    let session = null;
    let thread = null;
    
    if (!sessionId) {
      // Create new session
      session = await chatRepository.createChatSession({
        name: 'New Chat',
        description: `Chat about: ${userQuery.substring(0, 100)}...`
      });
      sessionId = session.id;
      requestLogger.info('New chat session created', { sessionId });
    } else {
      session = await chatRepository.getChatSession(sessionId);
      requestLogger.info('Existing chat session loaded', { sessionId });
    }
    
    if (!threadId) {
      // Create new thread
      thread = await chatRepository.createChatThread({
        sessionId,
        name: 'New Thread',
        metadata: { systemsContext: systemsContext.map(s => s.id) }
      });
      threadId = thread.id;
      requestLogger.info('New chat thread created', { threadId, sessionId });
    } else {
      thread = await chatRepository.getChatThread(threadId);
      requestLogger.info('Existing chat thread loaded', { threadId });
    }
    
    // Step 4: Store user message
    const userMessage = await chatRepository.createChatMessage({
      threadId,
      role: 'user',
      content: userQuery,
      metadata: {
        originalQuery: userQuery,
        enhancedQuery,
        systemsContext: systemsContext.map(s => s.id)
      }
    });
    
    // Step 5: Get recent conversation context (last N messages)
    const recentMessages = await chatRepository.getChatMessages(threadId, { limit: contextSize });
    
    // Step 6: Generate assistant response
    const assistantResponse = await generateAssistantResponse(
      userQuery,
      enhancedQuery,
      systemsContext,
      recentMessages
    );
    
    // Step 7: Store assistant response
    const assistantMessage = await chatRepository.createChatMessage({
      threadId,
      role: 'assistant',
      content: assistantResponse,
      metadata: {
        systemsContext: systemsContext.map(s => s.id),
        enhancedQuery
      }
    });
    
    // Step 8: Update thread with latest activity
    await chatRepository.updateChatThread(threadId, {
      updated_at: new Date().toISOString()
    });
    
    // Step 9: Check if we should summarize (every N messages)
    const totalMessages = recentMessages.length + 2; // +2 for user and assistant messages we just added
    if (totalMessages >= env.summaryFrequency) {
      try {
        const summary = await summarizeConversation(recentMessages, systemsContext);
        await chatRepository.updateChatThread(threadId, {
          metadata: { 
            ...thread.metadata,
            summary,
            lastSummarizedAt: new Date().toISOString()
          }
        });
        requestLogger.info('Conversation summarized', { threadId, summaryLength: summary.length });
              } catch (summaryError) {
          requestLogger.warn('Summary generation failed', { 
            error: summaryError.message,
            threadId 
          });
        }
      }
    
    // Step 10: Generate or update thread name if it's new
    if (!thread.name || thread.name === 'New Thread') {
      try {
        const threadName = await generateChatName(recentMessages, systemsContext);
        await chatRepository.updateChatThread(threadId, { name: threadName });
        requestLogger.info('Thread name generated', { threadId, threadName });
      } catch (namingError) {
        requestLogger.warn('Thread naming failed', { 
          error: namingError.message,
          threadId 
        });
      }
    }
    
    requestLogger.info('User message processed successfully', { 
      sessionId, 
      threadId, 
      responseLength: assistantResponse.length 
    });
    
    return {
      sessionId,
      threadId,
      userMessage,
      assistantMessage,
      systemsContext,
      enhancedQuery
    };
    
  } catch (error) {
    requestLogger.error('Failed to process user message', { 
      error: error.message,
      userQuery: userQuery.substring(0, 100),
      sessionId,
      threadId
    });
    throw new Error(`Failed to process user message: ${error.message}`);
  }
}

async function generateAssistantResponse(userQuery, enhancedQuery, systemsContext, recentMessages) {
  try {
    // Build context-aware response
    let response = `I understand you're asking about: "${userQuery}"\n\n`;
    
    if (systemsContext.length > 0) {
      response += `I found ${systemsContext.length} relevant systems:\n`;
      systemsContext.forEach((system, index) => {
        response += `${index + 1}. **${system.id}** (relevance: ${system.rank.toFixed(2)})\n`;
      });
      
      response += `\nBased on this context, I can help you with questions about these systems. `;
      response += `What specific information would you like to know?`;
    } else {
      response += `I couldn't find specific systems matching your query. `;
      response += `Could you provide more details or try a different search term?`;
    }
    
    // Add conversation context if available
    if (recentMessages.length > 0) {
      response += `\n\nI can see we've been discussing related topics. `;
      response += `Feel free to ask follow-up questions or request more specific information.`;
    }
    
    return response;
    
  } catch (error) {
    return `I'm here to help! I found some relevant systems and can assist with your questions. What would you like to know more about?`;
  }
}

export async function getChatHistory(threadId, { limit = 50 } = {}) {
  try {
    const messages = await chatRepository.getChatMessages(threadId, { limit });
    return messages;
  } catch (error) {
    throw new Error(`Failed to get chat history: ${error.message}`);
  }
}

export async function listUserChats({ limit = 25, cursor } = {}) {
  try {
    const sessions = await chatRepository.listChatSessions({ limit, cursor });
    
    // Get the latest thread for each session
    const sessionsWithThreads = await Promise.all(
      sessions.map(async (session) => {
        const threads = await chatRepository.listChatThreads(session.id, { limit: 1 });
        return {
          ...session,
          latestThread: threads[0] || null
        };
      })
    );
    
    return sessionsWithThreads;
  } catch (error) {
    throw new Error(`Failed to list user chats: ${error.message}`);
  }
}

export async function getChatContext(threadId) {
  try {
    const thread = await chatRepository.getChatThread(threadId);
    const session = await chatRepository.getChatSession(thread.session_id);
    const messages = await chatRepository.getChatMessages(threadId, { limit: 10 });
    
    return {
      session,
      thread,
      messages,
      context: {
        systemsContext: thread.metadata?.systemsContext || [],
        summary: thread.metadata?.summary || null,
        lastSummarizedAt: thread.metadata?.lastSummarizedAt || null
      }
    };
  } catch (error) {
    throw new Error(`Failed to get chat context: ${error.message}`);
  }
}

export default {
  processUserMessage,
  getChatHistory,
  listUserChats,
  getChatContext
};

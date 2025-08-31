import { searchSystems } from '../repositories/systems.repository.js';
import pineconeService from './pinecone.service.js';
import { enhanceQuery, summarizeConversation, generateChatName } from './llm.service.js';
import chatRepository from '../repositories/chat.repository.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export async function processUserMessage(userQuery, { sessionId, threadId, contextSize = 5 } = {}) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    requestLogger.info('Processing user message', { 
      userQuery: userQuery.substring(0, 100), 
      sessionId, 
      threadId 
    });
    
    // Step 1: Search systems table for relevant context
    // Extract key terms from the user query for better systems search
    const searchTerms = userQuery.toLowerCase()
      .replace(/tell me about my /g, '')
      .replace(/what is my /g, '')
      .replace(/how does my /g, '')
      .replace(/where is my /g, '')
      .trim();
    
    const systemsResults = await searchSystems(searchTerms, { limit: 5 });
    const systemsContext = systemsResults || [];
    
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
    
    // Step 3: Search Pinecone for relevant documentation
    let pineconeResults = [];
    let pineconeError = null;
    
    try {
      const searchContext = {
        manufacturer: systemsContext[0]?.id?.split('_')[0] || null,
        model: systemsContext[0]?.id || null,
        previousMessages: [] // Will be populated if threadId exists
      };
      
      const pineconeResponse = await pineconeService.searchDocuments(enhancedQuery, searchContext);
      
      // Handle the Pinecone response structure
      if (pineconeResponse && pineconeResponse.success && pineconeResponse.results) {
        pineconeResults = pineconeResponse.results;
        requestLogger.info('Pinecone search completed', { 
          query: enhancedQuery.substring(0, 100),
          resultsCount: pineconeResults.length
        });
      } else {
        requestLogger.warn('Pinecone search returned no results', { 
          query: enhancedQuery.substring(0, 100),
          response: pineconeResponse
        });
      }
    } catch (error) {
      pineconeError = error;
      requestLogger.warn('Pinecone search failed', { 
        error: error.message,
        query: enhancedQuery.substring(0, 100)
      });
    }
    
    // Step 4: Create or get chat session/thread if needed
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
        metadata: { 
          systemsContext: systemsContext.map(s => s.id),
          pineconeResults: pineconeResults.length
        }
      });
      threadId = thread.id;
      requestLogger.info('New chat thread created', { threadId, sessionId });
    } else {
      thread = await chatRepository.getChatThread(threadId);
      requestLogger.info('Existing chat thread loaded', { threadId });
    }
    
    // Step 5: Store user message
    const userMessage = await chatRepository.createChatMessage({
      threadId,
      role: 'user',
      content: userQuery,
      metadata: {
        originalQuery: userQuery,
        enhancedQuery,
        systemsContext: systemsContext.map(s => s.id),
        pineconeResults: pineconeResults.length
      }
    });
    
    // Step 6: Get recent conversation context (last N messages)
    const recentMessages = await chatRepository.getChatMessages(threadId, { limit: contextSize });
    
    // Step 7: Generate assistant response with Pinecone results
    const assistantResponse = await generateEnhancedAssistantResponse(
      userQuery,
      enhancedQuery,
      systemsContext,
      pineconeResults,
      pineconeError,
      recentMessages
    );
    
    // Step 8: Store assistant response
    const assistantMessage = await chatRepository.createChatMessage({
      threadId,
      role: 'assistant',
      content: assistantResponse.content,
      metadata: {
        systemsContext: systemsContext.map(s => s.id),
        enhancedQuery,
        pineconeResults: pineconeResults.length,
        sources: assistantResponse.sources,
        hasPineconeError: !!pineconeError
      }
    });
    
    // Step 9: Update thread with latest activity
    await chatRepository.updateChatThread(threadId, {
      updated_at: new Date().toISOString()
    });
    
    // Step 10: Check if we should summarize (every N messages)
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
    
    // Step 11: Generate or update thread name if it's new
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
      responseLength: assistantResponse.content.length,
      sourcesCount: assistantResponse.sources.length
    });
    
    return {
      sessionId,
      threadId,
      userMessage,
      assistantMessage,
      systemsContext,
      enhancedQuery,
      pineconeResults,
      sources: assistantResponse.sources
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

async function generateEnhancedAssistantResponse(userQuery, enhancedQuery, systemsContext, pineconeResults, pineconeError, recentMessages) {
  try {
    let response = `I understand you're asking about: **"${userQuery}"**\n\n`;
    let sources = [];
    
    // Add systems context
    if (systemsContext.length > 0) {
      response += `## Systems Found\n`;
      response += `I found ${systemsContext.length} relevant systems in your database:\n`;
      systemsContext.forEach((system, index) => {
        response += `${index + 1}. **${system.id}** (relevance: ${system.rank.toFixed(2)})\n`;
      });
      response += `\n`;
    } else {
      response += `I couldn't find specific systems matching your query in your database. `;
      response += `Could you provide more details or try a different search term?\n\n`;
    }
    
    // Add Pinecone documentation results
    if (pineconeResults.length > 0) {
      response += `## Documentation Found\n`;
      response += `I found relevant documentation for your question:\n\n`;
      
      pineconeResults.forEach((result, index) => {
        response += `### ${result.manufacturer} ${result.model}\n`;
        response += `**Relevance Score:** ${result.bestScore.toFixed(3)}\n`;
        
        if (result.chunks && result.chunks.length > 0) {
          response += `**Document Information:**\n`;
          result.chunks.forEach((chunk, chunkIndex) => {
            if (chunk.content && chunk.content.trim()) {
              response += `> ${chunk.content.substring(0, 200)}${chunk.content.length > 200 ? '...' : ''}\n`;
            } else {
              response += `> Page ${chunk.page} - Document section available\n`;
            }
          });
          
          // Add source attribution
          const source = {
            manufacturer: result.manufacturer,
            model: result.model,
            filename: result.filename || 'Unknown Document',
            pages: [...new Set(result.chunks.map(c => c.page).filter(p => p))],
            score: result.bestScore
          };
          sources.push(source);
        }
        
        response += `\n`;
      });
      
      response += `Based on this documentation, I can help you with specific questions about these systems. `;
      response += `What would you like to know more about?\n\n`;
    } else if (pineconeError) {
      response += `## Documentation Search\n`;
      response += `I encountered an issue searching the documentation database. `;
      response += `However, I can still help you with information about your systems.\n\n`;
    } else {
      response += `## Documentation Search\n`;
      response += `I couldn't find specific documentation matching your query. `;
      response += `This might mean the documentation hasn't been uploaded yet, or you might need to try different search terms.\n\n`;
    }
    
    // Add conversation context if available
    if (recentMessages.length > 0) {
      response += `## Conversation Context\n`;
      response += `I can see we've been discussing related topics. `;
      response += `Feel free to ask follow-up questions or request more specific information.\n\n`;
    }
    
    // Add source attribution footer
    if (sources.length > 0) {
      response += `---\n`;
      response += `**Sources:**\n`;
      sources.forEach((source, index) => {
        const pages = source.pages.length > 0 ? ` (Pages: ${source.pages.join(', ')})` : '';
        response += `${index + 1}. ${source.manufacturer} ${source.model}${pages}\n`;
      });
    }
    
    return { content: response, sources };
    
  } catch (error) {
    const fallbackResponse = `I'm here to help! I found some relevant systems and can assist with your questions. What would you like to know more about?`;
    return { content: fallbackResponse, sources: [] };
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

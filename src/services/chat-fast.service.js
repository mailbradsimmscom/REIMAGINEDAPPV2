import { v4 as uuidv4 } from 'uuid';
import {
  createChatMessageWithSequence as createMessage,
  updateChatMessage as updateMessage,
  getChatMessageById as getMessage,
  incrementThreadMessageCount
} from '../repositories/chat.repository.js';
import { checkAndGenerateSummary, checkAndGenerateQASummary } from './thread-summary.service.js';
import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';

const requestLogger = logger.createRequestLogger();

/**
 * Fast chat service for two-call mode
 * Creates messages immediately and returns cached state for quick response
 */
class ChatFastService {
  /**
   * Process a fast chat request
   * @param {Object} params
   * @param {string} params.message - User message
   * @param {string} params.threadId - Thread ID
   * @param {string} params.sessionId - Session ID
   * @param {number} params.sequenceNumber - Message sequence number
   * @param {string} params.synthesisModel - Model to use
   * @returns {Object} Fast response with cached state
   */
  async processFastChat({ message, threadId, sessionId, sequenceNumber, synthesisModel = 'gpt-5' }) {
    const env = getEnv();

    // Double-check two-call mode is enabled
    if (env.TWO_CALL_MODE !== 'true') {
      throw new Error('Fast chat endpoint requires TWO_CALL_MODE to be enabled');
    }

    try {
      // 1. Create user message in database
      const userMessageId = uuidv4();
      const userMessage = await createMessage({
        threadId: threadId,
        role: 'user',
        content: message,
        sequenceNumber: sequenceNumber,
        metadata: {
          id: userMessageId,
          session_id: sessionId,
          mode: 'two-call',
          synthesis_model: synthesisModel
        }
      });

      // Increment thread message count for user message
      await incrementThreadMessageCount(threadId);

      requestLogger.info('Created user message', {
        messageId: userMessageId,
        sequenceNumber,
        threadId
      });

      // 2. Create placeholder assistant message
      const assistantMessageId = uuidv4();
      const assistantSequence = sequenceNumber + 1;

      // 3. Call Python sidecar for fast processing with cached state
      const pythonResponse = await this.callPythonFastEndpoint({
        message,
        threadId,
        sessionId,
        synthesisModel,
        returnCachedState: true
      });

      // 4. Create assistant message with initial content
      const assistantMessage = await createMessage({
        threadId: threadId,
        role: 'assistant',
        content: pythonResponse.message || 'Processing your request...',
        sequenceNumber: assistantSequence,
        metadata: {
          id: assistantMessageId,
          session_id: sessionId,
          mode: 'two-call',
          is_complete: false,
          cached_state: pythonResponse.cachedState
        }
      });

      // Increment thread message count for assistant message
      await incrementThreadMessageCount(threadId);

      // Check if we need to generate summaries (async, don't block response)
      checkAndGenerateSummary(threadId, assistantSequence, 'assistant');
      checkAndGenerateQASummary(threadId, assistantSequence, 'assistant');

      requestLogger.info('Created assistant message with cached state', {
        messageId: assistantMessageId,
        sequenceNumber: assistantSequence,
        hasCachedState: !!pythonResponse.cachedState
      });

      return {
        userMessage: {
          id: userMessageId,
          content: message,
          role: 'user',
          sequenceNumber,
          createdAt: userMessage.created_at
        },
        assistantMessage: {
          id: assistantMessageId,
          content: assistantMessage.content,
          role: 'assistant',
          sequenceNumber: assistantSequence,
          createdAt: assistantMessage.created_at,
          isComplete: false
        },
        cachedState: pythonResponse.cachedState
      };
    } catch (error) {
      requestLogger.error('Fast chat processing failed', {
        error: error.message,
        threadId,
        sequenceNumber
      });
      throw error;
    }
  }

  /**
   * Call Python sidecar for fast processing
   */
  async callPythonFastEndpoint({ message, threadId, sessionId, synthesisModel, returnCachedState }) {
    const env = getEnv();
    const pythonUrl = env.PYTHON_SIDECAR_URL || 'http://localhost:8000';
    const endpoint = `${pythonUrl}/chat/fast`;
    const timeout = 15000; // 15 second timeout for fast response

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: message,
          thread_id: threadId,
          session_id: sessionId,
          synthesis_model: synthesisModel,
          return_cached_state: returnCachedState,
          cache_config: {
            chunks: parseInt(env.PINECONE_CHUNKS_FOR_CACHE || '5'),
            chunk_size: parseInt(env.PINECONE_CHUNK_SIZE || '1000')
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Python sidecar error: ${response.status} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Python sidecar timeout after ${timeout}ms`);
      }
      if (error.message.includes('fetch failed')) {
        throw new Error('Python sidecar is not running. Please start it first.');
      }
      throw error;
    }
  }

  /**
   * Process web enrichment for an existing message
   */
  async processWebEnrichment({ threadId, sequenceNumber, messageId, cachedState }) {
    const env = getEnv();

    if (env.TWO_CALL_MODE !== 'true') {
      throw new Error('Web enrichment endpoint requires TWO_CALL_MODE to be enabled');
    }

    try {
      // Get current message content
      const currentMessage = await getMessage(messageId);
      const originalContent = currentMessage.content || '';

      // Call Python sidecar for web enrichment
      const pythonResponse = await this.callPythonWebEnrichment({
        threadId,
        messageId,
        cachedState
      });

      // Combine original content with enriched content
      const separator = '\n\n---\n\n📚 **Web Research:**\n\n';
      const combinedContent = originalContent + separator + pythonResponse.enrichedContent;

      // Update the assistant message with combined content
      await updateMessage(messageId, {
        content: combinedContent,
        metadata: {
          ...currentMessage.metadata,
          is_complete: true,
          web_sources: pythonResponse.webSources,
          enrichment_completed_at: new Date().toISOString()
        }
      });

      requestLogger.info('Web enrichment completed', {
        messageId,
        threadId,
        sourcesCount: pythonResponse.webSources?.length || 0
      });

      return {
        messageId,
        enrichedContent: combinedContent,  // Return the combined content
        webSources: pythonResponse.webSources,
        isComplete: true
      };
    } catch (error) {
      requestLogger.error('Web enrichment failed', {
        error: error.message,
        messageId,
        threadId
      });

      // Mark message as complete even on error to avoid stuck state
      await updateMessage(messageId, {
        metadata: {
          is_complete: true,
          enrichment_error: error.message
        }
      });

      throw error;
    }
  }

  /**
   * Call Python sidecar for web enrichment
   */
  async callPythonWebEnrichment({ threadId, messageId, cachedState }) {
    const env = getEnv();
    const pythonUrl = env.PYTHON_SIDECAR_URL || 'http://localhost:8000';
    const endpoint = `${pythonUrl}/chat/enrich-web`;
    const timeout = parseInt(env.WEB_ENRICHMENT_TIMEOUT_MS || '60000');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          thread_id: threadId,
          message_id: messageId,
          cached_state: cachedState
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Python sidecar error: ${response.status} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Web enrichment timed out after ${timeout}ms`);
      }
      if (error.message.includes('fetch failed')) {
        throw new Error('Python sidecar is not running. Please start it first.');
      }
      throw error;
    }
  }
}

export const chatFastService = new ChatFastService();
export default chatFastService;
// src/services/memory.service.js
import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { logger } from '../utils/logger.js';

/**
 * Drop-in replacement for LangChain's PostgresChatMessageHistory
 * Uses your existing Supabase chat_threads and chat_messages tables
 */
export class SupabaseMemoryManager {
  // Static cache to prevent race conditions on thread creation
  static threadCache = new Map();

  constructor(threadId) {
    this.threadId = threadId;
    this.requestLogger = logger.createRequestLogger();
  }

  /**
   * Add a message to chat history
   */
  async addMessage(role, content, metadata = {}) {
    try {
      const supabase = await getSupabaseClient();

      // Ensure thread exists
      await this.ensureThread();

      // Add the message
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          thread_id: this.threadId,
          role: role, // 'user', 'assistant', 'system'
          content: content,
          metadata: metadata,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      // Update message count
      await this.incrementMessageCount();

      this.requestLogger.debug('Message added to memory', {
        threadId: this.threadId,
        messageId: data.id,
        role: role
      });

      return data;
    } catch (error) {
      this.requestLogger.error('Failed to add message to memory', {
        error: error.message,
        threadId: this.threadId
      });
      throw error;
    }
  }

  /**
   * Get chat history with token limit consideration
   */
  async getMessages(limit = 10, maxTokens = 4000) {
    try {
      const supabase = await getSupabaseClient();

      // Fetch messages
      const { data: messages, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('thread_id', this.threadId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      // Reverse to get chronological order
      const chronologicalMessages = (messages || []).reverse();

      // Token limiting (approximate - 4 chars per token)
      let tokenCount = 0;
      const limitedMessages = [];

      for (let i = chronologicalMessages.length - 1; i >= 0; i--) {
        const msg = chronologicalMessages[i];
        const msgTokens = Math.ceil(msg.content.length / 4);

        if (tokenCount + msgTokens > maxTokens && limitedMessages.length > 0) {
          break;
        }

        limitedMessages.unshift(msg);
        tokenCount += msgTokens;
      }

      return limitedMessages;
    } catch (error) {
      this.requestLogger.error('Failed to get messages', {
        error: error.message,
        threadId: this.threadId
      });
      return [];
    }
  }

  /**
   * Format messages for OpenAI API
   */
  async getFormattedHistory(systemPrompt = null) {
    const messages = await this.getMessages();

    const formatted = [];

    // Add system prompt if provided
    if (systemPrompt) {
      formatted.push({
        role: 'system',
        content: systemPrompt
      });
    }

    // Add conversation history
    messages.forEach(msg => {
      formatted.push({
        role: msg.role,
        content: msg.content
      });
    });

    return formatted;
  }

  /**
   * Clear chat history for this thread
   */
  async clearHistory() {
    try {
      const supabase = await getSupabaseClient();

      const { error } = await supabase
        .from('chat_messages')
        .delete()
        .eq('thread_id', this.threadId);

      if (error) throw error;

      // Reset message count
      await supabase
        .from('chat_threads')
        .update({ message_count: 0 })
        .eq('id', this.threadId);

      this.requestLogger.info('Chat history cleared', { threadId: this.threadId });
    } catch (error) {
      this.requestLogger.error('Failed to clear history', {
        error: error.message,
        threadId: this.threadId
      });
    }
  }

  /**
   * Get equipment context for this thread
   */
  async getEquipmentContext() {
    try {
      const supabase = await getSupabaseClient();

      const { data: thread, error } = await supabase
        .from('chat_threads')
        .select('equipment_context')
        .eq('id', this.threadId)
        .single();

      if (error) throw error;

      return thread?.equipment_context || [];
    } catch (error) {
      this.requestLogger.error('Failed to get equipment context', {
        error: error.message,
        threadId: this.threadId
      });
      return [];
    }
  }

  /**
   * Update equipment context for this thread
   */
  async updateEquipmentContext(equipmentArray) {
    try {
      const supabase = await getSupabaseClient();

      const { error } = await supabase
        .from('chat_threads')
        .update({
          equipment_context: equipmentArray,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.threadId);

      if (error) throw error;

      this.requestLogger.debug('Equipment context updated', {
        threadId: this.threadId,
        equipmentCount: equipmentArray.length
      });

      return true;
    } catch (error) {
      this.requestLogger.error('Failed to update equipment context', {
        error: error.message,
        threadId: this.threadId
      });
      throw error;
    }
  }

  /**
   * Get or create a thread
   * Uses cache to prevent race conditions
   */
  async ensureThread() {
    // Check cache first
    if (SupabaseMemoryManager.threadCache.has(this.threadId)) {
      return SupabaseMemoryManager.threadCache.get(this.threadId);
    }

    const supabase = await getSupabaseClient();

    // Check if thread exists
    let { data: thread } = await supabase
      .from('chat_threads')
      .select('*')
      .eq('id', this.threadId)
      .single();

    // Create if doesn't exist
    if (!thread) {
      const { data: newThread, error } = await supabase
        .from('chat_threads')
        .insert({
          id: this.threadId,
          name: 'New Thread',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          equipment_context: [],
          message_count: 0
        })
        .select()
        .single();

      if (error) {
        // Handle race condition - thread was created by another request
        if (error.code === '23505') { // Duplicate key error
          const { data: existingThread } = await supabase
            .from('chat_threads')
            .select('*')
            .eq('id', this.threadId)
            .single();
          thread = existingThread;
        } else {
          throw error;
        }
      } else {
        thread = newThread;
      }
    }

    // Cache the thread
    SupabaseMemoryManager.threadCache.set(this.threadId, thread);

    return thread;
  }

  /**
   * Increment message count for this thread
   */
  async incrementMessageCount() {
    try {
      const supabase = await getSupabaseClient();

      await supabase.rpc('increment_thread_message_count', {
        thread_id_param: this.threadId
      });
    } catch (error) {
      // Non-critical - just log
      this.requestLogger.warn('Failed to increment message count', {
        error: error.message,
        threadId: this.threadId
      });
    }
  }

  /**
   * Get conversation summary (for long conversations)
   */
  async getSummary() {
    try {
      const supabase = await getSupabaseClient();

      const { data: thread } = await supabase
        .from('chat_threads')
        .select('thread_summary, message_count, created_at, updated_at')
        .eq('id', this.threadId)
        .single();

      if (!thread) return null;

      return {
        summary: thread.thread_summary,
        messageCount: thread.message_count,
        createdAt: thread.created_at,
        updatedAt: thread.updated_at
      };
    } catch (error) {
      this.requestLogger.error('Failed to get summary', {
        error: error.message,
        threadId: this.threadId
      });
      return null;
    }
  }

  /**
   * Update thread summary
   */
  async updateSummary(summary) {
    try {
      const supabase = await getSupabaseClient();

      const { error } = await supabase
        .from('chat_threads')
        .update({
          thread_summary: summary,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.threadId);

      if (error) throw error;

      this.requestLogger.debug('Thread summary updated', {
        threadId: this.threadId
      });

      return true;
    } catch (error) {
      this.requestLogger.error('Failed to update summary', {
        error: error.message,
        threadId: this.threadId
      });
      throw error;
    }
  }

  /**
   * Clear thread cache (for testing or manual cleanup)
   */
  static clearCache(threadId = null) {
    if (threadId) {
      SupabaseMemoryManager.threadCache.delete(threadId);
    } else {
      SupabaseMemoryManager.threadCache.clear();
    }
  }
}

// Helper function for backward compatibility
export function createMemoryManager(threadId) {
  return new SupabaseMemoryManager(threadId);
}

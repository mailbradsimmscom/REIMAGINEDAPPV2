// src/services/chat-completion.service.js
import OpenAI from 'openai';
import { SupabaseMemoryManager } from './memory.service.js';
import { getEnv } from '../config/env.js';
import { isOpenAIConfigured } from './guards/index.js';
import { logger } from '../utils/logger.js';

/**
 * Chat Completion Service
 * Direct OpenAI chat completion with Supabase memory management
 * Replaces: Python LangGraph workflow
 */

let openaiClient = null;

/**
 * Get or create OpenAI client (singleton)
 * @returns {Promise<OpenAI>}
 */
async function getOpenAIClient() {
  if (!openaiClient) {
    const env = getEnv();
    openaiClient = new OpenAI({
      apiKey: env.OPENAI_API_KEY
    });
  }
  return openaiClient;
}

/**
 * Build system prompt with all context
 * @param {Object} params
 * @returns {string} System prompt
 */
function buildSystemPrompt({
  systemsContext = [],
  dipResults = [],
  documentChunks = [],
  conversationSummary = null,
  equipmentInference = null
}) {
  let prompt = `You are a helpful marine equipment assistant. Answer questions accurately based on the provided context.\n\n`;

  // Add conversation summary if available
  if (conversationSummary) {
    prompt += `## Conversation Summary\n${conversationSummary}\n\n`;
  }

  // Add equipment context
  if (systemsContext.length > 0) {
    prompt += `## Equipment Context\n`;
    systemsContext.forEach((system, idx) => {
      const manufacturer = system.manufacturer_norm || system.manufacturer || 'Unknown';
      const model = system.model_norm || system.model || 'Unknown';
      prompt += `${idx + 1}. **${manufacturer} ${model}**\n`;
      if (system.description) {
        prompt += `   ${system.description}\n`;
      }
      if (system.relationship_type) {
        prompt += `   Relationship: ${system.relationship_type}\n`;
      }
    });
    prompt += `\n`;
  }

  // Add equipment relationship inference if available
  if (equipmentInference) {
    prompt += `## Equipment Relationship Inference\n`;
    prompt += `${equipmentInference}\n\n`;
  }

  // Add document chunks from Pinecone
  if (documentChunks.length > 0) {
    prompt += `## Relevant Documentation\n`;
    documentChunks.forEach((chunk, idx) => {
      const content = chunk.content.substring(0, 600);
      const score = chunk.score?.toFixed(3) || 'N/A';
      prompt += `[${idx + 1}] (Score: ${score}) ${content}\n\n`;
    });
  }

  // Add DIP results
  if (dipResults.length > 0) {
    prompt += `## Domain Intelligence\n`;
    dipResults.forEach(table => {
      prompt += `### ${table.table} (${table.count} results)\n`;
      if (table.results && table.results.length > 0) {
        table.results.forEach((result, idx) => {
          // Format result based on table structure
          // This is a simple JSON dump - can be enhanced based on actual table schemas
          const resultStr = JSON.stringify(result, null, 2);
          prompt += `${idx + 1}. ${resultStr.substring(0, 300)}\n`;
        });
      }
      prompt += `\n`;
    });
  }

  prompt += `## Instructions\n`;
  prompt += `- Answer the user's question directly and concisely\n`;
  prompt += `- Use specific technical details from the documentation when available\n`;
  prompt += `- If you don't have enough information, say so\n`;
  prompt += `- Be professional, accurate, and helpful\n`;

  return prompt;
}

/**
 * Process chat completion with full context
 * @param {Object} params
 * @param {string} params.query - User query
 * @param {string} params.threadId - Thread ID for memory management
 * @param {Array} params.systemsContext - Equipment/systems context
 * @param {Array} params.dipResults - DIP table results
 * @param {Array} params.documentChunks - Pinecone document chunks
 * @param {string} params.conversationSummary - Conversation summary (optional)
 * @param {Object} params.equipmentInference - Equipment relationship inference (optional)
 * @returns {Promise<Object>} { response, usage }
 */
export async function processChatCompletion({
  query,
  threadId,
  systemsContext = [],
  dipResults = [],
  documentChunks = [],
  conversationSummary = null,
  equipmentInference = null
}) {
  const requestLogger = logger.createRequestLogger();
  const env = getEnv();

  if (!isOpenAIConfigured()) {
    throw new Error('OpenAI not configured');
  }

  try {
    // Initialize memory manager
    const memory = new SupabaseMemoryManager(threadId);

    // Get conversation history (limit to last 10 messages, max 4000 tokens)
    const conversationHistory = await memory.getMessages(10, 4000);

    requestLogger.debug('Retrieved conversation history', {
      threadId,
      messageCount: conversationHistory.length
    });

    // Build system prompt with all context
    const systemPrompt = buildSystemPrompt({
      systemsContext,
      dipResults,
      documentChunks,
      conversationSummary,
      equipmentInference
    });

    // Build messages array for OpenAI
    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history
    conversationHistory.forEach(msg => {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    });

    // Add current user query
    messages.push({
      role: 'user',
      content: query
    });

    // Log full messages array for debugging
    requestLogger.info('📤 OpenAI Request Messages', {
      threadId,
      messageCount: messages.length,
      model: env.OPENAI_MODEL || 'gpt-4',
      messages: messages.map((msg, idx) => ({
        index: idx,
        role: msg.role,
        content: msg.content,
        contentLength: msg.content.length
      }))
    });

    requestLogger.debug('Calling OpenAI chat completion', {
      threadId,
      messageCount: messages.length,
      model: env.OPENAI_MODEL || 'gpt-4'
    });

    // Call OpenAI
    const openai = await getOpenAIClient();
    const model = env.OPENAI_MODEL || 'gpt-4';

    // GPT-5 doesn't support temperature parameter, only default value of 1
    const completionParams = {
      model,
      messages: messages,
      max_completion_tokens: parseInt(env.OPENAI_MAX_TOKENS || '8000')
    };

    // Only add temperature for models that support it (not gpt-5)
    if (!model.toLowerCase().includes('gpt-5')) {
      completionParams.temperature = parseFloat(env.OPENAI_TEMPERATURE || '0');
    }

    const completion = await openai.chat.completions.create(completionParams);

    const response = completion.choices[0].message.content;

    requestLogger.info('Chat completion completed', {
      threadId,
      responseLength: response.length,
      tokensUsed: completion.usage.total_tokens,
      promptTokens: completion.usage.prompt_tokens,
      completionTokens: completion.usage.completion_tokens
    });

    return {
      response,
      usage: completion.usage
    };
  } catch (error) {
    requestLogger.error('Chat completion failed', {
      error: error.message,
      threadId,
      query: query?.substring(0, 100)
    });
    throw error;
  }
}

export default {
  processChatCompletion
};

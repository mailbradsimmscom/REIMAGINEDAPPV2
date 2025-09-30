import { getChatThread, updateChatThread, getChatMessages } from '../repositories/chat.repository.js';
import { oaiText } from '../clients/openai.client.js';
import { logger } from '../utils/logger.js';

const NAMING_PROMPT = `You are an expert at creating concise, descriptive thread names for marine equipment conversations.

USER QUERY: "{userQuery}"
ASSISTANT RESPONSE: "{assistantResponse}"
EQUIPMENT CONTEXT: {equipmentContext}

Based on this conversation exchange, generate a concise thread name (2-6 words) that captures the main topic or question.

Guidelines:
- Focus on the equipment and specific topic (e.g. "Fortress Anchor Specifications", "Watermaker Troubleshooting", "GPS Installation Guide")
- Include manufacturer/model if mentioned and relevant
- Keep it under 50 characters
- Make it descriptive but not a full sentence
- Use title case

Examples:
- "Fortress FX-37 Anchor Setup"
- "Watermaker Filter Replacement"
- "Radar Display Issues"
- "Engine Oil Change Procedure"

Generate just the thread name, nothing else:`;

/**
 * Check if a thread needs naming (has default name and this is first/second message)
 */
export async function shouldNameThread(threadId) {
  try {
    const thread = await getChatThread(threadId);
    if (!thread) return false;

    // Check if thread has default name
    const hasDefaultName = !thread.name ||
                          thread.name === 'New Thread' ||
                          thread.name === 'New Chat' ||
                          thread.name.startsWith('Thread ');

    if (!hasDefaultName) return false;

    // Check message count - name after first complete exchange
    const messages = await getChatMessages(threadId, { limit: 10 });
    const messageCount = messages.length;

    // Should name after 1st user message + 1st assistant response (exactly 2 messages)
    return messageCount === 2;

  } catch (error) {
    logger.warn('Failed to check if thread needs naming', {
      threadId,
      error: error.message
    });
    return false;
  }
}

/**
 * Generate a smart thread name using LLM
 */
export async function generateThreadName(userQuery, assistantResponse, equipmentContext = []) {
  try {
    // Format equipment context
    let equipmentText = 'None specified';
    if (equipmentContext && equipmentContext.length > 0) {
      equipmentText = equipmentContext.map(eq =>
        `${eq.manufacturer || ''} ${eq.model || ''}`.trim()
      ).filter(name => name).join(', ');
    }

    const userPrompt = NAMING_PROMPT
      .replace('{userQuery}', userQuery.substring(0, 200))
      .replace('{assistantResponse}', assistantResponse.substring(0, 300))
      .replace('{equipmentContext}', equipmentText);

    const threadName = await oaiText({
      system: 'You are an expert at creating concise thread names.',
      user: userPrompt,
      model: 'gpt-4o-mini',
      maxOutputTokens: 20
    });

    // Clean up the name (remove quotes, ensure reasonable length)
    const cleanName = threadName
      .replace(/^["']|["']$/g, '') // Remove surrounding quotes
      .substring(0, 50) // Limit length
      .trim();

    logger.info('Generated thread name', {
      originalQuery: userQuery.substring(0, 100),
      generatedName: cleanName
    });

    return cleanName;

  } catch (error) {
    logger.error('Failed to generate thread name', {
      error: error.message,
      userQuery: userQuery.substring(0, 100)
    });

    // Fallback to simple extraction from user query
    return generateFallbackThreadName(userQuery, equipmentContext);
  }
}

/**
 * Fallback thread naming when LLM is not available
 */
function generateFallbackThreadName(userQuery, equipmentContext = []) {
  try {
    // Try to extract meaningful keywords
    const words = userQuery.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .filter(word => !['tell', 'about', 'what', 'how', 'when', 'where', 'the', 'and', 'for'].includes(word));

    // Get equipment name if available
    let equipmentPrefix = '';
    if (equipmentContext && equipmentContext.length > 0) {
      const eq = equipmentContext[0];
      equipmentPrefix = `${eq.manufacturer || ''} ${eq.model || ''}`.trim();
    }

    // Create thread name
    let threadName;
    if (equipmentPrefix && words.length > 0) {
      threadName = `${equipmentPrefix} ${words.slice(0, 2).join(' ')}`;
    } else if (equipmentPrefix) {
      threadName = `${equipmentPrefix} Discussion`;
    } else if (words.length > 0) {
      threadName = words.slice(0, 3).join(' ');
    } else {
      threadName = 'Marine Equipment Chat';
    }

    // Title case and limit length
    return threadName
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .substring(0, 50);

  } catch (error) {
    logger.error('Fallback thread naming failed', { error: error.message });
    return 'Marine Equipment Chat';
  }
}

/**
 * Update thread with generated name
 */
export async function nameThread(threadId, userQuery, assistantResponse, equipmentContext = []) {
  try {
    const threadName = await generateThreadName(userQuery, assistantResponse, equipmentContext);

    // Get existing thread to preserve metadata
    const existingThread = await getChatThread(threadId);

    await updateChatThread(threadId, {
      name: threadName,
      metadata: {
        ...(existingThread.metadata || {}),
        auto_named: true,
        named_at: new Date().toISOString(),
        original_query: userQuery.substring(0, 200)
      }
    });

    logger.info('Thread named successfully', {
      threadId,
      threadName,
      originalQuery: userQuery.substring(0, 100)
    });

    return threadName;

  } catch (error) {
    logger.error('Failed to name thread', {
      threadId,
      error: error.message,
      userQuery: userQuery.substring(0, 100)
    });

    // Don't throw - thread naming is non-critical
    return null;
  }
}

export default {
  shouldNameThread,
  generateThreadName,
  nameThread
};
import { searchSystems } from '../repositories/systems.repository.js';
import { getChatMessages } from '../repositories/chat.repository.js';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

function extractKeywords(query) {
  const stopWords = new Set(['tell', 'me', 'about', 'my', 'the', 'a', 'an', 'is', 'are', 'what', 'how', 'when', 'where', 'why', 'which', 'who', 'can', 'could', 'would', 'should', 'will', 'do', 'does', 'did', 'has', 'have', 'had', 'be', 'been', 'being', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'from', 'by', 'it', 'its', 'this', 'that', 'these', 'those']);

  const words = query.toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));

  return words.join(' ');
}

async function getConversationContext(threadId) {
  if (!threadId) return null;

  try {
    const messages = await getChatMessages(threadId, { limit: 5 });

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.metadata?.systems_context && msg.metadata.systems_context.length > 0) {
        return msg.metadata.systems_context;
      }
    }
  } catch (error) {
    return null;
  }

  return null;
}

export async function processChatMessage({ query, sessionId, threadId }) {
  const requestLogger = logger.createRequestLogger();
  const env = getEnv();

  try {
    const searchQuery = extractKeywords(query) || query;
    let matchingSystems = [];

    if (searchQuery && searchQuery !== query) {
      requestLogger.info('🔍 Searching systems table for matching equipment', {
        originalQuery: query.substring(0, 100),
        searchQuery: searchQuery.substring(0, 100)
      });

      matchingSystems = await searchSystems(searchQuery, { limit: 10 });
    }

    if (matchingSystems.length === 0 && threadId) {
      requestLogger.info('⏮️  No equipment found via search, checking conversation history');
      const contextSystems = await getConversationContext(threadId);

      if (contextSystems && contextSystems.length > 0) {
        requestLogger.info('✅ Found equipment context from previous messages', {
          count: contextSystems.length
        });
        matchingSystems = contextSystems;
      }
    }

    requestLogger.info('✅ Found matching systems', {
      count: matchingSystems.length,
      assetUids: matchingSystems.map(s => s.asset_uid)
    });

    const systemsContext = matchingSystems.map(system => ({
      asset_uid: system.asset_uid,
      manufacturer: system.manufacturer,
      model: system.model,
      description: system.description
    }));

    requestLogger.info('📞 Calling python-sidecar with systems context', {
      systemsCount: systemsContext.length,
      sidecarUrl: `${env.PYTHON_SIDECAR_URL}/v1/chat/process`
    });

    const sidecarResponse = await fetch(`${env.PYTHON_SIDECAR_URL}/v1/chat/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        session_id: sessionId,
        thread_id: threadId,
        systems_context: systemsContext,
        table_types: ['spec', 'procedure', 'troubleshooting', 'routing']
      })
    });

    if (!sidecarResponse.ok) {
      const errorText = await sidecarResponse.text();
      throw new Error(`Python sidecar error: ${sidecarResponse.status} ${errorText}`);
    }

    const result = await sidecarResponse.json();

    requestLogger.info('✅ Python sidecar response received', {
      hasResponse: !!result.response,
      hasDipResults: !!result.dip_results
    });

    result.systems_context = systemsContext;

    return result;

  } catch (error) {
    requestLogger.error('❌ Chat proxy error', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

export default {
  processChatMessage
};
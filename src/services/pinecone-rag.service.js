// src/services/pinecone-rag.service.js
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { getEnv } from '../config/env.js';
import { isPineconeConfigured, isOpenAIConfigured } from './guards/index.js';
import { logger } from '../utils/logger.js';

/**
 * Pinecone RAG Service
 * Semantic search in Pinecone for document chunks during chat
 */

let pineconeClient = null;
let openaiClient = null;

/**
 * Get or create Pinecone client (singleton)
 * @returns {Promise<Pinecone>}
 */
async function getPineconeClient() {
  if (!pineconeClient) {
    const env = getEnv();
    pineconeClient = new Pinecone({
      apiKey: env.PINECONE_API_KEY
    });
  }
  return pineconeClient;
}

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
 * Search for relevant document chunks using semantic search
 * @param {Object} params
 * @param {string} params.query - User query
 * @param {Array} params.equipmentContext - Equipment context for metadata filtering
 * @param {string} params.namespace - Pinecone namespace (default: REIMAGINEDDOCS)
 * @param {number} params.limit - Maximum number of results (default: 5)
 * @returns {Promise<Array>} Array of document chunks with scores
 */
export async function searchDocuments({ query, equipmentContext = [], namespace, limit = 5 }) {
  const requestLogger = logger.createRequestLogger();
  const env = getEnv();

  if (!isPineconeConfigured()) {
    requestLogger.warn('Pinecone not configured, skipping document search');
    return [];
  }

  if (!isOpenAIConfigured()) {
    requestLogger.warn('OpenAI not configured, skipping document search');
    return [];
  }

  try {
    const openai = await getOpenAIClient();
    const pinecone = await getPineconeClient();

    // Generate embedding for query using text-embedding-3-large (3072 dimensions)
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: query
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    requestLogger.debug('Query embedding generated', {
      query: query.substring(0, 100),
      embeddingDimensions: queryEmbedding.length
    });

    // Build metadata filter from equipment context
    const filter = {};
    if (equipmentContext.length > 0) {
      const assetUids = equipmentContext.map(eq => eq.asset_uid).filter(Boolean);
      if (assetUids.length > 0) {
        filter.asset_uid = { $in: assetUids };
      }
    }

    // Query Pinecone
    const indexName = env.PINECONE_INDEX || 'reimaginedsv';
    const namespaceName = namespace || env.PINECONE_NAMESPACE || 'REIMAGINEDDOCS';

    const index = pinecone.index(indexName);
    const queryResponse = await index.namespace(namespaceName).query({
      vector: queryEmbedding,
      topK: limit,
      includeMetadata: true,
      filter: Object.keys(filter).length > 0 ? filter : undefined
    });

    // Transform results to chunks
    const chunks = queryResponse.matches.map(match => ({
      id: match.id,
      score: match.score,
      content: match.metadata?.text || '',
      metadata: match.metadata || {},
      asset_uid: match.metadata?.asset_uid || null,
      page: match.metadata?.page_no || match.metadata?.page_start || null
    }));

    const avgScore = chunks.length > 0
      ? (chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length).toFixed(3)
      : 0;

    requestLogger.info('Pinecone document search completed', {
      query: query.substring(0, 100),
      chunksFound: chunks.length,
      avgScore,
      equipmentFilter: equipmentContext.length > 0 ? equipmentContext.length : 'none',
      namespace: namespaceName
    });

    return chunks;
  } catch (error) {
    requestLogger.error('Pinecone document search failed', {
      error: error.message,
      query: query?.substring(0, 100)
    });
    return [];
  }
}

/**
 * Get document chunks for a specific asset
 * @param {Object} params
 * @param {string} params.assetUid - Asset UID to filter by
 * @param {string} params.namespace - Pinecone namespace (default: REIMAGINEDDOCS)
 * @param {number} params.limit - Maximum number of results (default: 10)
 * @returns {Promise<Array>} Array of document chunks
 */
export async function getDocumentChunks({ assetUid, namespace, limit = 10 }) {
  const requestLogger = logger.createRequestLogger();
  const env = getEnv();

  if (!isPineconeConfigured()) {
    requestLogger.warn('Pinecone not configured, skipping asset document retrieval');
    return [];
  }

  try {
    const pinecone = await getPineconeClient();

    const indexName = env.PINECONE_INDEX || 'reimaginedsv';
    const namespaceName = namespace || env.PINECONE_NAMESPACE || 'REIMAGINEDDOCS';

    // Create a filter for the specific asset
    const filter = { asset_uid: assetUid };

    // Query with a zero vector (we just want to fetch by metadata)
    const index = pinecone.index(indexName);

    // For metadata-only queries, we can use fetch if we have IDs,
    // or query with a filter. Since we don't have IDs, use query with filter
    // Note: This requires at least one vector, so we'll skip this for now
    // and recommend using searchDocuments with equipment context instead

    requestLogger.warn('getDocumentChunks by asset UID requires vector query', {
      assetUid,
      recommendation: 'Use searchDocuments with equipmentContext instead'
    });

    return [];
  } catch (error) {
    requestLogger.error('Failed to get document chunks for asset', {
      error: error.message,
      assetUid
    });
    return [];
  }
}

export default {
  searchDocuments,
  getDocumentChunks
};

import pineconeRepository from '../repositories/pinecone.repository.js';
import { logger } from '../utils/logger.js';

class PineconeService {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  // Search documents with intelligent query processing
  async searchDocuments(userQuery, context = {}) {
    try {
      this.requestLogger.info('Starting document search', { 
        query: userQuery.substring(0, 100),
        context: Object.keys(context)
      });

      // Build enhanced query with context
      const enhancedQuery = await this.buildEnhancedQuery(userQuery, context);
      
      // Search vectors
      const searchResults = await pineconeRepository.searchVectors(enhancedQuery, {
        topK: 20,
        includeMetadata: true,
        includeValues: false
      });

      // Process and rank results
      const processedResults = await this.processSearchResults(searchResults, userQuery, context);

      this.requestLogger.info('Document search completed', {
        originalQuery: userQuery.substring(0, 100),
        enhancedQuery: enhancedQuery.substring(0, 100),
        resultsCount: processedResults.length
      });

      return {
        success: true,
        query: userQuery,
        enhancedQuery,
        results: processedResults,
        metadata: {
          totalResults: processedResults.length,
          searchTime: new Date().toISOString()
        }
      };

    } catch (error) {
      this.requestLogger.error('Document search failed', { 
        error: error.message,
        query: userQuery?.substring(0, 100)
      });
      throw error;
    }
  }

  // Build enhanced query using context and systems data
  async buildEnhancedQuery(userQuery, context = {}) {
    try {
      let enhancedQuery = userQuery;

      // Add context from previous conversation
      if (context.previousMessages && context.previousMessages.length > 0) {
        const recentContext = context.previousMessages
          .slice(-3) // Last 3 messages
          .map(msg => msg.content)
          .join(' ');
        enhancedQuery = `${enhancedQuery} ${recentContext}`;
      }

      // Add system context if available
      if (context.systemInfo) {
        enhancedQuery = `${enhancedQuery} ${context.systemInfo}`;
      }

      // Add manufacturer/model context if available
      if (context.manufacturer || context.model) {
        const equipmentContext = [context.manufacturer, context.model]
          .filter(Boolean)
          .join(' ');
        enhancedQuery = `${enhancedQuery} ${equipmentContext}`;
      }

      this.requestLogger.info('Enhanced query built', {
        originalQuery: userQuery.substring(0, 100),
        enhancedQuery: enhancedQuery.substring(0, 100)
      });

      return enhancedQuery;

    } catch (error) {
      this.requestLogger.error('Failed to build enhanced query', { error: error.message });
      return userQuery; // Fallback to original query
    }
  }

  // Process and rank search results
  async processSearchResults(searchResults, originalQuery, context = {}) {
    try {
      if (!searchResults.matches || searchResults.matches.length === 0) {
        return [];
      }

      const processedResults = searchResults.matches.map(match => {
        const metadata = match.metadata || {};
        
        return {
          id: match.id,
          score: match.score,
          content: metadata.content || metadata.text || '',
          documentId: metadata.doc_id || '',
          manufacturer: metadata.manufacturer || '',
          model: metadata.model || '',
          page: metadata.page || 0,
          chunkIndex: metadata.chunk_index || 0,
          chunkType: metadata.chunk_type || 'text',
          revisionDate: metadata.revision_date || '',
          filename: metadata.file_name || metadata.filename || '',
          relevanceScore: this.calculateRelevanceScore(match, originalQuery, context)
        };
      });

      // Sort by relevance score
      processedResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Group by document and deduplicate
      const groupedResults = this.groupResultsByDocument(processedResults);

      this.requestLogger.info('Search results processed', {
        originalCount: searchResults.matches.length,
        processedCount: groupedResults.length
      });

      return groupedResults;

    } catch (error) {
      this.requestLogger.error('Failed to process search results', { error: error.message });
      return [];
    }
  }

  // Calculate relevance score based on multiple factors
  calculateRelevanceScore(match, originalQuery, context = {}) {
    try {
      let score = match.score || 0;
      const metadata = match.metadata || {};

      // Boost score for exact manufacturer/model matches
      if (context.manufacturer && metadata.manufacturer) {
        if (metadata.manufacturer.toLowerCase().includes(context.manufacturer.toLowerCase())) {
          score += 0.2;
        }
      }

      if (context.model && metadata.model) {
        if (metadata.model.toLowerCase().includes(context.model.toLowerCase())) {
          score += 0.2;
        }
      }

      // Boost score for recent documents
      if (metadata.revision_date) {
        const docDate = new Date(metadata.revision_date);
        const currentDate = new Date();
        const yearsDiff = (currentDate - docDate) / (1000 * 60 * 60 * 24 * 365);
        if (yearsDiff < 2) {
          score += 0.1;
        }
      }

      // Boost score for table content (often more structured)
      if (metadata.chunk_type === 'table') {
        score += 0.1;
      }

      return Math.min(score, 1.0); // Cap at 1.0

    } catch (error) {
      this.requestLogger.error('Failed to calculate relevance score', { error: error.message });
      return match.score || 0;
    }
  }

  // Group results by document and deduplicate
  groupResultsByDocument(results) {
    try {
      const documentGroups = new Map();

      results.forEach(result => {
        const docId = result.documentId;
        
        if (!documentGroups.has(docId)) {
          documentGroups.set(docId, {
            documentId: docId,
            manufacturer: result.manufacturer,
            model: result.model,
            filename: result.filename,
            revisionDate: result.revisionDate,
            bestScore: result.relevanceScore,
            chunks: []
          });
        }

        const group = documentGroups.get(docId);
        group.chunks.push({
          id: result.id,
          score: result.score,
          relevanceScore: result.relevanceScore,
          content: result.content,
          page: result.page,
          chunkIndex: result.chunkIndex,
          chunkType: result.chunkType
        });

        // Update best score
        if (result.relevanceScore > group.bestScore) {
          group.bestScore = result.relevanceScore;
        }
      });

      // Convert to array and sort by best score
      const groupedResults = Array.from(documentGroups.values());
      groupedResults.sort((a, b) => b.bestScore - a.bestScore);

      return groupedResults;

    } catch (error) {
      this.requestLogger.error('Failed to group results by document', { error: error.message });
      return results;
    }
  }

  // Get document chunks by document ID
  async getDocumentChunks(documentId, options = {}) {
    try {
      const {
        topK = 50,
        namespace = null
      } = options;

      // Search for chunks from specific document
      const searchResults = await pineconeRepository.searchVectors('', {
        topK,
        namespace,
        filter: {
          doc_id: { $eq: documentId }
        },
        includeMetadata: true,
        includeValues: false
      });

      const chunks = searchResults.matches?.map(match => ({
        id: match.id,
        score: match.score,
        content: (match.metadata?.content ?? match.metadata?.text ?? match.metadata?.raw ?? ''),
        page: match.metadata?.page || 0,
        chunkIndex: match.metadata?.chunk_index || 0,
        chunkType: match.metadata?.chunk_type || 'text'
      })) || [];

      // Sort by page and chunk index
      chunks.sort((a, b) => {
        if (a.page !== b.page) return a.page - b.page;
        return a.chunkIndex - b.chunkIndex;
      });

      this.requestLogger.info('Document chunks retrieved', {
        documentId,
        chunksCount: chunks.length
      });

      return chunks;

    } catch (error) {
      this.requestLogger.error('Failed to get document chunks', { 
        error: error.message,
        documentId
      });
      throw error;
    }
  }

  // Get index statistics
  async getIndexStatistics() {
    try {
      const stats = await pineconeRepository.getIndexStats();
      
      return {
        totalVectors: stats.total_vector_count,
        dimension: stats.dimension,
        indexFullness: stats.index_fullness,
        namespaces: stats.namespaces,
        lastUpdated: new Date().toISOString()
      };

    } catch (error) {
      this.requestLogger.error('Failed to get index statistics', { error: error.message });
      throw error;
    }
  }
}

export default new PineconeService();

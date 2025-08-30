import { logger } from '../utils/logger.js';

class PineconeRepository {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
    this.sidecarUrl = process.env.PYTHON_SIDECAR_URL || 'http://localhost:8000';
  }

  // Get index statistics
  async getIndexStats() {
    try {
      const response = await fetch(`${this.sidecarUrl}/v1/pinecone/stats`);
      
      if (!response.ok) {
        throw new Error(`Failed to get Pinecone stats: ${response.status}`);
      }
      
      const stats = await response.json();
      
      this.requestLogger.info('Pinecone index stats retrieved', {
        totalVectors: stats.total_vector_count,
        dimension: stats.dimension
      });
      
      return stats;
    } catch (error) {
      this.requestLogger.error('Failed to get Pinecone index stats', { error: error.message });
      throw error;
    }
  }

  // Search vectors with metadata filtering
  async searchVectors(query, options = {}) {
    try {
      const {
        topK = 10,
        namespace = process.env.PINECONE_NAMESPACE || 'REIMAGINEDDOCS',
        filter = {},
        includeMetadata = true,
        includeValues = false
      } = options;

      const searchPayload = {
        query,
        topK,
        namespace,
        filter,
        includeMetadata,
        includeValues
      };

      const response = await fetch(`${this.sidecarUrl}/v1/pinecone/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(searchPayload)
      });

      if (!response.ok) {
        throw new Error(`Failed to search Pinecone: ${response.status}`);
      }

      const results = await response.json();
      
      this.requestLogger.info('Pinecone search completed', {
        query: query.substring(0, 100),
        topK,
        namespace,
        resultsCount: results.matches?.length || 0
      });
      
      return results;
    } catch (error) {
      this.requestLogger.error('Failed to search Pinecone vectors', { 
        error: error.message,
        query: query?.substring(0, 100)
      });
      throw error;
    }
  }

  // Get vector by ID
  async getVectorById(vectorId, namespace = process.env.PINECONE_NAMESPACE || 'REIMAGINEDDOCS') {
    try {
      const response = await fetch(`${this.sidecarUrl}/v1/pinecone/fetch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ids: [vectorId],
          namespace
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch vector: ${response.status}`);
      }

      const result = await response.json();
      
      this.requestLogger.info('Vector fetched by ID', { vectorId, namespace });
      
      return result;
    } catch (error) {
      this.requestLogger.error('Failed to fetch vector by ID', { 
        error: error.message,
        vectorId,
        namespace
      });
      throw error;
    }
  }

  // Delete vectors by ID
  async deleteVectors(vectorIds, namespace = process.env.PINECONE_NAMESPACE || 'REIMAGINEDDOCS') {
    try {
      const response = await fetch(`${this.sidecarUrl}/v1/pinecone/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ids: vectorIds,
          namespace
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to delete vectors: ${response.status}`);
      }

      const result = await response.json();
      
      this.requestLogger.info('Vectors deleted', { 
        vectorIds: vectorIds.length,
        namespace
      });
      
      return result;
    } catch (error) {
      this.requestLogger.error('Failed to delete vectors', { 
        error: error.message,
        vectorIds: vectorIds.length,
        namespace
      });
      throw error;
    }
  }

  // Get namespace statistics
  async getNamespaceStats(namespace = process.env.PINECONE_NAMESPACE || 'REIMAGINEDDOCS') {
    try {
      const stats = await this.getIndexStats();
      
      if (stats.namespaces && stats.namespaces[namespace]) {
        return {
          namespace,
          vectorCount: stats.namespaces[namespace].vector_count,
          totalVectors: stats.total_vector_count
        };
      }
      
      return {
        namespace,
        vectorCount: 0,
        totalVectors: stats.total_vector_count
      };
    } catch (error) {
      this.requestLogger.error('Failed to get namespace stats', { 
        error: error.message,
        namespace
      });
      throw error;
    }
  }
}

export default new PineconeRepository();

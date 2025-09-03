import { logger } from '../utils/logger.js';

class PineconeRepository {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  // Get sidecar URL at runtime
  async getSidecarUrl() {
    const { getEnv } = await import('../config/env.js');
    const env = getEnv({ loose: true });
    return env.PYTHON_SIDECAR_URL;
  }

  // Get namespace at runtime
  async getNamespace() {
    const { getEnv } = await import('../config/env.js');
    const env = getEnv({ loose: true });
    return env.PINECONE_NAMESPACE || env.DEFAULT_NAMESPACE || null;
  }

  // Get index statistics
  async getIndexStats() {
    try {
      const sidecarUrl = await this.getSidecarUrl();
      const response = await fetch(`${sidecarUrl}/v1/pinecone/stats`);
      
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
      const sidecarUrl = await this.getSidecarUrl();
      const namespace = await this.getNamespace();
      
      const {
        topK = 10,
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

      const response = await fetch(`${sidecarUrl}/v1/pinecone/search`, {
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
  async getVectorById(vectorId, namespace = null) {
    try {
      const sidecarUrl = await this.getSidecarUrl();
      const defaultNamespace = await this.getNamespace();
      const targetNamespace = namespace || defaultNamespace;
      
      const response = await fetch(`${sidecarUrl}/v1/pinecone/fetch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ids: [vectorId],
          namespace: targetNamespace
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch vector: ${response.status}`);
      }

      const result = await response.json();
      
      this.requestLogger.info('Vector fetched by ID', { vectorId, namespace: targetNamespace });
      
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
  async deleteVectors(vectorIds, namespace = null) {
    try {
      const sidecarUrl = await this.getSidecarUrl();
      const defaultNamespace = await this.getNamespace();
      const targetNamespace = namespace || defaultNamespace;
      
      const response = await fetch(`${sidecarUrl}/v1/pinecone/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ids: vectorIds,
          namespace: targetNamespace
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to delete vectors: ${response.status}`);
      }

      const result = await response.json();
      
      this.requestLogger.info('Vectors deleted', { 
        vectorIds: vectorIds.length,
        namespace: targetNamespace
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
  async getNamespaceStats(namespace = null) {
    try {
      const defaultNamespace = await this.getNamespace();
      const targetNamespace = namespace || defaultNamespace;
      
      const stats = await this.getIndexStats();
      
      if (stats.namespaces && stats.namespaces[targetNamespace]) {
        return {
          namespace: targetNamespace,
          vectorCount: stats.namespaces[targetNamespace].vector_count,
          totalVectors: stats.total_vector_count
        };
      }
      
      return {
        namespace: targetNamespace,
        vectorCount: 0,
        totalVectors: stats.total_vector_count
      };
    } catch (error) {
      this.requestLogger.error('Failed to get namespace stats', { 
        error: error.message,
        namespace: targetNamespace
      });
      throw error;
    }
  }
}

export default new PineconeRepository();

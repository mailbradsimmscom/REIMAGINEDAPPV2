import { Pinecone } from '@pinecone-database/pinecone';
import { env } from '../config/env.js';

let pineconeClient = null;
let index = null;

function getPineconeClient() {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey: env.pineconeApiKey
    });
  }
  return pineconeClient;
}

function getIndex() {
  if (!index) {
    const client = getPineconeClient();
    index = client.index(env.pineconeIndex);
  }
  return index;
}

export async function searchVectors(queryVector, { topK = 5, filter = {} } = {}) {
  try {
    const pineconeIndex = getIndex();
    const queryResponse = await pineconeIndex.query({
      vector: queryVector,
      topK,
      filter,
      includeMetadata: true,
      includeValues: false
    });
    
    return queryResponse.matches || [];
  } catch (error) {
    const err = new Error(`Pinecone vector search failed: ${error.message}`);
    err.cause = error;
    err.context = { 
      operation: 'vector_search', 
      topK, 
      filter,
      indexName: env.pineconeIndex 
    };
    throw err;
  }
}

export async function searchByText(text, { topK = 5, filter = {} } = {}) {
  try {
    // Note: Pinecone SDK v2 requires vectors, not text
    // For now, we'll use a more realistic vector to test metadata
    // In production, you'll need to convert text to embeddings first
    
    // Create a vector with some variation instead of all zeros
    const placeholderVector = new Array(3072).fill(0).map((_, i) => 
      Math.sin(i * 0.1) * 0.1 // Small variations to avoid exact matches
    );
    
    const pineconeIndex = getIndex();
    
    // Try different filter approaches
    let queryResponse;
    
    // First try: no filter (might work in some Pinecone configurations)
    try {
      queryResponse = await pineconeIndex.query({
        vector: placeholderVector,
        topK,
        includeMetadata: true,
        includeValues: false
      });
    } catch (filterError) {
      // If no filter fails, try with a minimal filter
      queryResponse = await pineconeIndex.query({
        vector: placeholderVector,
        topK,
        filter: { _exists: "metadata" }, // Try a different filter approach
        includeMetadata: true,
        includeValues: false
      });
    }
    
    return queryResponse.matches || [];
  } catch (error) {
    const err = new Error(`Pinecone text search failed: ${error.message}`);
    err.cause = error;
    err.context = { 
      operation: 'text_search', 
      query: text,
      topK, 
      filter,
      indexName: env.pineconeIndex 
    };
    throw err;
  }
}

export async function getIndexStats() {
  try {
    const pineconeIndex = getIndex();
    const stats = await pineconeIndex.describeIndexStats();
    return stats;
  } catch (error) {
    const err = new Error(`Failed to get Pinecone index stats: ${error.message}`);
    err.cause = error;
    err.context = { 
      operation: 'get_stats', 
      indexName: env.pineconeIndex 
    };
    throw err;
  }
}

export async function fetchSampleVectors({ topK = 3 } = {}) {
  try {
    const pineconeIndex = getIndex();
    
    // Try to fetch vectors without any filter first
    const fetchResponse = await pineconeIndex.fetch({
      ids: [], // Empty array to get a sample
      includeMetadata: true,
      includeValues: false
    });
    
    // If that doesn't work, try a different approach
    // Get the first few vectors by ID if we can determine them
    return fetchResponse.vectors || {};
  } catch (error) {
    const err = new Error(`Failed to fetch sample vectors: ${error.message}`);
    err.cause = error;
    err.context = { 
      operation: 'fetch_samples', 
      topK,
      indexName: env.pineconeIndex 
    };
    throw err;
  }
}

export default { searchVectors, searchByText, getIndexStats, fetchSampleVectors };

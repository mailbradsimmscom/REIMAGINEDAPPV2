import { z } from 'zod';

// Pinecone stats query parameters (currently none, but ready for future)
export const pineconeStatsQuerySchema = z.object({});

// Pinecone stats response schema
export const pineconeStatsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    totalVectors: z.number(),
    dimension: z.number(),
    indexFullness: z.number(),
    namespaces: z.record(z.object({
      vector_count: z.number()
    })),
    lastUpdated: z.string()
  })
});

// Pinecone search request schema
export const pineconeSearchRequestSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty'),
  topK: z.number().int().min(1).max(100).default(10),
  namespace: z.string().optional(),
  filter: z.record(z.any()).optional()
});

// Pinecone search response schema
export const pineconeSearchResponseSchema = z.object({
  success: z.literal(true),
  query: z.string(),
  enhancedQuery: z.string(),
  results: z.array(z.object({
    documentId: z.string(),
    manufacturer: z.string(),
    model: z.string(),
    filename: z.string(),
    revisionDate: z.string(),
    bestScore: z.number(),
    chunks: z.array(z.object({
      id: z.string(),
      score: z.number(),
      relevanceScore: z.number(),
      content: z.string(),
      page: z.number(),
      chunkIndex: z.number(),
      chunkType: z.string()
    }))
  })),
  metadata: z.object({
    totalResults: z.number(),
    searchTime: z.string()
  })
});

// Pinecone error response schema
export const pineconeErrorSchema = z.object({
  success: z.literal(false),
  error: z.string()
});

import { z } from 'zod';

// Shared error envelope schema
const ErrorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional()
  })
});

// Pinecone stats query parameters (currently none, but ready for future)
export const pineconeStatsQuerySchema = z.object({});

// Pinecone stats success response schema
const PineconeStatsOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
    totalVectors: z.number(),
    dimension: z.number(),
    indexFullness: z.number(),
    namespaces: z.record(z.string(), z.object({
      vector_count: z.number()
    })),
    lastUpdated: z.string()
  })
});

// Discriminated union for pinecone stats endpoint
export const pineconeStatsResponseSchema = z.union([PineconeStatsOkSchema, ErrorEnvelopeSchema]);

// Pinecone search request schema
export const pineconeSearchRequestSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty'),
  topK: z.number().int().min(1).max(100).default(10),
  namespace: z.string().optional(),
  filter: z.record(z.any()).optional()
});

// Pinecone search success response schema
const PineconeSearchOkSchema = z.object({
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

// Discriminated union for pinecone search endpoint
export const pineconeSearchResponseSchema = z.union([PineconeSearchOkSchema, ErrorEnvelopeSchema]);

// Pinecone document chunks path parameters
export const pineconeDocumentChunksPathSchema = z.object({
  docId: z.string().min(1, 'Document ID is required')
});

// Pinecone document chunks success response schema
const PineconeDocumentChunksOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
    documentId: z.string(),
    chunks: z.array(z.object({
      id: z.string(),
      score: z.number(),
      content: z.string(),
      page: z.number(),
      chunkIndex: z.number(),
      chunkType: z.string()
    })),
    totalChunks: z.number()
  })
});

// Discriminated union for pinecone document chunks endpoint
export const pineconeDocumentChunksResponseSchema = z.union([PineconeDocumentChunksOkSchema, ErrorEnvelopeSchema]);

// Pinecone query request schema
export const pineconeQueryRequestSchema = z.object({
  query: z.string().min(1, 'Query is required and must be a non-empty string'),
  context: z.record(z.string(), z.any()).optional().default({}),
  options: z.record(z.string(), z.any()).optional().default({})
});

// Pinecone query success response schema
const PineconeQueryOkSchema = z.object({
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

// Discriminated union for pinecone query endpoint
export const pineconeQueryResponseSchema = z.union([PineconeQueryOkSchema, ErrorEnvelopeSchema]);

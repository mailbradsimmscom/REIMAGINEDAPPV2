import { z } from 'zod';
import { paginationSchema } from './common.schema.js';

// Admin health response schema
export const adminHealthResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    status: z.string(),
    timestamp: z.string(),
    uptime: z.number(),
    memory: z.object({
      rss: z.number(),
      heapTotal: z.number(),
      heapUsed: z.number(),
      external: z.number()
    }),
    environment: z.string(),
    version: z.string()
  })
});

// Admin manufacturers response schema
export const adminManufacturersResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    total: z.number(),
    top: z.array(z.object({
      manufacturer_norm: z.string()
    })),
    lastUpdated: z.string()
  })
});

// Admin models query parameters
export const adminModelsQuerySchema = z.object({
  manufacturer: z.string().min(1, 'Manufacturer parameter is required')
});

// Admin models response schema
export const adminModelsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    models: z.array(z.object({
      model_norm: z.string(),
      manufacturer_norm: z.string()
    })),
    count: z.number(),
    manufacturer: z.string(),
    lastUpdated: z.string()
  })
});

// Admin logs query parameters
export const adminLogsQuerySchema = z.object({
  level: z.enum(['all', 'error', 'warn', 'info', 'debug']).default('all'),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  correlationId: z.string().optional()
});

// Admin logs response schema
export const adminLogsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    logs: z.array(z.object({
      timestamp: z.string(),
      level: z.string(),
      message: z.string(),
      correlationId: z.string().optional(),
      metadata: z.record(z.any()).optional()
    })),
    count: z.number(),
    timestamp: z.string()
  })
});

// Admin systems response schema
export const adminSystemsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    totalSystems: z.number(),
    lastUpdated: z.string(),
    databaseStatus: z.string(),
    documentsCount: z.number(),
    jobsCount: z.number()
  })
});

// Admin pinecone response schema
export const adminPineconeResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    status: z.string(),
    index: z.string(),
    namespace: z.string(),
    vectors: z.union([z.string(), z.number()]),
    totalVectors: z.number(),
    dimension: z.union([z.string(), z.number()]),
    indexFullness: z.string(),
    lastChecked: z.string(),
    sidecarHealth: z.object({
      status: z.string(),
      version: z.string().optional(),
      tesseractAvailable: z.boolean().optional(),
      error: z.string().optional()
    })
  })
});

// Admin jobs response schema
export const adminJobsResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(z.object({
    id: z.string(),
    status: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    document_id: z.string().optional(),
    error: z.string().optional()
  }))
});

// Admin documents response schema
export const adminDocumentsResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(z.object({
    id: z.string(),
    filename: z.string(),
    status: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    file_size: z.number().optional(),
    pages: z.number().optional()
  }))
});

// Admin error response schema
export const adminErrorSchema = z.object({
  error: z.string(),
  type: z.string()
});

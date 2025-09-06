import { z } from 'zod';
import { paginationQuerySchema } from './common.schema.js';

// Shared error envelope schema
const ErrorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional()
  })
});

// Admin health success response schema
const AdminHealthOkSchema = z.object({
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

// Discriminated union for admin health endpoint
export const adminHealthResponseSchema = z.union([AdminHealthOkSchema, ErrorEnvelopeSchema]);

// Admin manufacturers success response schema
const AdminManufacturersOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
    total: z.number(),
    top: z.array(z.object({
      manufacturer_norm: z.string()
    })),
    lastUpdated: z.string()
  })
});

// Discriminated union for admin manufacturers endpoint
export const adminManufacturersResponseSchema = z.union([AdminManufacturersOkSchema, ErrorEnvelopeSchema]);

// Admin models query parameters
export const adminModelsQuerySchema = z.object({
  manufacturer: z.string().min(1, 'Manufacturer parameter is required').optional()
});

// Admin models success response schema
const AdminModelsOkSchema = z.object({
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

// Discriminated union for admin models endpoint
export const adminModelsResponseSchema = z.union([AdminModelsOkSchema, ErrorEnvelopeSchema]);

// Admin logs query parameters
export const adminLogsQuerySchema = z.object({
  level: z.enum(['all', 'error', 'warn', 'info', 'debug']).default('all'),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  correlationId: z.string().optional()
});

// Admin logs success response schema
const AdminLogsOkSchema = z.object({
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

// Discriminated union for admin logs endpoint
export const adminLogsResponseSchema = z.union([AdminLogsOkSchema, ErrorEnvelopeSchema]);

// Admin systems success response schema
const AdminSystemsOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
    totalSystems: z.number(),
    lastUpdated: z.string(),
    databaseStatus: z.string(),
    documentsCount: z.number(),
    jobsCount: z.number()
  })
});

// Discriminated union for admin systems endpoint
export const adminSystemsResponseSchema = z.union([AdminSystemsOkSchema, ErrorEnvelopeSchema]);

// Admin pinecone success response schema
const AdminPineconeOkSchema = z.object({
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

// Discriminated union for admin pinecone endpoint
export const adminPineconeResponseSchema = z.union([AdminPineconeOkSchema, ErrorEnvelopeSchema]);

// Admin jobs success response schema
const AdminJobsOkSchema = z.object({
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

// Discriminated union for admin jobs endpoint
export const adminJobsResponseSchema = z.union([AdminJobsOkSchema, ErrorEnvelopeSchema]);

// Admin documents success response schema
const AdminDocumentsOkSchema = z.object({
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

// Discriminated union for admin documents endpoint
export const adminDocumentsResponseSchema = z.union([AdminDocumentsOkSchema, ErrorEnvelopeSchema]);

// Admin envelope schemas for Phase 3 tightening
import { EnvelopeSuccessSchema, EnvelopeErrorSchema } from './envelope.schema.js';

// Admin health envelope schema
const AdminHealthData = z.object({
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
});

export const AdminHealthEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: AdminHealthData }),
  EnvelopeErrorSchema
]);

// Admin manufacturers envelope schema
const AdminManufacturersData = z.object({
  total: z.number(),
  top: z.array(z.object({
    manufacturer_norm: z.string()
  })),
  lastUpdated: z.string()
});

export const AdminManufacturersEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: AdminManufacturersData }),
  EnvelopeErrorSchema
]);

// Admin models envelope schema
const AdminModelsData = z.object({
  models: z.array(z.object({
    model_norm: z.string(),
    manufacturer_norm: z.string()
  })),
  count: z.number(),
  manufacturer: z.string(),
  lastUpdated: z.string()
});

export const AdminModelsEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: AdminModelsData }),
  EnvelopeErrorSchema
]);

// Admin logs envelope schema
const AdminLogsData = z.object({
  logs: z.array(z.object({
    timestamp: z.string(),
    level: z.string(),
    message: z.string(),
    correlationId: z.string().optional(),
    metadata: z.record(z.any()).optional()
  })),
  count: z.number(),
  timestamp: z.string()
});

export const AdminLogsEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: AdminLogsData }),
  EnvelopeErrorSchema
]);

// Admin systems envelope schema
const AdminSystemsData = z.object({
  totalSystems: z.number(),
  lastUpdated: z.string(),
  databaseStatus: z.string(),
  documentsCount: z.number(),
  jobsCount: z.number()
});

export const AdminSystemsEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: AdminSystemsData }),
  EnvelopeErrorSchema
]);

// Admin pinecone envelope schema
const AdminPineconeData = z.object({
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
});

export const AdminPineconeEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: AdminPineconeData }),
  EnvelopeErrorSchema
]);

// Admin metrics data schema
const AdminMetricsData = z.object({
  timeframe: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  chatHealth: z.object({
    totalRequests: z.number(),
    requestsPerMinute: z.number(),
    p95Latency: z.number(),
    errorRate: z.number(),
    errorCount: z.number(),
    successCount: z.number()
  }),
  retrievalQuality: z.object({
    avgRawCount: z.number(),
    avgPassedFloorCount: z.number(),
    avgFilteredCount: z.number(),
    specHitRate: z.number(),
    totalQueries: z.number(),
    topUnitMatches: z.object({
      psi: z.number(),
      bar: z.number(),
      volt: z.number(),
      amp: z.number(),
      hz: z.number(),
      celsius: z.number(),
      fahrenheit: z.number()
    })
  }),
  openaiUsage: z.object({
    totalCalls: z.number(),
    callsPerMinute: z.number(),
    totalInputTokens: z.number(),
    totalOutputTokens: z.number(),
    tokensPerMinute: z.number(),
    estimatedCost: z.number(),
    retryCount: z.number(),
    rateLimitCount: z.number()
  }),
  systemHealth: z.object({
    uptime: z.number(),
    memoryUsage: z.any(),
    environment: z.string()
  }),
  recentErrors: z.array(z.any()),
  lastUpdated: z.string(),
  dataSource: z.string()
});

export const AdminMetricsEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: AdminMetricsData }),
  EnvelopeErrorSchema
]);

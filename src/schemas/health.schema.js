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

// Health success response schema
const HealthOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
    status: z.literal('ok'),
    ts: z.string()
  })
});

// Discriminated union for health endpoint responses
export const healthResponseSchema = z.union([HealthOkSchema, ErrorEnvelopeSchema]);

// Health query schema (if needed for future endpoints)
export const healthQuerySchema = z.object({
  // Add query parameters if needed
}).optional();

// Admin health schemas (separate from main health domain)
export const adminHealthResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    timestamp: z.string(),
    uptime: z.number(),
    memory: z.object({
      rss: z.number(),
      heapTotal: z.number(),
      heapUsed: z.number(),
      external: z.number(),
      arrayBuffers: z.number()
    }),
    environment: z.string(),
    version: z.string()
  })
});

export const adminHealthErrorSchema = z.object({
  error: z.string(),
  type: z.literal('admin_health_error')
});

import { z } from 'zod';
import { EnvelopeSuccessSchema, EnvelopeErrorSchema } from './envelope.schema.js';

// Basic health check response data
const BasicHealthData = z.object({
  status: z.literal('healthy'),
  timestamp: z.string().datetime(),
  uptime: z.number()
});

// Service status response data
const ServiceStatusData = z.object({
  status: z.enum(['healthy', 'degraded']),
  services: z.object({
    supabase: z.boolean(),
    pinecone: z.boolean(),
    openai: z.boolean(),
    sidecar: z.boolean()
  }),
  timestamp: z.string().datetime()
});

// Readiness check response data
const ReadinessData = z.object({
  status: z.literal('ready'),
  timestamp: z.string().datetime()
});

// Health route envelope schemas
export const BasicHealthEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: BasicHealthData }),
  EnvelopeErrorSchema
]);

export const ServiceStatusEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: ServiceStatusData }),
  EnvelopeErrorSchema
]);

export const ReadinessEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: ReadinessData }),
  EnvelopeErrorSchema
]);

// Legacy schema for backward compatibility
export const healthResponseSchema = z.object({
  status: z.string(),
  timestamp: z.string(),
  uptime: z.number().optional()
});

// Health query schema (if needed for future endpoints)
export const healthQuerySchema = z.object({
  // Add query parameters if needed
}).optional();

// Empty query schema for simple GET routes
export const EmptyQuery = z.object({}).passthrough();

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

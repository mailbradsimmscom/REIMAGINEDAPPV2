import { z } from 'zod';

// Health check query parameters
export const healthQuerySchema = z.object({
  detailed: z.enum(['true', 'false']).optional().transform(val => val === 'true')
}).passthrough();

// Basic health check response schema
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number()
});

// Admin health check response schema
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

// Admin health error response schema
export const adminHealthErrorSchema = z.object({
  error: z.string(),
  type: z.literal('admin_health_error')
});

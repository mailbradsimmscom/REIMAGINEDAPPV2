import { z } from 'zod';

// Common schemas used across multiple endpoints
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const idSchema = z.object({
  id: z.string().min(1)
});

// Query parameter schemas
export const querySchema = z.object({
  q: z.string().optional(),
  ...paginationSchema.shape
});

// Empty object schema for endpoints with no parameters
export const emptySchema = z.object({});

// Global error response schema
export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string().min(1, 'Error message is required')
});

// Global success response schema
export const successResponseSchema = z.object({
  success: z.literal(true),
  data: z.any()
});

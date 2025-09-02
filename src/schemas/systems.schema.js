import { z } from 'zod';

// Systems list query parameters
export const systemsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().optional()
}).passthrough();

// Systems get path parameters
export const systemsGetPathSchema = z.object({
  assetUid: z.string().min(1, 'Asset UID is required')
});

// Systems list response schema
export const systemsListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    systems: z.array(z.object({
      asset_uid: z.string(),
      name: z.string(),
      description: z.string().optional(),
      category: z.string().optional(),
      manufacturer: z.string().optional(),
      model: z.string().optional(),
      created_at: z.string(),
      updated_at: z.string()
    })),
    nextCursor: z.string().nullable()
  })
});

// Systems search query parameters
export const systemsSearchQuerySchema = z.object({
  q: z.string().min(2, 'Query must be at least 2 characters').max(100, 'Query too long'),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).passthrough();

// Systems search response schema
export const systemsSearchResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    systems: z.array(z.object({
      asset_uid: z.string(),
      name: z.string(),
      description: z.string().optional(),
      category: z.string().optional(),
      manufacturer: z.string().optional(),
      model: z.string().optional(),
      rank: z.number(),
      created_at: z.string(),
      updated_at: z.string()
    })),
    meta: z.object({
      floor: z.number(),
      maxRows: z.number(),
      rawCount: z.number(),
      filteredCount: z.number(),
      query: z.string()
    })
  })
});

// Systems get by ID response schema
export const systemsGetResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    asset_uid: z.string(),
    name: z.string(),
    description: z.string().optional(),
    category: z.string().optional(),
    manufacturer: z.string().optional(),
    model: z.string().optional(),
    created_at: z.string(),
    updated_at: z.string()
  })
});

// Systems error response schema
export const systemsErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  type: z.string().optional(),
  context: z.any().optional(),
  timestamp: z.string().optional()
});

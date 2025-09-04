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

// Systems list query parameters
export const systemsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().optional()
}).passthrough();

// Systems get path parameters
export const systemsGetPathSchema = z.object({
  assetUid: z.string().min(1, 'Asset UID is required')
});

// UUID validation schema for params
export const UUIDParam = z.object({
  assetUid: z.string().uuid('assetUid must be a valid UUID'),
});

// Systems list success response schema
const SystemsListOkSchema = z.object({
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

// Discriminated union for systems list endpoint
export const systemsListResponseSchema = z.union([SystemsListOkSchema, ErrorEnvelopeSchema]);

// Systems search query parameters
export const systemsSearchQuerySchema = z.object({
  q: z.string().min(2, 'Query must be at least 2 characters').max(100, 'Query too long'),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).passthrough();

// Systems search success response schema
const SystemsSearchOkSchema = z.object({
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

// Discriminated union for systems search endpoint
export const systemsSearchResponseSchema = z.union([SystemsSearchOkSchema, ErrorEnvelopeSchema]);

// Systems get by ID success response schema
const SystemsGetOkSchema = z.object({
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

// Discriminated union for systems get endpoint
export const systemsGetResponseSchema = z.union([SystemsGetOkSchema, ErrorEnvelopeSchema]);

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

// Systems envelope schemas for Phase 3 tightening
import { EnvelopeSuccessSchema, EnvelopeErrorSchema } from './envelope.schema.js';

// Systems list envelope schema
const SystemsListData = z.object({
  systems: z.array(z.object({
    asset_uid: z.string(),
    system_norm: z.string(),
    subsystem_norm: z.string(),
    manufacturer_norm: z.string(),
    model_norm: z.string(),
    canonical_model_id: z.string(),
    description: z.string().nullable(),
    manual_url: z.string().nullable(),
    oem_page: z.string().nullable(),
    spec_keywords: z.string().nullable(),
    synonyms_fts: z.string(),
    synonyms_human: z.string(),
    search: z.string()
  })),
  nextCursor: z.string().nullable()
});

export const SystemsListEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: SystemsListData }),
  EnvelopeErrorSchema
]);

// Systems search envelope schema
const SystemsSearchData = z.object({
  systems: z.array(z.object({
    asset_uid: z.string(),
    system_norm: z.string(),
    subsystem_norm: z.string(),
    manufacturer_norm: z.string(),
    model_norm: z.string(),
    canonical_model_id: z.string(),
    description: z.string().nullable(),
    manual_url: z.string().nullable(),
    oem_page: z.string().nullable(),
    spec_keywords: z.string().nullable(),
    synonyms_fts: z.string(),
    synonyms_human: z.string(),
    search: z.string(),
    rank: z.number()
  })),
  meta: z.object({
    floor: z.number(),
    maxRows: z.number(),
    rawCount: z.number(),
    filteredCount: z.number(),
    query: z.string()
  })
});

export const SystemsSearchEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: SystemsSearchData }),
  EnvelopeErrorSchema
]);

// Systems get envelope schema
const SystemsGetData = z.object({
  asset_uid: z.string(),
  system_norm: z.string(),
  subsystem_norm: z.string(),
  manufacturer_norm: z.string(),
  model_norm: z.string(),
  canonical_model_id: z.string(),
  description: z.string().nullable(),
  manual_url: z.string().nullable(),
  oem_page: z.string().nullable(),
  spec_keywords: z.string().nullable(),
  synonyms_fts: z.string(),
  synonyms_human: z.string(),
  search: z.string()
});

export const SystemsGetEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: SystemsGetData }),
  EnvelopeErrorSchema
]);

import { z } from 'zod';
import { EnvelopeSuccessSchema, EnvelopeErrorSchema } from './envelope.schema.js';
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

// Document ingest metadata schema
export const documentIngestMetadataSchema = z.object({
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  revisionDate: z.string().optional(),
  language: z.string().optional(),
  brandFamily: z.string().optional(),
  sourceUrl: z.string().optional()
}).passthrough();

// Document jobs query parameters
// Note: 'pending' is accepted as alias for 'queued' for API flexibility
export const documentJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['queued', 'running', 'done', 'error', 'pending', 'completed']).optional()
}).passthrough();

// Document jobs success response schema
const DocumentJobsOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
    jobs: z.array(z.object({
      job_id: z.string(),
      job_type: z.string().optional().default('GENERIC'),
      status: z.string(),
      doc_id: z.string(),
      upload_id: z.string().nullable(),
      storage_path: z.string().nullable(),
      params: z.record(z.string(), z.any()),
      counters: z.record(z.string(), z.any()),
      error: z.record(z.string(), z.any()).nullable(),
      created_at: z.string(),
      started_at: z.string().nullable(),
      updated_at: z.string(),
      completed_at: z.string().nullable()
    })),
    count: z.number(),
    limit: z.number(),
    offset: z.number()
  })
});

// Discriminated union for document jobs endpoint
export const documentJobsResponseSchema = z.union([DocumentJobsOkSchema, ErrorEnvelopeSchema]);

// Document documents query parameters
// Accepts optional status filter and passes through unknown params
export const documentDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional()
}).passthrough();

// Document documents success response schema
const DocumentDocumentsOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
    documents: z.array(z.object({
      doc_id: z.string(),
      manufacturer_norm: z.string().nullable(),
      model_norm: z.string().nullable(),
      revision_date: z.string().nullable(),
      language: z.string().nullable(),
      brand_family: z.string().nullable(),
      last_ingest_version: z.string().nullable(),
      last_job_id: z.string().nullable(),
      last_ingested_at: z.string().nullable(),
      chunk_count: z.number(),
      table_count: z.number(),
      pages_total: z.number(),
      created_at: z.string(),
      updated_at: z.string()
    })),
    count: z.number(),
    limit: z.number(),
    offset: z.number()
  })
});

// Discriminated union for document documents endpoint
export const documentDocumentsResponseSchema = z.union([DocumentDocumentsOkSchema, ErrorEnvelopeSchema]);

// Document get by ID query parameters (from URL path)
export const documentGetQuerySchema = z.object({
  docId: z.string().uuid('Document ID must be a valid UUID')
});

// Document get by ID success response schema
const DocumentGetOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
    doc_id: z.string(),
    manufacturer_norm: z.string().nullable(),
    model_norm: z.string().nullable(),
    revision_date: z.string().nullable(),
    language: z.string().nullable(),
    brand_family: z.string().nullable(),
    last_ingest_version: z.string().nullable(),
    last_job_id: z.string().nullable(),
    last_ingested_at: z.string().nullable(),
    chunk_count: z.number(),
    table_count: z.number(),
    pages_total: z.number(),
    created_at: z.string(),
    updated_at: z.string()
  })
});

// Discriminated union for document get endpoint
export const documentGetResponseSchema = z.union([DocumentGetOkSchema, ErrorEnvelopeSchema]);

// Document job status path parameters
export const documentJobStatusPathSchema = z.object({
  jobId: z.string().uuid('Job ID must be a valid UUID')
});

// Document job status success response schema
const DocumentJobStatusOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
    job_id: z.string(),
    status: z.string(),
    doc_id: z.string(),
    upload_id: z.string().nullable(),
    storage_path: z.string().nullable(),
    params: z.record(z.string(), z.any()),
    counters: z.record(z.string(), z.any()),
    error: z.record(z.string(), z.any()).nullable(),
    created_at: z.string(),
    started_at: z.string().nullable(),
    updated_at: z.string(),
    completed_at: z.string().nullable()
  })
});

// Discriminated union for document job status endpoint
export const documentJobStatusResponseSchema = z.union([DocumentJobStatusOkSchema, ErrorEnvelopeSchema]);

// Tightened job status response data schema
const JobStatusData = z.object({
  job_id: z.string(),
  status: z.enum(['queued', 'running', 'done', 'error']),
  doc_id: z.string(),
  upload_id: z.string().nullable(),
  storage_path: z.string().nullable(),
  params: z.record(z.string(), z.any()),
  counters: z.record(z.string(), z.any()),
  error: z.record(z.string(), z.any()).nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  updated_at: z.string(),
  completed_at: z.string().nullable()
});

// Job status envelope schema
export const JobStatusEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: JobStatusData }),
  EnvelopeErrorSchema
]);

// Tightened document get-one response data schema
const DocumentGetOneData = z.object({
  doc_id: z.string(),
  manufacturer_norm: z.string().nullable(),
  model_norm: z.string().nullable(),
  revision_date: z.string().nullable(),
  language: z.string().nullable(),
  brand_family: z.string().nullable(),
  last_ingest_version: z.string().nullable(),
  last_job_id: z.string().nullable(),
  last_ingested_at: z.string().nullable(),
  chunk_count: z.number(),
  table_count: z.number(),
  pages_total: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  chunks: z.number(),
  chunk_details: z.array(z.any())
});

// Document get-one envelope schema
export const DocumentGetOneEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: DocumentGetOneData }),
  EnvelopeErrorSchema
]);

// Tightened document ingest response data schema
const DocumentIngestData = z.object({
  jobId: z.string(),
  status: z.enum(['queued', 'running', 'done', 'error']),
  fileName: z.string(),
  createdAt: z.string()
});

// Document ingest envelope schema
export const DocumentIngestEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: DocumentIngestData }),
  EnvelopeErrorSchema
]);

// Document jobs envelope schema
const DocumentJobsData = z.object({
  jobs: z.array(z.object({
    job_id: z.string(),
    status: z.string(),
    doc_id: z.string(),
    upload_id: z.string().nullable(),
    storage_path: z.string().nullable(),
    params: z.record(z.string(), z.any()),
    counters: z.record(z.string(), z.any()),
    error: z.record(z.string(), z.any()).nullable(),
    created_at: z.string(),
    started_at: z.string().nullable(),
    updated_at: z.string(),
    completed_at: z.string().nullable()
  })),
  count: z.number(),
  limit: z.number(),
  offset: z.number()
});

export const DocumentJobsEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: DocumentJobsData }),
  EnvelopeErrorSchema
]);

// Document documents envelope schema
const DocumentDocumentsData = z.object({
  documents: z.array(z.object({
    doc_id: z.string(),
    manufacturer_norm: z.string().nullable(),
    model_norm: z.string().nullable(),
    revision_date: z.string().nullable(),
    language: z.string().nullable(),
    brand_family: z.string().nullable(),
    last_ingest_version: z.string().nullable(),
    last_job_id: z.string().nullable(),
    last_ingested_at: z.string().nullable(),
    chunk_count: z.number(),
    table_count: z.number(),
    pages_total: z.number(),
    created_at: z.string(),
    updated_at: z.string()
  })),
  count: z.number(),
  limit: z.number(),
  offset: z.number()
});

export const DocumentDocumentsEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: DocumentDocumentsData }),
  EnvelopeErrorSchema
]);

// ============================================================================
// Doc Assets (Vision Stage 6-7)
// ============================================================================

// Bounding box schema (percentage-based)
const BboxSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(0).max(100),
  height: z.number().min(0).max(100)
});

// Single doc_asset schema for validation
export const DocAssetSchema = z.object({
  doc_id: z.string(),
  page_number: z.number().int().positive(),
  asset_kind: z.enum(['figure', 'table']),
  asset_index: z.number().int().min(0),
  asset_type: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  bbox: BboxSchema,
  storage_path: z.string(),
  analysis_path: z.string(),
  applies_to_models: z.array(z.string()).min(1),
  referenced_systems: z.array(z.string()).default([]),
  is_universal: z.boolean().default(false),
  confidence: z.enum(['high', 'medium', 'low']).default('low'),
  attribution_warnings: z.array(z.string()).default([]),
  asset_json: z.record(z.any())
});

// Vision analyze request schema
export const VisionAnalyzeRequestSchema = z.object({
  doc_id: z.string(),
  storage_path: z.string(),
  models_covered: z.array(z.string()).default([]),
  selected_models: z.array(z.string()).min(1),
  pages: z.string().default('1-10'),
  context: z.string().default('')
});

// Vision crop request schema
export const VisionCropRequestSchema = z.object({
  doc_id: z.string(),
  storage_path: z.string(),
  analysis_paths: z.array(z.object({
    page_number: z.number().int().positive(),
    analysis_path: z.string(),
    figures_found: z.number().int().min(0).default(0),
    tables_found: z.number().int().min(0).default(0)
  }))
});

// Vision pipeline request (combined Stage 6+7)
export const VisionPipelineRequestSchema = z.object({
  doc_id: z.string(),
  storage_path: z.string(),
  selected_models: z.array(z.string()).min(1),
  referenced_selections: z.array(z.string()).default([]),
  pages: z.string().default('1-10'),
  context: z.string().default('')
});

// Vision pipeline response data
const VisionPipelineData = z.object({
  pages_analyzed: z.number(),
  figures_cropped: z.number(),
  tables_cropped: z.number(),
  assets_saved: z.number(),
  manifest_path: z.string().nullable(),
  warnings: z.array(z.any()).default([])
});

// Vision pipeline envelope schema
export const VisionPipelineEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: VisionPipelineData }),
  EnvelopeErrorSchema
]);

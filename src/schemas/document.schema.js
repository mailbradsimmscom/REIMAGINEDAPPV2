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
export const documentJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

// Document jobs success response schema
const DocumentJobsOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
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
  })
});

// Discriminated union for document jobs endpoint
export const documentJobsResponseSchema = z.union([DocumentJobsOkSchema, ErrorEnvelopeSchema]);

// Document documents query parameters
export const documentDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

// Document documents success response schema
const DocumentDocumentsOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
    documents: z.array(z.object({
      doc_id: z.string(),
      manufacturer: z.string().nullable(),
      model: z.string().nullable(),
      revision_date: z.string().nullable(),
      language: z.string().nullable(),
      brand_family: z.string().nullable(),
      source_url: z.string().nullable(),
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
  docId: z.string().min(1, 'Document ID is required')
});

// Document get by ID success response schema
const DocumentGetOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
    doc_id: z.string(),
    manufacturer: z.string().nullable(),
    model: z.string().nullable(),
    revision_date: z.string().nullable(),
    language: z.string().nullable(),
    brand_family: z.string().nullable(),
    source_url: z.string().nullable(),
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
  jobId: z.string().min(1, 'Job ID is required')
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
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  revision_date: z.string().nullable(),
  language: z.string().nullable(),
  brand_family: z.string().nullable(),
  source_url: z.string().nullable(),
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

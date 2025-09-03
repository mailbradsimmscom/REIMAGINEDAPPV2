import { z } from 'zod';
import { paginationQuerySchema } from './common.schema.js';

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

// Document jobs response schema
export const documentJobsResponseSchema = z.object({
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

// Document documents query parameters
export const documentDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

// Document documents response schema
export const documentDocumentsResponseSchema = z.object({
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

// Document get by ID query parameters (from URL path)
export const documentGetQuerySchema = z.object({
  docId: z.string().min(1, 'Document ID is required')
});

// Document get by ID response schema
export const documentGetResponseSchema = z.object({
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

// Document job status path parameters
export const documentJobStatusPathSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required')
});

// Document job status response schema
export const documentJobStatusResponseSchema = z.object({
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

// Document error response schema
export const documentErrorSchema = z.object({
  success: z.literal(false),
  error: z.string()
});

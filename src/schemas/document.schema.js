import { z } from 'zod';
import { paginationSchema } from './common.schema.js';

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
      params: z.record(z.any()),
      counters: z.record(z.any()),
      error: z.record(z.any()).nullable(),
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

// Document error response schema
export const documentErrorSchema = z.object({
  success: z.literal(false),
  error: z.string()
});

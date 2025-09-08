import { z } from 'zod';

/**
 * Schema for validating normalized document upload metadata
 * Ensures manufacturer_norm and model_norm are provided and non-empty
 */
export const uploadDocumentSchema = z.object({
  manufacturer_norm: z.string().min(1, 'Manufacturer normalized name is required'),
  model_norm: z.string().min(1, 'Model normalized name is required'),
});

/**
 * Schema for validating the complete document upload request
 * Extends the base schema with optional fields for backward compatibility
 */
export const documentUploadRequestSchema = uploadDocumentSchema.extend({
  revisionDate: z.string().optional(),
  language: z.string().optional().default('en'),
  brandFamily: z.string().optional(),
  sourceUrl: z.string().optional(),
}).passthrough();

/**
 * Schema for validating system metadata lookup response
 * Used to ensure system lookup returns required fields
 */
export const systemMetadataSchema = z.object({
  asset_uid: z.string().uuid('Asset UID must be a valid UUID'),
  system_norm: z.string().min(1, 'System normalized name is required'),
  subsystem_norm: z.string().min(1, 'Subsystem normalized name is required'),
});

/**
 * Schema for validating document creation payload
 * Includes all fields that will be stored in the documents table
 */
export const documentCreationSchema = z.object({
  doc_id: z.string().min(1, 'Document ID is required'),
  file_name: z.string().min(1, 'File name is required'),
  storage_path: z.string().min(1, 'Storage path is required'),
  manufacturer_norm: z.string().min(1, 'Manufacturer normalized name is required'),
  model_norm: z.string().min(1, 'Model normalized name is required'),
  asset_uid: z.string().uuid('Asset UID must be a valid UUID'),
  system_norm: z.string().min(1, 'System normalized name is required'),
  subsystem_norm: z.string().min(1, 'Subsystem normalized name is required'),
  revision_date: z.string().optional(),
  language: z.string().optional().default('en'),
  brand_family: z.string().optional(),
  source_url: z.string().optional(),
});

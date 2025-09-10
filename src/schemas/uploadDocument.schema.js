import { z } from 'zod';
import { HashOrUuid } from './id.schema.js';

/**
 * Schema for validating normalized document upload metadata
 * Ensures manufacturer_norm and model_norm are provided and non-empty
 */
export const uploadDocumentSchema = z.object({
  manufacturer_norm: z.string().min(1, 'Manufacturer normalized name is required'),
  model_norm: z.string().min(1, 'Model normalized name is required'),
});

/**
 * Enhanced schema that accepts both raw and normalized field names
 * Provides backward compatibility while ensuring required data is present
 */
export const flexibleUploadDocumentSchema = z.object({
  // Normalized fields (preferred)
  manufacturer_norm: z.string().trim().min(1).optional(),
  model_norm: z.string().trim().min(1).optional(),
  
  // Raw fields (for backward compatibility)
  manufacturer: z.string().trim().optional(),
  model: z.string().trim().optional(),
  
  // Other optional fields
  language: z.string().default('en'),
  doc_id: z.string().optional(),
  revision_date: z.string().optional(),
  ocr: z.boolean().optional(),
}).superRefine((val, ctx) => {
  // Ensure at least one manufacturer field is provided
  const manufacturer = val.manufacturer_norm || val.manufacturer;
  if (!manufacturer || manufacturer.trim() === '') {
    ctx.addIssue({ 
      code: z.ZodIssueCode.custom, 
      path: ['manufacturer_norm'], 
      message: 'Manufacturer is required' 
    });
  }
  
  // Ensure at least one model field is provided
  const model = val.model_norm || val.model;
  if (!model || model.trim() === '') {
    ctx.addIssue({ 
      code: z.ZodIssueCode.custom, 
      path: ['model_norm'], 
      message: 'Model is required' 
    });
  }
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
  asset_uid: HashOrUuid,
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

import express from 'express';
import documentService from '../../services/document.service.js';
import { methodNotAllowed } from '../../middleware/methodNotAllowed.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { DocumentIngestEnvelope } from '../../schemas/document.schema.js';
import { 
  documentIngestMetadataSchema 
} from '../../schemas/document.schema.js';
import { uploadDocumentSchema, flexibleUploadDocumentSchema } from '../../schemas/uploadDocument.schema.js';
import Busboy from 'busboy';
import { z } from 'zod';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// Apply service guards - document ingest requires Supabase and Sidecar
router.use(requireServices(['supabase', 'sidecar']));

// Apply response validation to all routes in this file
router.use(validateResponse(DocumentIngestEnvelope));

// Document ingest body schema (for multipart form data)
const documentIngestBodySchema = z.object({
  // This will be validated after busboy processes the multipart data
}).passthrough();

// POST /admin/docs/ingest - Create document ingest job
router.post('/', 
  validate(documentIngestBodySchema, 'body'),
  async (req, res, next) => {
    try {
      // Parse multipart form data using busboy
      const busboy = Busboy({ 
        headers: req.headers,
        limits: {
          fileSize: 50 * 1024 * 1024, // 50MB limit
          files: 1
        }
      });
      
      let fileBuffer = null;
      let metadata = {};
      let fileName = null;
      let hasError = false;
      let isFinished = false;
      
      // Create a promise to wait for busboy completion
      const busboyPromise = new Promise((resolve, reject) => {
        // Handle file upload
        busboy.on('file', (fieldname, file, info) => {
          if (fieldname !== 'file') {
            file.resume(); // Skip non-file fields
            return;
          }
          
          fileName = info.filename;
          const chunks = [];
          
          file.on('data', (chunk) => {
            chunks.push(chunk);
          });
          
          file.on('end', () => {
            fileBuffer = Buffer.concat(chunks);
          });
          
          file.on('error', (error) => {
            hasError = true;
          });
        });
        
        // Handle form fields
        busboy.on('field', (fieldname, value) => {
          if (fieldname === 'metadata') {
            try {
              const rawMetadata = JSON.parse(value);
              
              // Validate metadata using the flexible schema that accepts both formats
              const validationResult = flexibleUploadDocumentSchema.safeParse(rawMetadata);
              if (!validationResult.success) {
                hasError = true;
                // Safe error message formatting - handle both errors and issues
                const errorMessages = validationResult.error?.issues?.map(e => e.message).join(', ') || 
                                    validationResult.error?.message || 
                                    'Invalid metadata format';
                reject(new Error(`Invalid metadata format: ${errorMessages}`));
              } else {
                // Normalize the metadata to ensure downstream code has expected fields
                const validatedMetadata = validationResult.data;
                metadata = {
                  ...validatedMetadata,
                  manufacturer_norm: validatedMetadata.manufacturer_norm || validatedMetadata.manufacturer,
                  model_norm: validatedMetadata.model_norm || validatedMetadata.model,
                };
              }
            } catch (error) {
              hasError = true;
              reject(new Error(`Failed to parse metadata JSON: ${error.message}`));
            }
          }
        });
        
        // Handle completion
        busboy.on('finish', () => {
          isFinished = true;
          resolve();
        });
        
        // Handle busboy errors
        busboy.on('error', (error) => {
          hasError = true;
          reject(error);
        });
      });
      
      // Pipe request to busboy
      req.pipe(busboy);
      
      // Wait for busboy to finish processing
      await busboyPromise;
      
      // Now process the results
      if (hasError) {
        const error = new Error('File upload failed');
        error.status = 400;
        throw error;
      }
      
      if (!fileBuffer) {
        const error = new Error('No file provided');
        error.status = 400;
        throw error;
      }
      
      // Metadata is already validated and normalized by the flexible schema above
      
      // Create ingest job with normalized metadata
      const job = await documentService.createIngestJob(fileBuffer, { ...metadata, fileName });
      
      const envelope = {
        success: true,
        data: {
          doc_id: job.doc_id,
          job_id: job.job_id,
          status: job.status
        }
      };

      return res.json(envelope);
    } catch (error) {
      next(error);
    }
  }
);

// Add method not allowed for non-POST requests (must be after POST route)
router.all('/', methodNotAllowed);

export default router;

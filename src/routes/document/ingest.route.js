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
import { uploadDocumentSchema } from '../../schemas/uploadDocument.schema.js';
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
              metadata = JSON.parse(value);
              
              // Validate metadata using the new upload document schema
              // This ensures manufacturer_norm and model_norm are provided
              const validationResult = uploadDocumentSchema.safeParse(metadata);
              if (!validationResult.success) {
                hasError = true;
                reject(new Error(`Invalid metadata format: ${validationResult.error.errors.map(e => e.message).join(', ')}`));
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
      
      // Validate that required normalized fields are present
      if (!metadata.manufacturer_norm || !metadata.model_norm) {
        const error = new Error('manufacturer_norm and model_norm are required');
        error.status = 400;
        throw error;
      }
      
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

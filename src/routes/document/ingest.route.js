import express from 'express';
import documentService from '../../services/document.service.js';
import { methodNotAllowed } from '../../middleware/methodNotAllowed.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { 
  documentJobsResponseSchema,
  documentIngestMetadataSchema 
} from '../../schemas/document.schema.js';
import Busboy from 'busboy';
import { z } from 'zod';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// Apply service guards - document ingest requires Supabase and Sidecar
router.use(requireServices(['supabase', 'sidecar']));

// Add method not allowed for non-POST requests
router.all('/', methodNotAllowed);

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
              
              // Validate metadata using Zod schema
              const validationResult = documentIngestMetadataSchema.safeParse(metadata);
              if (!validationResult.success) {
                hasError = true;
                reject(new Error('Invalid metadata format'));
              }
            } catch (error) {
              hasError = true;
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
      
      // Create ingest job
      const job = await documentService.createIngestJob(fileBuffer, fileName, metadata);
      
      const envelope = {
        success: true,
        data: {
          jobId: job.id,
          status: job.status,
          fileName: job.fileName,
          createdAt: job.created_at
        }
      };

      return enforceResponse(res, envelope, 200);
    } catch (error) {
      next(error);
    }
  }
);

export default router;

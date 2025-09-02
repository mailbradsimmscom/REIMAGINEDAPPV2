import express from 'express';
import documentService from '../services/document.service.js';
import { adminGate } from '../middleware/admin.js';
import { 
  documentJobsQuerySchema, 
  documentJobsResponseSchema,
  documentDocumentsQuerySchema,
  documentDocumentsResponseSchema,
  documentGetQuerySchema,
  documentGetResponseSchema,
  documentJobStatusPathSchema,
  documentJobStatusResponseSchema
} from '../schemas/document.schema.js';
import Busboy from 'busboy';

const router = express.Router();

// Apply admin gate middleware to all document routes
router.use(adminGate);

// POST /admin/docs/ingest - Create document ingest job
router.post('/ingest', async (req, res, next) => {
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
    
    res.json({
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        fileName: job.fileName,
        createdAt: job.created_at
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /admin/docs/jobs/:job_id - Get job status
router.get('/jobs/:jobId', async (req, res, next) => {
  try {
    const { jobId } = req.params;
    
    // Validate path parameters
    const pathValidation = documentJobStatusPathSchema.safeParse({ jobId });
    if (!pathValidation.success) {
      const error = new Error('Invalid path parameters');
      error.name = 'ZodError';
      error.errors = pathValidation.error.errors;
      throw error;
    }

    const { jobId: validatedJobId } = pathValidation.data;
    const job = await documentService.getJobStatus(validatedJobId);
    
    if (!job) {
      const error = new Error('Job not found');
      error.status = 404;
      throw error;
    }
    
    const responseData = {
      success: true,
      data: job
    };

    // Validate response data
    const responseValidation = documentJobStatusResponseSchema.safeParse(responseData);
    if (!responseValidation.success) {
      throw new Error('Invalid response format');
    }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /admin/docs/jobs - List jobs
router.get('/jobs', async (req, res, next) => {
  try {
    const { limit, offset, status } = req.query;
    
    // Build query parameters object
    const queryParams = {};
    if (limit !== undefined) queryParams.limit = limit;
    if (offset !== undefined) queryParams.offset = offset;
    if (status !== undefined) queryParams.status = status;

    // Validate query parameters
    const validationResult = documentJobsQuerySchema.safeParse(queryParams);
    
    if (!validationResult.success) {
      const error = new Error('Invalid query parameters');
      error.name = 'ZodError';
      error.errors = validationResult.error.errors;
      throw error;
    }

    const { limit: validatedLimit, offset: validatedOffset, status: validatedStatus } = validationResult.data;
    
    const jobs = await documentService.listJobs(validatedLimit, validatedOffset, validatedStatus);
    
    const responseData = {
      success: true,
      data: {
        jobs,
        count: jobs.length,
        limit: validatedLimit,
        offset: validatedOffset
      }
    };

    // TODO: Re-enable response validation after debugging
    // const responseValidation = documentJobsResponseSchema.safeParse(responseData);
    // if (!responseValidation.success) {
    //   throw new Error('Invalid response format');
    // }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /admin/docs/documents - List documents
router.get('/documents', async (req, res, next) => {
  try {
    const { limit, offset } = req.query;
    
    // Build query parameters object
    const queryParams = {};
    if (limit !== undefined) queryParams.limit = limit;
    if (offset !== undefined) queryParams.offset = offset;

    // Validate query parameters
    const validationResult = documentDocumentsQuerySchema.safeParse(queryParams);
    
    if (!validationResult.success) {
      const error = new Error('Invalid query parameters');
      error.name = 'ZodError';
      error.errors = validationResult.error.errors;
      throw error;
    }

    const { limit: validatedLimit, offset: validatedOffset } = validationResult.data;
    
    const documents = await documentService.listDocuments(validatedLimit, validatedOffset);
    
    const responseData = {
      success: true,
      data: {
        documents,
        count: documents.length,
        limit: validatedLimit,
        offset: validatedOffset
      }
    };

    // TODO: Re-enable response validation after debugging
    // const responseValidation = documentDocumentsResponseSchema.safeParse(responseData);
    // if (!responseValidation.success) {
    //   throw new Error('Invalid response format');
    // }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /admin/docs/documents/:docId - Get document details
router.get('/documents/:docId', async (req, res, next) => {
  try {
    const { docId } = req.params;
    
    // Validate query parameters (docId from URL path)
    const validationResult = documentGetQuerySchema.safeParse({ docId });
    if (!validationResult.success) {
      const error = new Error('Invalid document ID');
      error.name = 'ZodError';
      error.errors = validationResult.error.errors;
      throw error;
    }

    const { docId: validatedDocId } = validationResult.data;
    
    const document = await documentService.getDocument(validatedDocId);
    
    if (!document) {
      const error = new Error('Document not found');
      error.status = 404;
      throw error;
    }
    
    const responseData = {
      success: true,
      data: document
    };

    // Validate response data
    const responseValidation = documentGetResponseSchema.safeParse(responseData);
    if (!responseValidation.success) {
      throw new Error('Invalid response format');
    }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

export default router;

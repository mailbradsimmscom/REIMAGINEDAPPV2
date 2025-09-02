import documentService from '../services/document.service.js';
import { logger } from '../utils/logger.js';
import { validate } from '../middleware/validate.js';
import { 
  documentJobsQuerySchema, 
  documentJobsResponseSchema,
  documentDocumentsQuerySchema,
  documentDocumentsResponseSchema,
  documentGetQuerySchema,
  documentGetResponseSchema,
  documentErrorSchema 
} from '../schemas/document.schema.js';
import Busboy from 'busboy';

// POST /admin/docs/ingest - Create document ingest job
export async function documentIngestRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
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
          requestLogger.info('File received', { 
            fileName, 
            fileSize: fileBuffer.length 
          });
        });
        
        file.on('error', (error) => {
          requestLogger.error('File upload error', { error: error.message });
          hasError = true;
        });
      });
      
      // Handle form fields
      busboy.on('field', (fieldname, value) => {
        if (fieldname === 'metadata') {
          try {
            metadata = JSON.parse(value);
          } catch (error) {
            requestLogger.error('Invalid metadata JSON', { error: error.message });
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
        requestLogger.error('Busboy error', { error: error.message });
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
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: 'File upload failed'
      }));
      return;
    }
    
    if (!fileBuffer) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: 'No file provided'
      }));
      return;
    }
    
    if (!metadata || Object.keys(metadata).length === 0) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: 'Metadata is required'
      }));
      return;
    }
    
    // Add file name to metadata
    metadata.fileName = fileName || 'document.pdf';
    
                // Debug: Check if fileBuffer is corrupted
            requestLogger.info('File buffer validation', { 
              fileBufferLength: fileBuffer?.length,
              docIdFromEmpty: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' // sha256("")
            });
    
    // Create ingest job with synchronous upload
    const result = await documentService.createIngestJob(fileBuffer, metadata);
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: result
    }));
    
    requestLogger.info('Document ingest job created', { 
      jobId: result.job_id, 
      docId: result.doc_id,
      fileName,
      fileSize: fileBuffer.length
    });
    
  } catch (error) {
    requestLogger.error('Failed to handle document ingest request', { 
      error: error.message 
    });
    
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'Internal server error'
    }));
  }
}

// GET /admin/docs/ingest/:job_id - Get job status
export async function documentJobStatusRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const url = new URL(req.url, 'http://localhost');
    const jobId = url.pathname.split('/').pop();
    
    if (!jobId) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: 'Job ID required'
      }));
      return;
    }
    
    const status = await documentService.getJobStatus(jobId);
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: status
    }));
    
    requestLogger.info('Job status retrieved', { jobId });
    
  } catch (error) {
    requestLogger.error('Failed to get job status', { 
      error: error.message 
    });
    
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: error.message
    }));
  }
}

// GET /admin/docs/jobs - List jobs
export async function documentListJobsRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const url = new URL(req.url, 'http://localhost');
    const queryParams = {
      limit: url.searchParams.get('limit') || '50',
      offset: url.searchParams.get('offset') || '0'
    };

    // Validate query parameters
    const validationResult = documentJobsQuerySchema.safeParse(queryParams);
    
    if (!validationResult.success) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: 'Invalid query parameters',
        details: validationResult.error.errors
      }));
      return;
    }

    const { limit, offset } = validationResult.data;
    
    const jobs = await documentService.listJobs(limit, offset);
    
    const responseData = {
      success: true,
      data: {
        jobs,
        count: jobs.length,
        limit,
        offset
      }
    };

    // TODO: Re-enable response validation after debugging
    // const responseValidation = documentJobsResponseSchema.safeParse(responseData);
    // if (!responseValidation.success) {
    //   throw new Error('Invalid response format');
    // }
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(responseData));
    
    requestLogger.info('Jobs listed', { count: jobs.length });
    
  } catch (error) {
    requestLogger.error('Failed to list jobs', { 
      error: error.message 
    });
    
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: error.message
    }));
  }
}

// GET /admin/docs/documents - List documents
export async function documentListDocumentsRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const url = new URL(req.url, 'http://localhost');
    const queryParams = {
      limit: url.searchParams.get('limit') || '50',
      offset: url.searchParams.get('offset') || '0'
    };

    // Validate query parameters
    const validationResult = documentDocumentsQuerySchema.safeParse(queryParams);
    
    if (!validationResult.success) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: 'Invalid query parameters',
        details: validationResult.error.errors
      }));
      return;
    }

    const { limit, offset } = validationResult.data;
    
    const documents = await documentService.listDocuments(limit, offset);
    
    const responseData = {
      success: true,
      data: {
        documents,
        count: documents.length,
        limit,
        offset
      }
    };

    // Validate response data
    const responseValidation = documentDocumentsResponseSchema.safeParse(responseData);
    if (!responseValidation.success) {
      throw new Error('Invalid response format');
    }
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(responseData));
    
    requestLogger.info('Documents listed', { count: documents.length });
    
  } catch (error) {
    requestLogger.error('Failed to list documents', { 
      error: error.message 
    });
    
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: error.message
    }));
  }
}

// GET /admin/docs/documents/:doc_id - Get document details
export async function documentGetDocumentRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const url = new URL(req.url, 'http://localhost');
    const docId = url.pathname.split('/').pop();
    
    // Validate query parameters (docId from URL path)
    const validationResult = documentGetQuerySchema.safeParse({ docId });
    if (!validationResult.success) {
      requestLogger.error('Invalid document ID', { errors: validationResult.error.errors });
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: 'Invalid document ID',
        details: validationResult.error.errors
      }));
      return;
    }

    const { docId: validatedDocId } = validationResult.data;
    
    const document = await documentService.getDocument(validatedDocId);
    
    const responseData = {
      success: true,
      data: document
    };

    // Validate response data
    const responseValidation = documentGetResponseSchema.safeParse(responseData);
    if (!responseValidation.success) {
      throw new Error('Invalid response format');
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(responseData));
    
    requestLogger.info('Document details retrieved', { docId: validatedDocId });
    
  } catch (error) {
    requestLogger.error('Failed to get document', { 
      error: error.message 
    });
    
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: error.message
    }));
  }
}

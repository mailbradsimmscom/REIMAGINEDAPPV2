import documentService from '../services/document.service.js';
import { logger } from '../utils/logger.js';

// POST /admin/docs/ingest - Create document ingest job
export async function documentIngestRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    // Parse multipart form data
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    
    req.on('end', async () => {
      try {
        const body = Buffer.concat(chunks);
        
        // Parse the multipart data (simplified for now)
        const boundary = req.headers['content-type']?.split('boundary=')[1];
        if (!boundary) {
          throw new Error('No boundary found in content-type');
        }
        
        // Extract file and metadata from multipart
        const parts = body.toString().split(`--${boundary}`);
        let fileBuffer = null;
        let metadata = {};
        
        for (const part of parts) {
          if (part.includes('Content-Disposition: form-data')) {
            if (part.includes('name="file"')) {
              // Extract file content
              const fileStart = part.indexOf('\r\n\r\n') + 4;
              const fileEnd = part.lastIndexOf('\r\n');
              fileBuffer = Buffer.from(part.substring(fileStart, fileEnd));
            } else if (part.includes('name="metadata"')) {
              // Extract metadata
              const metaStart = part.indexOf('\r\n\r\n') + 4;
              const metaEnd = part.lastIndexOf('\r\n');
              const metaStr = part.substring(metaStart, metaEnd);
              metadata = JSON.parse(metaStr);
            }
          }
        }
        
        if (!fileBuffer) {
          throw new Error('No file provided');
        }
        
        // Add file name to metadata
        metadata.fileName = metadata.fileName || 'document.pdf';
        
        // Create ingest job
        const result = await documentService.createIngestJob(fileBuffer, metadata);
        
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          success: true,
          data: result
        }));
        
        requestLogger.info('Document ingest job created', { 
          jobId: result.job_id, 
          docId: result.doc_id 
        });
        
      } catch (error) {
        requestLogger.error('Failed to process document ingest', { 
          error: error.message 
        });
        
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
      }
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
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    
    const jobs = await documentService.listJobs(limit, offset);
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: {
        jobs,
        count: jobs.length,
        limit,
        offset
      }
    }));
    
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
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    
    const documents = await documentService.listDocuments(limit, offset);
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: {
        documents,
        count: documents.length,
        limit,
        offset
      }
    }));
    
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
    
    if (!docId) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: 'Document ID required'
      }));
      return;
    }
    
    const document = await documentService.getDocument(docId);
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: document
    }));
    
    requestLogger.info('Document details retrieved', { docId });
    
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

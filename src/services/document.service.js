import documentRepository from '../repositories/document.repository.js';
import dipService from './dip.service.js';
import { ingestDipOutputsToDb } from './dip.ingest.service.js';
import { logger } from '../utils/logger.js';
import { getSupabaseStorageClient } from '../repositories/supabaseClient.js';

class DocumentService {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  /**
   * Create an ingest job for document processing
   * @param {Buffer} fileBuffer - The PDF file buffer
   * @param {Object} metadata - Document metadata
   * @returns {Object} Created job
   */
  async createIngestJob(fileBuffer, metadata) {
    try {
      this.requestLogger.info('Creating ingest job', { 
        fileName: metadata.fileName,
        manufacturer: metadata.manufacturer,
        model: metadata.model
      });

      // Create job record
      const job = await documentRepository.createJob({
        job_type: 'DIP',
        status: 'upload_complete',
        metadata: {
          manufacturer: metadata.manufacturer,
          model: metadata.model,
          fileName: metadata.fileName,
          fileSize: fileBuffer.length
        }
      });

      // Upload file to Supabase Storage
      const storage = await getSupabaseStorageClient();
      if (!storage) {
        throw new Error('Storage service unavailable');
      }

      const storagePath = `manuals/${job.doc_id}/${metadata.fileName}`;
      const { error: uploadError } = await storage.storage
        .from('documents')
        .upload(storagePath, fileBuffer, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (uploadError) {
        throw new Error(`File upload failed: ${uploadError.message}`);
      }

      // Update job with storage path
      await documentRepository.updateJobProgress(job.job_id, {
        storage_path: storagePath
      });

      this.requestLogger.info('Ingest job created successfully', { 
        jobId: job.job_id,
        docId: job.doc_id
      });

      return job;

    } catch (error) {
      this.requestLogger.error('Failed to create ingest job', { 
        error: error.message,
        fileName: metadata.fileName
      });
      throw error;
    }
  }

  /**
   * Process a job (DIP processing)
   * @param {string} jobId - Job ID
   * @returns {Object} Processing result
   */
  async processJob(jobId) {
    try {
      this.requestLogger.info('Starting job processing', { jobId });

      // Get job details
      const job = await documentRepository.getJobById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      if (job.job_type !== 'DIP') {
        throw new Error('Only DIP jobs are supported');
      }

      // Update job status to processing
      await documentRepository.updateJobStatus(jobId, 'processing');

      // Get document details
      const document = await documentRepository.getDocumentById(job.doc_id);
      if (!document) {
        throw new Error('Document not found');
      }

      // Step 29: Run DIP packet processing
      this.requestLogger.info('Starting DIP packet processing', { 
        jobId, 
        docId: job.doc_id,
        storagePath: job.storage_path
      });

      const dipResult = await dipService.runDIPPacket(
        job.doc_id, 
        job.storage_path, 
        '/tmp', 
        {
          job_id: job.job_id,
          manufacturer: document.manufacturer,
          model: document.model
        }
      );

      // Step 30: Ingest DIP JSON outputs into database
      this.requestLogger.info('Starting DIP JSON ingestion to database', { 
        jobId, 
        docId: job.doc_id
      });

      const ingestionResult = await ingestDipOutputsToDb({ 
        docId: job.doc_id,
        paths: dipResult.output_files
      });

      // Update job with results
      await documentRepository.updateJobProgress(jobId, {
        pages_total: dipResult.pages_total || 0,
        pages_ocr: dipResult.pages_ocr || 0,
        tables: dipResult.tables_found || 0,
        vectors_upserted: dipResult.vectors_upserted || 0,
        processing_time: dipResult.processing_time || 0,
        dip_success: true,
        dip_results: {
          spec_suggestions: ingestionResult.inserted.spec_suggestions,
          playbook_hints: ingestionResult.inserted.playbook_hints,
          intent_router: ingestionResult.inserted.intent_router,
          golden_tests: ingestionResult.inserted.golden_tests
        }
      });

      // Mark job as DIP cleaning
      await documentRepository.updateJobStatus(jobId, 'DIP cleaning');

      this.requestLogger.info('Job processing completed successfully', { 
        jobId,
        docId: job.doc_id,
        ingestionResult
      });

      return {
        success: true,
        jobId,
        docId: job.doc_id,
        dipResult,
        ingestionResult
      };

    } catch (error) {
      this.requestLogger.error('Job processing failed', { 
        jobId, 
        error: error.message 
      });

      // Update job status to failed
      await documentRepository.updateJobStatus(jobId, 'failed', {
        error: {
          stage: 'processing',
          message: error.message,
          timestamp: new Date().toISOString()
        }
      });

      throw error;
    }
  }

  /**
   * List jobs with pagination
   * @param {number} limit - Number of jobs to return
   * @param {number} offset - Number of jobs to skip
   * @param {string} status - Filter by status
   * @returns {Array} List of jobs
   */
  async listJobs(limit = 50, offset = 0, status = null) {
    try {
      return await documentRepository.getJobsByStatus(status, limit, offset);
    } catch (error) {
      this.requestLogger.error('Failed to list jobs', { error: error.message });
      throw error;
    }
  }

  /**
   * Get job status
   * @param {string} jobId - Job ID
   * @returns {Object} Job status
   */
  async getJobStatus(jobId) {
    try {
      return await documentRepository.getJobById(jobId);
    } catch (error) {
      this.requestLogger.error('Failed to get job status', { 
        jobId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get document by ID
   * @param {string} docId - Document ID
   * @returns {Object} Document
   */
  async getDocument(docId) {
    try {
      return await documentRepository.getDocumentById(docId);
    } catch (error) {
      this.requestLogger.error('Failed to get document', { 
        docId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * List documents with pagination
   * @param {number} limit - Number of documents to return
   * @param {number} offset - Number of documents to skip
   * @param {string} status - Filter by status
   * @returns {Array} List of documents
   */
  async listDocuments(limit = 50, offset = 0, status = null) {
    try {
      return await documentRepository.getDocumentsByStatus(status, limit, offset);
    } catch (error) {
      this.requestLogger.error('Failed to list documents', { error: error.message });
      throw error;
    }
  }
}

export default new DocumentService();

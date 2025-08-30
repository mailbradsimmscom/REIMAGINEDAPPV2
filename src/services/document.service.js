import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { getSupabaseClient, getSupabaseStorageClient } from '../repositories/supabaseClient.js';
import documentRepository from '../repositories/document.repository.js';
import { logger } from '../utils/logger.js';

class DocumentService {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
    this.supabase = getSupabaseClient();
  }

  // Generate deterministic doc_id from file content
  generateDocId(fileBuffer) {
    return createHash('sha256').update(fileBuffer).digest('hex');
  }

  // Upload file to Supabase Storage
  async uploadFile(fileBuffer, fileName, docId) {
    try {
      const filePath = `manuals/${docId}/${fileName}`;
      
      const { data, error } = await this.supabase.storage
        .from('documents')
        .upload(filePath, fileBuffer, {
          contentType: 'application/pdf',
          upsert: false
        });

      if (error) throw error;
      
      this.requestLogger.info('File uploaded to storage', { 
        docId, 
        fileName, 
        filePath: data.path 
      });
      
      return data.path;
    } catch (error) {
      this.requestLogger.error('Failed to upload file', { 
        error: error.message, 
        docId, 
        fileName 
      });
      throw error;
    }
  }

  // Create document ingest job
  async createIngestJob(fileBuffer, metadata, options = {}) {
    try {
      const {
        doc_id,
        ocr_enabled = true,
        dry_run = false,
        manufacturer,
        model,
        brand_family,
        revision_date,
        language = 'en',
        boat_system,
        standards,
        source_url
      } = metadata;

      // Generate doc_id if not provided
      const finalDocId = doc_id || this.generateDocId(fileBuffer);
      
      // Create job record
      const jobData = {
        doc_id: finalDocId,
        status: 'queued',
        params: {
          ocr_enabled,
          dry_run,
          parser_version: '1.0.0',
          embed_model: 'text-embedding-3-large',
          namespace: 'REIMAGINEDDOCS'
        },
        counters: {
          pages_total: 0,
          pages_ocr: 0,
          tables: 0,
          chunks: 0,
          upserted: 0,
          skipped_duplicates: 0
        }
      };

      const job = await documentRepository.createJob(jobData);

      // Create or update document record
      const documentData = {
        doc_id: finalDocId,
        manufacturer,
        model,
        revision_date: revision_date ? new Date(revision_date) : null,
        language,
        brand_family,
        source_url,
        last_ingest_version: '1.0.0',
        last_job_id: job.job_id
      };

      await documentRepository.createOrUpdateDocument(documentData);

      // Upload file to storage (async, don't wait)
      this.uploadFile(fileBuffer, metadata.fileName || 'document.pdf', finalDocId)
        .then(storagePath => {
          documentRepository.updateJobStatus(job.job_id, 'queued', { storage_path: storagePath });
        })
        .catch(error => {
          this.requestLogger.error('Failed to upload file after job creation', { 
            error: error.message, 
            jobId: job.job_id 
          });
        });

      this.requestLogger.info('Ingest job created', { 
        jobId: job.job_id, 
        docId: finalDocId 
      });

      return {
        job_id: job.job_id,
        status: 'queued',
        doc_id: finalDocId
      };
    } catch (error) {
      this.requestLogger.error('Failed to create ingest job', { 
        error: error.message, 
        metadata 
      });
      throw error;
    }
  }

  // Get job status
  async getJobStatus(jobId) {
    try {
      const status = await documentRepository.getJobStatus(jobId);
      return status;
    } catch (error) {
      this.requestLogger.error('Failed to get job status', { 
        error: error.message, 
        jobId 
      });
      throw error;
    }
  }

  // List recent jobs
  async listJobs(limit = 50, offset = 0) {
    try {
      const jobs = await documentRepository.listJobs(limit, offset);
      return jobs;
    } catch (error) {
      this.requestLogger.error('Failed to list jobs', { error: error.message });
      throw error;
    }
  }

  // List documents
  async listDocuments(limit = 50, offset = 0) {
    try {
      const documents = await documentRepository.listDocuments(limit, offset);
      return documents;
    } catch (error) {
      this.requestLogger.error('Failed to list documents', { error: error.message });
      throw error;
    }
  }

  // Get document details
  async getDocument(docId) {
    try {
      const document = await documentRepository.getDocument(docId);
      const chunks = await documentRepository.getChunksByDocId(docId);
      
      return {
        ...document,
        chunks: chunks.length,
        chunk_details: chunks
      };
    } catch (error) {
      this.requestLogger.error('Failed to get document', { 
        error: error.message, 
        docId 
      });
      throw error;
    }
  }

  // Process job (called by worker)
  async processJob(jobId) {
    try {
      const job = await documentRepository.getJob(jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      // Update status to started
      await documentRepository.updateJobStatus(jobId, 'parsing');

      // Get document details
      const document = await documentRepository.getDocument(job.doc_id);
      if (!document) {
        throw new Error('Document not found');
      }

      // Get file from Supabase Storage
      const filePath = `manuals/${job.doc_id}/${document.file_name}`;
      const { data: fileData, error: fileError } = await this.supabase.storage
        .from('documents')
        .download(filePath);

      if (fileError) {
        throw new Error(`Failed to download file: ${fileError.message}`);
      }

      // Call Python sidecar for processing
      const processingResult = await this.callPythonSidecar(fileData, job, document);

      // Update job with results
      await documentRepository.updateJobProgress(jobId, {
        pages_total: processingResult.pages_total || 0,
        pages_ocr: processingResult.pages_ocr || 0,
        tables: processingResult.tables_found || 0,
        chunks: processingResult.chunks_processed || 0,
        upserted: processingResult.vectors_upserted || 0,
        skipped_duplicates: 0
      });

      await documentRepository.updateJobStatus(jobId, 'completed');

      this.requestLogger.info('Job processing completed', { 
        jobId, 
        chunksProcessed: processingResult.chunks_processed,
        vectorsUpserted: processingResult.vectors_upserted
      });
    } catch (error) {
      this.requestLogger.error('Failed to process job', { 
        error: error.message, 
        jobId 
      });
      
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

  // Call Python sidecar for document processing
  async callPythonSidecar(fileBuffer, job, document) {
    try {
      const formData = new FormData();
      
      // Add file
      const blob = new Blob([fileBuffer], { type: 'application/pdf' });
      formData.append('file', blob, document.file_name);
      
      // Add metadata
      const metadata = {
        doc_id: job.doc_id,
        manufacturer: document.manufacturer,
        model: document.model,
        revision_date: document.revision_date,
        language: document.language,
        job_id: job.job_id,
        file_name: document.file_name
      };
      formData.append('doc_metadata', JSON.stringify(metadata));
      
      // Add processing options
      formData.append('extract_tables', 'true');
      formData.append('ocr_enabled', job.params.ocr_enabled ? 'true' : 'false');

      // Call Python sidecar
      const sidecarUrl = process.env.PYTHON_SIDECAR_URL || 'http://localhost:8000';
      const response = await fetch(`${sidecarUrl}/v1/process-document`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Python sidecar error: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(`Processing failed: ${result.error || 'Unknown error'}`);
      }

      this.requestLogger.info('Python sidecar processing completed', {
        jobId: job.job_id,
        filename: result.filename,
        chunksProcessed: result.chunks_processed,
        vectorsUpserted: result.vectors_upserted,
        namespace: result.namespace
      });

      return result;
    } catch (error) {
      this.requestLogger.error('Failed to call Python sidecar', {
        error: error.message,
        jobId: job.job_id
      });
      throw error;
    }
  }

  // Simulate processing for testing
  async simulateProcessing(jobId) {
    const stages = ['parsing', 'embedding', 'upserting'];
    
    for (const stage of stages) {
      await documentRepository.updateJobStatus(jobId, stage);
      await documentRepository.updateJobProgress(jobId, {
        pages_total: 10,
        pages_ocr: 2,
        tables: 3,
        chunks: 25,
        upserted: 25,
        skipped_duplicates: 0
      });
      
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    await documentRepository.updateJobStatus(jobId, 'completed');
  }
}

export default new DocumentService();

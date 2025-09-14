import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { getSupabaseClient, getSupabaseStorageClient } from '../repositories/supabaseClient.js';
import documentRepository from '../repositories/document.repository.js';
import jobsRepository from '../repositories/jobs.repository.js';
import { lookupSystemByManufacturerAndModel } from '../repositories/systems.repository.js';
import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';
import { isSupabaseConfigured, isSidecarConfigured } from '../services/guards/index.js';
import { systemMetadataSchema } from '../schemas/uploadDocument.schema.js';
import dipService from './dip.service.js';
import { ingestDipOutputsToDb } from './dip.ingest.service.js';

class DocumentService {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  // Helper method to check if Supabase is available
  async checkSupabaseAvailability() {
    if (!isSupabaseConfigured()) {
      const error = new Error('Supabase not configured');
      error.code = 'SUPABASE_DISABLED';
      throw error;
    }
    
    const supabase = await getSupabaseClient();
    if (!supabase) {
      const error = new Error('Supabase client not available');
      error.code = 'SUPABASE_DISABLED';
      throw error;
    }
    
    return supabase;
  }

  // Helper method to check if Python sidecar is available
  checkSidecarAvailability() {
    if (!isSidecarConfigured()) {
      const error = new Error('Python sidecar not configured');
      error.code = 'SIDECAR_DISABLED';
      throw error;
    }
  }

  async getSupabase() {
    if (!this._supabase) {
      this._supabase = await this.checkSupabaseAvailability();
    }
    return this._supabase;
  }

  async getSupabaseStorage() {
    if (!this._supabaseStorage) {
      await this.checkSupabaseAvailability(); // Check before getting storage
      this._supabaseStorage = await getSupabaseStorageClient();
    }
    return this._supabaseStorage;
  }

  // Generate deterministic doc_id from file content
  generateDocId(fileBuffer) {
    return createHash('sha256').update(fileBuffer).digest('hex');
  }

  // Upload file to Supabase Storage
  async uploadFile(fileBuffer, fileName, docId) {
    try {
      const filePath = `manuals/${docId}/${fileName}`;
      
      this.requestLogger.info('Starting file upload', { docId, fileName, filePath, fileSize: fileBuffer.length });
      
      const supabaseStorage = await this.getSupabaseStorage();
      const { data, error } = await supabaseStorage.storage
        .from('documents')
        .upload(filePath, fileBuffer, {
          contentType: 'application/pdf',
          upsert: false
        });

      if (error) {
        this.requestLogger.error('Supabase upload error', { 
          error: error.message, 
          code: error.code, 
          details: error.details,
          hint: error.hint,
          docId, 
          fileName,
          filePath
        });
        throw error;
      }
      
      this.requestLogger.info('Upload successful', { 
        docId, 
        fileName, 
        filePath: data.path,
        fileSize: fileBuffer.length
      });
      
      this.requestLogger.info('File uploaded to storage', { 
        docId, 
        fileName, 
        filePath: data.path 
      });
      
      return data.path;
    } catch (error) {
      this.requestLogger.error('Upload failed with details', {
        error: error.message,
        stack: error.stack,
        docId,
        fileName,
        fileSize: fileBuffer?.length,
        filePath: `manuals/${docId}/${fileName}`
      });
      
      this.requestLogger.error('Failed to upload file', { 
        error: error.message, 
        docId, 
        fileName 
      });
      throw error;
    }
  }

  /**
   * Create an ingest job for document processing
   * @param {Buffer} fileBuffer - The PDF file buffer
   * @param {Object} metadata - Document metadata
   * @returns {Object} Created job
   */
  async createIngestJob(fileBuffer, metadata, options = {}) {
    try {
      this.requestLogger.info('=== CREATE INGEST JOB START ===', { 
        metadata: JSON.stringify(metadata, null, 2),
        fileBufferLength: fileBuffer?.length,
        options: JSON.stringify(options, null, 2)
      });

      // Check Supabase availability before creating job
      await this.checkSupabaseAvailability();

      const {
        doc_id,
        ocr_enabled = true,
        dry_run = false,
        manufacturer,
        model,
        manufacturer_norm,
        model_norm,
        brand_family,
        revision_date,
        language = 'en',
        boat_system,
        standards,
        source_url
      } = metadata;

      // Generate doc_id if not provided
      const finalDocId = doc_id || this.generateDocId(fileBuffer);
      
      // Debug: Check if we're getting empty file
      this.requestLogger.info('Document ingest job creation', { 
        finalDocId, 
        fileBufferLength: fileBuffer?.length 
      });

      // System metadata lookup - prioritize normalized fields
      let systemMetadata = null;
      const manufacturerNorm = manufacturer_norm || manufacturer;
      const modelNorm = model_norm || model;

      if (manufacturerNorm && modelNorm) {
        try {
          this.requestLogger.info('Looking up system metadata', { 
            manufacturerNorm, 
            modelNorm 
          });
          
          systemMetadata = await lookupSystemByManufacturerAndModel(manufacturerNorm, modelNorm);
          
          // Validate the system metadata response
          const validationResult = systemMetadataSchema.safeParse(systemMetadata);
          if (!validationResult.success) {
            this.requestLogger.error('Invalid system metadata response', { 
              systemMetadata, 
              errors: validationResult.error.errors,
              errorDetails: JSON.stringify(validationResult.error.errors, null, 2)
            });
            throw new Error('Invalid system metadata response from database');
          }
          
          this.requestLogger.info('System metadata resolved', { 
            asset_uid: systemMetadata.asset_uid,
            system_norm: systemMetadata.system_norm,
            subsystem_norm: systemMetadata.subsystem_norm
          });
          
        } catch (error) {
          this.requestLogger.error('System lookup failed', { 
            error: error.message, 
            manufacturerNorm, 
            modelNorm,
            code: error.code 
          });
          
          // For testing purposes, create a mock system metadata
          // TODO: Remove this when proper systems are available
          systemMetadata = {
            asset_uid: '550e8400-e29b-41d4-a716-446655440000', // Valid UUID format
            system_norm: manufacturerNorm + '-' + modelNorm,
            subsystem_norm: 'test-subsystem'
          };
          
          this.requestLogger.warn('Using mock system metadata for testing', { 
            systemMetadata 
          });
        }
      } else {
        this.requestLogger.warn('No manufacturer/model provided for system lookup', { 
          manufacturerNorm, 
          modelNorm 
        });
        throw new Error('Manufacturer and model are required for document upload');
      }
      
      // Create job record
      const jobData = {
        doc_id: finalDocId,
        job_type: 'DIP', // Set job type to DIP for document processing
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

      this.requestLogger.info('Job created successfully', { 
        jobId: job.job_id, 
        docId: job.doc_id,
        jobData: JSON.stringify(jobData, null, 2)
      });

      // Create or update document record with normalized system metadata
      const documentData = {
        doc_id: finalDocId,
        manufacturer_norm: manufacturerNorm,
        model_norm: modelNorm,
        asset_uid: systemMetadata.asset_uid,
        system_norm: systemMetadata.system_norm,
        subsystem_norm: systemMetadata.subsystem_norm,
        // Keep legacy fields for backward compatibility
        manufacturer: manufacturer || manufacturerNorm,
        model: model || modelNorm,
        revision_date: revision_date ? new Date(revision_date) : null,
        language,
        brand_family,
        source_url,
        last_ingest_version: '1.0.0',
        last_job_id: job.job_id
      };

      await documentRepository.createOrUpdateDocument(documentData);

      // Upload file to storage synchronously
      try {
        const storagePath = await this.uploadFile(fileBuffer, metadata.fileName || 'document.pdf', finalDocId);
        this.requestLogger.info('Upload successful, storagePath', { storagePath });
        
      // Update job with storage path
      await documentRepository.updateJobStatus(job.job_id, 'upload_complete', { storage_path: storagePath });
        
        // Update document with storage path
        await documentRepository.updateDocumentStoragePath(finalDocId, storagePath);
      } catch (uploadError) {
        this.requestLogger.error('Upload failed', { error: uploadError.message });
        throw uploadError;
      }

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

  /**
   * Process a job (DIP processing)
   * @param {string} jobId - Job ID
   * @returns {Object} Processing result
   */
  async processJob(jobId) {
    try {
      this.requestLogger.info('Starting job processing', { jobId });

      // Get job details
      const job = await documentRepository.getJob(jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      if (job.job_type !== 'DIP') {
        throw new Error('Only DIP jobs are supported');
      }

      // Update job status to parsing
      await documentRepository.updateJobStatus(jobId, 'parsing');

      // Get document details
      const document = await documentRepository.getDocument(job.doc_id);
      if (!document) {
        throw new Error('Document not found');
      }

      // Step 28: Download file from Supabase Storage
      const fileName = job.storage_path ? job.storage_path.split('/').pop() : null;
      if (!fileName) {
        throw new Error('File name not found in job storage path');
      }

      const filePath = `manuals/${job.doc_id}/${fileName}`;
      const supabaseStorage = await this.getSupabaseStorage();
      const { data: fileData, error: fileError } = await supabaseStorage.storage
        .from('documents')
        .download(filePath);

      if (fileError) {
        throw new Error(`Failed to download file: ${fileError.message}`);
      }

      if (!fileData || typeof fileData.arrayBuffer !== 'function') {
        throw new Error(`Failed to download file: Invalid file data`);
      }

      const fileBuffer = await fileData.arrayBuffer();

      // Step 29: Process document with Python sidecar (PDF → chunks → embeddings → Pinecone)
      this.requestLogger.info('Starting document processing', { 
        jobId, 
        docId: job.doc_id,
        fileName
      });

      const processingResult = await this.callPythonSidecar(fileBuffer, job, document, fileName);

      // Step 30: Run DIP packet processing
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
        paths: null
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
      await documentRepository.updateJobStatus(jobId, 'parsing');

      // Clean and move staging data to production
      const { cleanDipForDoc } = await import('../services/dip-cleaner/dip-cleaner.service.js');
      await cleanDipForDoc(job.doc_id, jobId);

      // Mark job as completed
      await documentRepository.updateJobStatus(jobId, 'completed');

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
      return await jobsRepository.getJobById(jobId);
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
      return await documentRepository.getDocument(docId);
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
      return await documentRepository.listDocuments(limit, offset);
    } catch (error) {
      this.requestLogger.error('Failed to list documents', { error: error.message });
      throw error;
    }
  }

  // Call Python sidecar for document processing
  async callPythonSidecar(fileBuffer, job, document, fileName) {
    try {
      // Check sidecar availability before calling
      this.checkSidecarAvailability();

      const formData = new FormData();
      
      // Add file
      const blob = new Blob([fileBuffer], { type: 'application/pdf' });
      formData.append('file', blob, fileName);
      
      // Add metadata
      const metadata = {
        doc_id: job.doc_id,
        manufacturer: document.manufacturer,
        model: document.model,
        revision_date: document.revision_date,
        language: document.language,
        job_id: job.job_id,
        file_name: fileName
      };
      formData.append('doc_metadata', JSON.stringify(metadata));
      
      // Add processing options
      formData.append('extract_tables', 'true');
      formData.append('ocr_enabled', job.params.ocr_enabled ? 'true' : 'false');

      // Call Python sidecar
      const { getEnv } = await import('../config/env.js');
      const sidecarUrl = getEnv().PYTHON_SIDECAR_URL;
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
}

export default new DocumentService();

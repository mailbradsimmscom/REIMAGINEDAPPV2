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
import { ingestDipOutputsToDb } from './dip.ingest.service.js';
import { anthropicExtractionService } from './anthropic.extraction.service.js';
import { buildIntentSuggestions } from './suggestions/intent.suggestions.js';

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

  // Verify file exists in storage with retry logic
  async verifyFileInStorage(storagePath, jobId) {
    const maxRetries = 20; // 20 retries * 3 seconds = 1 minute
    const retryDelay = 3000; // 3 seconds between retries

    this.requestLogger.info('Starting storage verification', { storagePath, jobId });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const supabaseStorage = await this.getSupabaseStorage();
        const { data: fileData, error: fileError } = await supabaseStorage.storage
          .from('documents')
          .download(storagePath);

        if (!fileError && fileData && typeof fileData.arrayBuffer === 'function') {
          this.requestLogger.info('Storage verification successful', {
            storagePath,
            jobId,
            attempt
          });

          // Wait 5 seconds as safety buffer
          await this.sleep(5000);

          // Update job status to upload_complete
          await documentRepository.updateJobStatus(jobId, 'upload_complete', {
            storage_path: storagePath
          });

          this.requestLogger.info('Job status updated to upload_complete', { jobId });
          return;
        }

        this.requestLogger.warn('Storage verification attempt failed', {
          storagePath,
          jobId,
          attempt,
          error: fileError?.message
        });

      } catch (error) {
        this.requestLogger.warn('Storage verification error', {
          storagePath,
          jobId,
          attempt,
          error: error.message
        });
      }

      // Wait before next attempt (except on last attempt)
      if (attempt < maxRetries) {
        await this.sleep(retryDelay);
      }
    }

    // All retries failed
    const errorMessage = 'Unable to validate storage path, job ended';
    this.requestLogger.error('Storage verification failed after all retries', {
      storagePath,
      jobId,
      maxRetries
    });

    throw new Error(errorMessage);
  }

  // Utility function to sleep
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
        source_url,
        asset_uid
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
          
          // Throw a loud and clear error instead of creating mock data
          const systemLookupError = new Error(
            `SYSTEM NOT FOUND: No system found for manufacturer "${manufacturerNorm}" and model "${modelNorm}". ` +
            `This system must exist in the systems table before document upload can proceed. ` +
            `Please add this system to the database first.`
          );
          systemLookupError.code = 'SYSTEM_NOT_FOUND';
          systemLookupError.manufacturer = manufacturerNorm;
          systemLookupError.model = modelNorm;
          throw systemLookupError;
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
          chunks_processed: 0,
          chunks_total: 0,
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
        asset_uid: asset_uid || systemMetadata.asset_uid,  // Prefer user-provided asset_uid, fallback to system lookup
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
        // Step 1: Uploading
        await documentRepository.updateJobStatusV2(job.job_id, 'uploading');

        const storagePath = await this.uploadFile(fileBuffer, metadata.fileName || 'document.pdf', finalDocId);
        this.requestLogger.info('Upload successful, storagePath', { storagePath });

        // Update job with storage path and set to upload_success
        await documentRepository.updateJobStatus(job.job_id, 'upload_success', { storage_path: storagePath });

        // Step 2: Verifying
        await documentRepository.updateJobStatusV2(job.job_id, 'verifying');

        // Verify file exists in storage with retry logic
        await this.verifyFileInStorage(storagePath, job.job_id);

        // Update document with storage path
        await documentRepository.updateDocumentStoragePath(finalDocId, storagePath);

        // Process job asynchronously (don't block response)
        this.requestLogger.info('Starting background job processing', {
          jobId: job.job_id,
          docId: finalDocId
        });

        // Fire and forget - errors handled in processJob catch block
        this.processJob(job.job_id).catch(error => {
          this.requestLogger.error('Background job processing failed', {
            jobId: job.job_id,
            error: error.message
          });
        });

      } catch (uploadError) {
        this.requestLogger.error('Upload failed', { error: uploadError.message });
        throw uploadError;
      }

      this.requestLogger.info('Ingest job created and processing in background', {
        jobId: job.job_id,
        docId: finalDocId
      });

      return {
        job_id: job.job_id,
        status: 'processing',
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
      
      // Update detailed processing stage
      await documentRepository.updateJobStatusV2(jobId, 'parsing');

      // Get document details
      const document = await documentRepository.getDocument(job.doc_id);
      if (!document) {
        throw new Error('Document not found');
      }

      this.requestLogger.info('Document retrieved from DB', {
        doc_id: document.doc_id,
        asset_uid: document.asset_uid,
        manufacturer: document.manufacturer_norm,
        model: document.model_norm
      });

      // Step 28: Download file from Supabase Storage
      if (!job.storage_path) {
        throw new Error('Storage path not found in job');
      }

      const fileName = job.storage_path.split('/').pop();
      const filePath = job.storage_path;
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

      // Step 2: Process document with Python sidecar (PDF → chunks → embeddings → Pinecone)
      this.requestLogger.info('Starting document processing', {
        jobId,
        docId: job.doc_id,
        fileName
      });

      const processingResult = await this.callPythonSidecar(fileBuffer, job, document, fileName);

      // Update systems.manual flag after successful Pinecone upsert
      if (document.asset_uid) {
        try {
          await documentRepository.updateSystemManualFlag(document.asset_uid, true);
          this.requestLogger.info('System manual flag set to true', {
            assetUid: document.asset_uid,
            jobId
          });
        } catch (flagError) {
          // Log but don't fail the job - this is non-critical
          this.requestLogger.warn('Failed to update system manual flag', {
            assetUid: document.asset_uid,
            jobId,
            error: flagError.message
          });
        }
      }

      // Extract and update colloquial keywords from Pinecone chunks
      // Wait 5 seconds for Pinecone to finish indexing (eventual consistency)
      if (document.asset_uid && document.manufacturer_norm && document.model_norm) {
        this.requestLogger.info('Waiting for Pinecone indexing before extracting colloquial keywords', {
          assetUid: document.asset_uid
        });
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Update status to colloquial_extraction
        await documentRepository.updateJobStatusV2(jobId, 'colloquial_extraction');

        const colloquialStats = await this.extractAndUpdateColloquialKeywords(
          document.asset_uid,
          document.manufacturer_norm,
          document.model_norm
        );

        // Update job counters with colloquial stats
        if (colloquialStats) {
          try {
            const currentJob = await documentRepository.getJob(jobId);
            const mergedCounters = {
              ...(currentJob.counters || {}),
              ...colloquialStats
            };

            await documentRepository.updateJobProgress(jobId, mergedCounters);

            this.requestLogger.info('Updated job counters with colloquial stats', {
              jobId,
              colloquialStats,
              mergedCounters
            });
          } catch (statsError) {
            this.requestLogger.warn('Failed to update job counters with colloquial stats', {
              jobId,
              error: statsError.message
            });
          }
        }
      }

      // Step 7: Extracting
      await documentRepository.updateJobStatusV2(jobId, 'extracting');

      // Run Anthropic extraction using the 4 Python scripts
      this.requestLogger.info('Starting Anthropic extraction', {
        jobId,
        docId: job.doc_id,
        fileName,
        storagePath: job.storage_path
      });

      const extractionResult = await anthropicExtractionService.runAnthropicExtraction(
        job.doc_id,
        job.storage_path,
        {
          job_id: job.job_id,
          manufacturer: document.manufacturer,
          model: document.model
        }
      );

      // Update job counters with DIP stats (if available)
      if (extractionResult.extractionResults?.stats) {
        try {
          const dipStats = extractionResult.extractionResults.stats;

          // Get current job to merge counters (don't replace!)
          const currentJob = await documentRepository.getJob(jobId);
          const mergedCounters = {
            ...(currentJob.counters || {}),
            ...dipStats
          };

          await documentRepository.updateJobProgress(jobId, mergedCounters);

          this.requestLogger.info('Updated job counters with DIP stats', {
            jobId,
            dipStats,
            mergedCounters
          });
        } catch (statsError) {
          // Log warning but don't fail the job
          this.requestLogger.warn('Failed to update job counters with DIP stats', {
            jobId,
            error: statsError.message
          });
        }
      }

      // Store Anthropic extraction results in database
      this.requestLogger.info('Starting Anthropic extraction storage', {
        jobId,
        docId: job.doc_id,
        extractionResults: extractionResult.storageResults
      });

      const ingestionResult = await ingestDipOutputsToDb({
        docId: job.doc_id,
        paths: extractionResult.storageResults,
        systemMetadata: {
          manufacturer_norm: document.manufacturer_norm,
          model_norm: document.model_norm,
          asset_uid: document.asset_uid
        }
      });

      // Step 8: Storing
      await documentRepository.updateJobStatusV2(jobId, 'storing');

      // Step 9: Completed (mark job as completed)
      await documentRepository.updateJobStatus(jobId, 'completed');
      
      // Update final processing stage
      await documentRepository.updateJobStatusV2(jobId, 'completed');

      this.requestLogger.info('Job processing completed successfully', {
        jobId,
        docId: job.doc_id,
        extractionResult,
        ingestionResult
      });

      return {
        success: true,
        jobId,
        docId: job.doc_id,
        extractionResult,
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

      // Update status_v2 to failed for UI display
      await documentRepository.updateJobStatusV2(jobId, 'failed');

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

  // Extract colloquial keywords from Pinecone chunks and update systems table
  async extractAndUpdateColloquialKeywords(assetUid, manufacturer, model) {
    try {
      const { extractColloquialKeywords } = await import('./colloquial-extraction.service.js');

      this.requestLogger.info('Extracting colloquial keywords', {
        assetUid,
        manufacturer,
        model
      });

      const result = await extractColloquialKeywords(manufacturer, model);

      if (!result.keywords || result.keywords.trim().length === 0) {
        this.requestLogger.warn('No colloquial keywords extracted, skipping update', {
          assetUid,
          manufacturer,
          model
        });
        return result.stats; // Return stats even if no keywords
      }

      // Update systems table
      await documentRepository.updateSystemColloquialKeywords(assetUid, result.keywords);

      this.requestLogger.info('Colloquial keywords updated successfully', {
        assetUid,
        keywordsCount: result.stats.colloquial_keywords_count,
        preview: result.keywords.substring(0, 100) + (result.keywords.length > 100 ? '...' : '')
      });

      return result.stats; // Return stats for job counter update

    } catch (error) {
      // Log but don't fail the job - this is a non-critical enhancement
      this.requestLogger.warn('Failed to extract or update colloquial keywords', {
        assetUid,
        manufacturer,
        model,
        error: error.message
      });

      // Return empty stats on error
      return {
        colloquial_keywords_count: 0,
        colloquial_tokens_used: 0
      };
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
        file_name: fileName,
        asset_uid: document.asset_uid
      };

      this.requestLogger.info('Sending metadata to Python sidecar', {
        metadata: JSON.stringify(metadata, null, 2),
        document_asset_uid: document.asset_uid
      });

      formData.append('doc_metadata', JSON.stringify(metadata));

      // Add processing options
      formData.append('extract_tables', 'true');
      formData.append('ocr_enabled', job.params.ocr_enabled ? 'true' : 'false');

      // Step 4: Chunking
      await documentRepository.updateJobStatusV2(job.job_id, 'chunking');

      // Call Python sidecar with 20-minute timeout
      const { getEnv } = await import('../config/env.js');
      const sidecarUrl = getEnv().PYTHON_SIDECAR_URL;

      // Set 20-minute timeout for document processing
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 1200000); // 20 minutes

      let response;
      try {
        response = await fetch(`${sidecarUrl}/v1/process-document`, {
          method: 'POST',
          body: formData,
          signal: abortController.signal
        });
        clearTimeout(timeoutId);
      } catch (fetchError) {
        clearTimeout(timeoutId);

        // Log detailed error information
        this.requestLogger.error('Fetch to Python sidecar failed', {
          jobId: job.job_id,
          url: `${sidecarUrl}/v1/process-document`,
          errorName: fetchError.name,
          errorMessage: fetchError.message,
          errorCause: fetchError.cause?.message || fetchError.cause,
          errorCode: fetchError.code,
          isTimeout: fetchError.name === 'AbortError'
        });

        // Provide helpful error message
        if (fetchError.name === 'AbortError') {
          throw new Error(`Python sidecar timeout: Processing took longer than 20 minutes`);
        } else {
          throw new Error(`Python sidecar connection failed: ${fetchError.message}`);
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Python sidecar error: ${response.status} ${errorText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(`Processing failed: ${result.error || 'Unknown error'}`);
      }

      // Step 5: Embedding
      await documentRepository.updateJobStatusV2(job.job_id, 'embedding');

      this.requestLogger.info('Python sidecar processing completed', {
        jobId: job.job_id,
        filename: result.filename,
        chunksProcessed: result.chunks_processed,
        vectorsUpserted: result.vectors_upserted,
        namespace: result.namespace
      });

      // Update job with chunk progress after Python processing
      await documentRepository.updateJobProgress(job.job_id, {
        chunks_total: result.chunks_processed || 0,
        chunks_processed: result.chunks_processed || 0,
        vectors_upserted: result.vectors_upserted || 0
      });

      // Step 6: Indexing
      await documentRepository.updateJobStatusV2(job.job_id, 'indexing');

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

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { getSupabaseClient, getSupabaseStorageClient } from '../repositories/supabaseClient.js';
import documentRepository from '../repositories/document.repository.js';
import { lookupSystemByManufacturerAndModel } from '../repositories/systems.repository.js';
import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';
import { isSupabaseConfigured, isSidecarConfigured } from '../services/guards/index.js';
import { systemMetadataSchema } from '../schemas/uploadDocument.schema.js';
import dipService from './dip.service.js';
import suggestionsRepository from '../repositories/suggestions.repository.js';

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
    
    // Update job status to failed
    await documentRepository.updateJobStatus(jobId, 'failed', {
      error: {
        stage: 'storage_verification',
        message: errorMessage,
        timestamp: new Date().toISOString()
      }
    });
    
    throw new Error(errorMessage);
  }

  // Utility method for sleep
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Create document ingest job
  async createIngestJob(fileBuffer, metadata, options = {}) {
    try {
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
          
          // If system lookup fails, we should fail the upload
          // This ensures all documents are properly linked to systems
          const uploadError = new Error(`System lookup failed: ${error.message}`);
          uploadError.code = error.code || 'SYSTEM_LOOKUP_FAILED';
          uploadError.status = error.status || 400;
          throw uploadError;
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
        
        // Update job with storage path and set to upload_success
        await documentRepository.updateJobStatus(job.job_id, 'upload_success', { storage_path: storagePath });
        
        // Verify file exists in storage with retry logic
        await this.verifyFileInStorage(storagePath, job.job_id);
        
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

  // Get job status
  async getJobStatus(jobId) {
    try {
      // Check Supabase availability before getting job status
      await this.checkSupabaseAvailability();
      
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
      // Check Supabase availability before listing jobs
      await this.checkSupabaseAvailability();
      
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
      // Check Supabase availability before listing documents
      await this.checkSupabaseAvailability();
      
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
      // Check Supabase availability before getting document
      await this.checkSupabaseAvailability();
      
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
      // Check both Supabase and sidecar availability before processing
      await this.checkSupabaseAvailability();
      this.checkSidecarAvailability();

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

      // Get file name from job storage path
      const fileName = job.storage_path ? job.storage_path.split('/').pop() : null;
      if (!fileName) {
        throw new Error('File name not found in job storage path');
      }

      // Get file from Supabase Storage
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

      // Convert to buffer
      const fileBuffer = await fileData.arrayBuffer();

      // Call Python sidecar for processing
      const processingResult = await this.callPythonSidecar(fileBuffer, job, document, fileName);

      // Process DIP if this is a DIP job
      let dipResult = null;
      if (job.job_type === 'DIP') {
        try {
          this.requestLogger.info('Starting DIP processing', { jobId, docId: job.doc_id });
          
          // Generate DIP
          dipResult = await dipService.generateDIP(fileBuffer, job.doc_id, fileName, {
            job_id: job.job_id,
            manufacturer: document.manufacturer,
            model: document.model
          });

          // Update job with DIP results
          await documentRepository.updateJobProgress(jobId, {
            pages_total: processingResult.pages_total || 0,
            pages_ocr: processingResult.pages_ocr || 0,
            tables: processingResult.tables_found || 0,
            chunks: processingResult.chunks_processed || 0,
            upserted: processingResult.vectors_upserted || 0,
            skipped_duplicates: 0,
            // DIP-specific counters
            entities_extracted: dipResult.entities_count || 0,
            spec_hints_found: dipResult.hints_count || 0,
            golden_tests_generated: dipResult.tests_count || 0
          });

          // Mark DIP processing as successful
          await documentRepository.updateJobDIPSuccess(jobId, true);

          this.requestLogger.info('DIP processing completed', { 
            jobId, 
            entitiesCount: dipResult.entities_count,
            hintsCount: dipResult.hints_count,
            testsCount: dipResult.tests_count
          });
        } catch (dipError) {
          this.requestLogger.error('DIP processing failed', { 
            error: dipError.message, 
            jobId 
          });
          
          // Continue with regular processing even if DIP fails
          // Update job with error but don't fail the entire job
          await documentRepository.updateJobProgress(jobId, {
            pages_total: processingResult.pages_total || 0,
            pages_ocr: processingResult.pages_ocr || 0,
            tables: processingResult.tables_found || 0,
            chunks: processingResult.chunks_processed || 0,
            upserted: processingResult.vectors_upserted || 0,
            skipped_duplicates: 0,
            dip_error: dipError.message
          });

          // Mark DIP processing as failed
          await documentRepository.updateJobDIPSuccess(jobId, false);
        }
      } else {
        // Regular processing for non-DIP jobs
        await documentRepository.updateJobProgress(jobId, {
          pages_total: processingResult.pages_total || 0,
          pages_ocr: processingResult.pages_ocr || 0,
          tables: processingResult.tables_found || 0,
          chunks: processingResult.chunks_processed || 0,
          upserted: processingResult.vectors_upserted || 0,
          skipped_duplicates: 0
        });
      }

      // Parse DIP entities and insert into entity_candidates table for DIP jobs
      if (job.job_type === 'DIP' && dipResult) {
        try {
          const parseResult = await this.parseDIPToEntityCandidates(job.doc_id);
          this.requestLogger.info('DIP entities parsed successfully', {
            docId: job.doc_id,
            entitiesInserted: parseResult.entitiesInserted,
            totalEntities: parseResult.totalEntities
          });
        } catch (parseError) {
          this.requestLogger.error('Failed to parse DIP entities', {
            error: parseError.message,
            docId: job.doc_id,
            jobId
          });
          // Don't fail the job for entity parsing errors, just log them
        }
      }

      await documentRepository.updateJobStatus(jobId, 'completed');

      this.requestLogger.info('Job processing completed', { 
        jobId, 
        chunksProcessed: processingResult.chunks_processed,
        vectorsUpserted: processingResult.vectors_upserted,
        dipProcessed: job.job_type === 'DIP',
        entitiesExtracted: dipResult?.entities_count || 0,
        specHintsFound: dipResult?.hints_count || 0,
        goldenTestsGenerated: dipResult?.tests_count || 0
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

  // Parse DIP files and insert entities into entity_candidates table
  async parseDIPToEntityCandidates(docId) {
    try {
      // Read DIP file from storage
      const storage = await this.getSupabaseStorage();
      if (!storage) {
        throw new Error('Storage service unavailable');
      }

      const dipPath = `manuals/${docId}/dip.json`;
      const { data: dipData, error: dipError } = await storage.storage
        .from('documents')
        .download(dipPath);

      if (dipError || !dipData) {
        throw new Error(`Failed to read DIP file: ${dipError?.message || 'No data'}`);
      }

      const dipContent = await dipData.text();
      const dip = JSON.parse(dipContent);

      let entitiesInserted = 0;

      // Insert each entity as a candidate
      if (dip.entities && Array.isArray(dip.entities)) {
        for (const entity of dip.entities) {
          try {
                await suggestionsRepository.insertEntityCandidate(docId, entity, 'system');
            entitiesInserted++;
            this.requestLogger.info('Entity candidate inserted', { 
              docId, 
              entityType: entity.entity_type,
              entityValue: entity.value?.substring(0, 50) + '...' // Truncate for logging
            });
          } catch (entityInsertError) {
            this.requestLogger.warn('Failed to insert individual entity', {
              docId,
              entityType: entity.entity_type,
              error: entityInsertError.message
            });
            // Continue with other entities even if one fails
          }
        }
      }

      this.requestLogger.info('DIP entities parsed and inserted', {
        docId,
        entitiesInserted,
        totalEntities: dip.entities?.length || 0
      });

      return {
        success: true,
        entitiesInserted,
        totalEntities: dip.entities?.length || 0
      };

    } catch (error) {
      this.requestLogger.error('Failed to parse DIP to entity candidates', {
        docId,
        error: error.message
      });
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

  // Simulate processing for testing
  async simulateProcessing(jobId) {
    // Check Supabase availability before simulating
    await this.checkSupabaseAvailability();
    
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

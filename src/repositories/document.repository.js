import { getSupabaseClient } from './supabaseClient.js';
import { logger } from '../utils/logger.js';
import { isSupabaseConfigured } from '../services/guards/index.js';

class DocumentRepository {
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

  // Job Management
  async createJob(jobData) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('jobs')
        .insert([jobData])
        .select()
        .single();

      if (error) throw error;
      
      this.requestLogger.info('Job created', { jobId: data.job_id, docId: data.doc_id });
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to create job', { error: error.message, docId: jobData.doc_id });
      throw error;
    }
  }

  async getJob(jobId) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('job_id', jobId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to get job', { error: error.message, jobId });
      throw error;
    }
  }

  async updateJobStatus(jobId, status, updates = {}) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const updateData = {
        status,
        updated_at: new Date().toISOString(),
        ...updates
      };

      if (status === 'started' && !updates.started_at) {
        updateData.started_at = new Date().toISOString();
      }

      if (status === 'completed' || status === 'failed') {
        updateData.completed_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from('jobs')
        .update(updateData)
        .eq('job_id', jobId)
        .select()
        .single();

      if (error) throw error;
      
      this.requestLogger.info('Job status updated', { jobId, status });
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to update job status', { error: error.message, jobId, status });
      throw error;
    }
  }

  async updateJobProgress(jobId, counters) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('jobs')
        .update({ 
          counters,
          updated_at: new Date().toISOString()
        })
        .eq('job_id', jobId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to update job progress', { error: error.message, jobId });
      throw error;
    }
  }

  // Document Management
  async createOrUpdateDocument(docData) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('documents')
        .upsert([docData], { 
          onConflict: 'doc_id',
          ignoreDuplicates: false 
        })
        .select()
        .single();

      if (error) throw error;
      
      this.requestLogger.info('Document created/updated', { docId: data.doc_id });
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to create/update document', { error: error.message, docId: docData.doc_id });
      throw error;
    }
  }

  async getDocument(docId) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('doc_id', docId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to get document', { error: error.message, docId });
      throw error;
    }
  }

  async updateDocumentStats(docId, stats) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('documents')
        .update({
          chunk_count: stats.chunk_count || 0,
          table_count: stats.table_count || 0,
          pages_total: stats.pages_total || 0,
          last_ingested_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('doc_id', docId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to update document stats', { error: error.message, docId });
      throw error;
    }
  }

  async updateDocumentStoragePath(docId, storagePath) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('documents')
        .update({
          storage_path: storagePath,
          updated_at: new Date().toISOString()
        })
        .eq('doc_id', docId)
        .select()
        .single();

      if (error) throw error;
      
      this.requestLogger.info('Document storage path updated', { docId, storagePath });
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to update document storage path', { error: error.message, docId });
      throw error;
    }
  }

  // Document Chunks Management
  async createChunks(chunks) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      if (chunks.length === 0) return [];

      const { data, error } = await supabase
        .from('document_chunks')
        .insert(chunks)
        .select();

      if (error) throw error;
      
      this.requestLogger.info('Chunks created', { count: data.length, docId: chunks[0]?.doc_id });
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to create chunks', { error: error.message, count: chunks.length });
      throw error;
    }
  }

  async getChunksByDocId(docId) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('document_chunks')
        .select('*')
        .eq('doc_id', docId)
        .order('chunk_index');

      if (error) throw error;
      return data || [];
    } catch (error) {
      this.requestLogger.error('Failed to get chunks by doc_id', { error: error.message, docId });
      throw error;
    }
  }

  async getJobsByStatus(status, limit = 10) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      this.requestLogger.error('Failed to get jobs by status', { error: error.message, status });
      throw error;
    }
  }

  async getChunks(docId) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('document_chunks')
        .select('*')
        .eq('doc_id', docId)
        .order('page_start', { ascending: true });

      if (error) throw error;
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to get chunks', { error: error.message, docId });
      throw error;
    }
  }

  async checkChunkExists(chunkId) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('document_chunks')
        .select('chunk_id')
        .eq('chunk_id', chunkId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return !!data;
    } catch (error) {
      this.requestLogger.error('Failed to check chunk existence', { error: error.message, chunkId });
      throw error;
    }
  }

  // Utility Methods
  async getJobStatus(jobId) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .rpc('get_job_status', { job_uuid: jobId });

      if (error) throw error;
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to get job status', { error: error.message, jobId });
      throw error;
    }
  }

  async listJobs(limit = 50, offset = 0) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to list jobs', { error: error.message });
      throw error;
    }
  }

  async listDocuments(limit = 50, offset = 0) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .order('last_ingested_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to list documents', { error: error.message });
      throw error;
    }
  }
}

export default new DocumentRepository();

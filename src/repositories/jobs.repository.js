// src/repositories/jobs.repository.js
import { getSupabaseClient } from './supabaseClient.js';
import { logger } from '../utils/logger.js';

class JobsRepository {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  // Helper method to check if Supabase is available
  async checkSupabaseAvailability() {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      const error = new Error('Supabase client not available');
      error.code = 'SUPABASE_DISABLED';
      throw error;
    }
    return supabase;
  }

  /**
   * Fetch a job by its ID from the jobs table.
   * @param {string} id - The job UUID
   * @returns {Promise<Object>} - The job row
   */
  async getJobById(id) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('job_id', id)
        .single();

      if (error) throw error;
      
      this.requestLogger.info('Job retrieved by ID', { jobId: id });
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to get job by ID', { error: error.message, jobId: id });
      throw error;
    }
  }

  /**
   * Update a job's status by ID.
   * @param {string} id - The job UUID
   * @param {string} status - New status (queued|processing|completed|failed)
   * @param {Object} updates - Additional fields to update
   */
  async updateJobStatus(id, status, updates = {}) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const updateData = {
        status,
        updated_at: new Date().toISOString(),
        ...updates
      };

      if (status === 'processing' && !updates.started_at) {
        updateData.started_at = new Date().toISOString();
      }

      if (status === 'completed' || status === 'failed') {
        updateData.completed_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from('jobs')
        .update(updateData)
        .eq('job_id', id)
        .select()
        .single();

      if (error) throw error;
      
      this.requestLogger.info('Job status updated', { jobId: id, status });
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to update job status', { error: error.message, jobId: id, status });
      throw error;
    }
  }

  /**
   * Get jobs by status
   * @param {string} status - Job status to filter by
   * @param {number} limit - Maximum number of jobs to return
   * @param {number} offset - Number of jobs to skip
   * @returns {Promise<Array>} - Array of jobs
   */
  async getJobsByStatus(status, limit = 10, offset = 0) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      return data || [];
    } catch (error) {
      this.requestLogger.error('Failed to get jobs by status', { error: error.message, status });
      throw error;
    }
  }

  /**
   * Create a new job
   * @param {Object} jobData - Job data to insert
   * @returns {Promise<Object>} - Created job
   */
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
}

export default new JobsRepository();

import documentService from './document.service.js';
import documentRepository from '../repositories/document.repository.js';
import { logger } from '../utils/logger.js';

class JobProcessor {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
    this.isRunning = false;
    this.pollInterval = 5000; // 5 seconds
  }

  // Start the job processor
  async start() {
    if (this.isRunning) {
      this.requestLogger.warn('Job processor already running');
      return;
    }

    this.isRunning = true;
    this.requestLogger.info('Job processor started');

    while (this.isRunning) {
      try {
        await this.processPendingJobs();
        await this.sleep(this.pollInterval);
      } catch (error) {
        this.requestLogger.error('Error in job processor loop', { error: error.message });
        await this.sleep(this.pollInterval);
      }
    }
  }

  // Stop the job processor
  stop() {
    this.isRunning = false;
    this.requestLogger.info('Job processor stopped');
  }

  // Process pending jobs
  async processPendingJobs() {
    try {
      // Get queued DIP jobs specifically
      const queuedJobs = await documentRepository.getDIPJobsByStatus('queued', 10);
      
      if (queuedJobs.length === 0) {
        return; // No DIP jobs to process
      }

      this.requestLogger.info('Processing queued DIP jobs', { count: queuedJobs.length });

      // Process jobs concurrently (but limit concurrency)
      const processingPromises = queuedJobs.map(job => this.processJob(job.job_id));
      await Promise.allSettled(processingPromises);

    } catch (error) {
      this.requestLogger.error('Failed to process pending jobs', { error: error.message });
    }
  }

  // Process a single job
  async processJob(jobId) {
    try {
      this.requestLogger.info('Starting job processing', { jobId });
      
      await documentService.processJob(jobId);
      
      this.requestLogger.info('Job processing completed successfully', { jobId });
    } catch (error) {
      this.requestLogger.error('Job processing failed', { 
        jobId, 
        error: error.message 
      });
      
      // Update job status to failed
      try {
        await documentRepository.updateJobStatus(jobId, 'failed', {
          error: {
            stage: 'processing',
            message: error.message,
            timestamp: new Date().toISOString()
          }
        });
      } catch (updateError) {
        this.requestLogger.error('Failed to update job status to failed', { 
          jobId, 
          error: updateError.message 
        });
      }
    }
  }

  // Utility function to sleep
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get processor status
  getStatus() {
    return {
      isRunning: this.isRunning,
      pollInterval: this.pollInterval,
      timestamp: new Date().toISOString()
    };
  }
}

// Create singleton instance
const jobProcessor = new JobProcessor();

export default jobProcessor;

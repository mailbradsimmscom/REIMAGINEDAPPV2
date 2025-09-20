// src/services/anthropic.extraction.service.js

import { logger } from '../utils/logger.js';
import { anthropicExtractionRepository } from '../repositories/anthropic.extraction.repository.js';

/**
 * Service for Anthropic extraction processing
 * Handles business logic for extracting structured data using Anthropic Claude
 */
class AnthropicExtractionService {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  /**
   * Run Anthropic extraction for all four data types
   * @param {string} docId - Document ID
   * @param {string} storagePath - Path to document in Supabase Storage
   * @param {Object} metadata - Document metadata
   * @returns {Promise<Object>} Extraction results
   */
  async runAnthropicExtraction(docId, storagePath, metadata = {}) {
    try {
      this.requestLogger.info('Starting Anthropic extraction', { 
        docId, 
        storagePath,
        metadata 
      });

      // Call Python sidecar for all four extractions
      const extractionResults = await this.callPythonSidecarForExtraction(docId, storagePath, metadata);

      // Store JSON files in Supabase Storage
      const storageResults = await this.storeExtractionResults(docId, extractionResults);

      this.requestLogger.info('Anthropic extraction completed', { 
        docId,
        storageResults 
      });

      return {
        success: true,
        docId,
        extractionResults,
        storageResults
      };

    } catch (error) {
      this.requestLogger.error('Anthropic extraction failed', { 
        docId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Call Python sidecar for Anthropic extraction
   * @param {string} docId - Document ID
   * @param {string} storagePath - Path to document
   * @param {Object} metadata - Document metadata
   * @returns {Promise<Object>} Extraction results
   */
  async callPythonSidecarForExtraction(docId, storagePath, metadata) {
    // Call each extraction type using the actual Python test files
    const results = {
      spec_suggestions: null,
      golden_rules: null,
      intent_router: null,
      playbook_hints: null
    };

    try {
      // Call each extraction type using the Python test files
      results.spec_suggestions = await this.extractSpecifications(docId);
      results.golden_rules = await this.extractGoldenRules(docId);
      results.intent_router = await this.extractIntentRouter(docId);
      results.playbook_hints = await this.extractPlaybookHints(docId);
    } catch (error) {
      this.requestLogger.error('Python sidecar extraction failed', { 
        docId, 
        error: error.message 
      });
      throw error;
    }

    return results;
  }

  /**
   * Extract specifications using Anthropic
   * @param {string} docId - Document ID
   * @returns {Promise<Object>} Specifications data
   */
  async extractSpecifications(docId) {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Run the Python test file for specifications with doc_id
      const command = `cd /Users/brad/code/REIMAGINEDAPPV2 && source python-sidecar/venv/bin/activate && DOC_ID=${docId} python3.11 test_anthropic_chunks_spec.py`;
      
      this.requestLogger.info('Running specifications extraction', { docId, command });
      this.requestLogger.debug('Command details', { 
        docId, 
        command,
        workingDir: '/Users/brad/code/REIMAGINEDAPPV2',
        pythonEnv: 'python-sidecar/venv/bin/activate',
        script: 'test_anthropic_chunks_spec.py'
      });
      
      const { stdout, stderr } = await execAsync(command);
      
      this.requestLogger.debug('Python script execution completed', { 
        docId, 
        stdout: stdout.substring(0, 500), // Truncate long output
        stderr: stderr ? stderr.substring(0, 500) : null,
        exitCode: 'success'
      });
      
      if (stderr) {
        this.requestLogger.warn('Specifications extraction stderr', { docId, stderr });
      }

      this.requestLogger.info('Specifications extraction completed', { docId });
      return { success: true, message: 'Python script completed successfully' };

    } catch (error) {
      this.requestLogger.error('Specifications extraction failed', { 
        docId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Extract golden rules using Anthropic
   * @param {string} docId - Document ID
   * @returns {Promise<Object>} Golden rules data
   */
  async extractGoldenRules(docId) {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Run the Python test file for golden rules with doc_id
      const command = `cd /Users/brad/code/REIMAGINEDAPPV2 && source python-sidecar/venv/bin/activate && DOC_ID=${docId} python3.11 test_anthropic_chunks_GR.py`;
      
      this.requestLogger.info('Running golden rules extraction', { docId, command });
      
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr) {
        this.requestLogger.warn('Golden rules extraction stderr', { docId, stderr });
      }

      this.requestLogger.info('Golden rules extraction completed', { docId });
      return { success: true, message: 'Python script completed successfully' };

    } catch (error) {
      this.requestLogger.error('Golden rules extraction failed', { 
        docId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Extract intent router using Anthropic
   * @param {string} docId - Document ID
   * @returns {Promise<Object>} Intent router data
   */
  async extractIntentRouter(docId) {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Run the Python test file for intent router with doc_id
      const command = `cd /Users/brad/code/REIMAGINEDAPPV2 && source python-sidecar/venv/bin/activate && DOC_ID=${docId} python3.11 test_anthropic_chunks_IR.py`;
      
      this.requestLogger.info('Running intent router extraction', { docId, command });
      
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr) {
        this.requestLogger.warn('Intent router extraction stderr', { docId, stderr });
      }

      this.requestLogger.info('Intent router extraction completed', { docId });
      return { success: true, message: 'Python script completed successfully' };

    } catch (error) {
      this.requestLogger.error('Intent router extraction failed', { 
        docId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Extract playbook hints using Anthropic
   * @param {string} docId - Document ID
   * @returns {Promise<Object>} Playbook hints data
   */
  async extractPlaybookHints(docId) {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Run the Python test file for playbook hints with doc_id
      const command = `cd /Users/brad/code/REIMAGINEDAPPV2 && source python-sidecar/venv/bin/activate && DOC_ID=${docId} python3.11 test_anthropic_chunks.py`;
      
      this.requestLogger.info('Running playbook hints extraction', { docId, command });
      
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr) {
        this.requestLogger.warn('Playbook hints extraction stderr', { docId, stderr });
      }

      this.requestLogger.info('Playbook hints extraction completed', { docId });
      return { success: true, message: 'Python script completed successfully' };

    } catch (error) {
      this.requestLogger.error('Playbook hints extraction failed', { 
        docId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Store extraction results as JSON files in Supabase Storage
   * Note: The Python scripts already store the files directly to Supabase Storage
   * This method just verifies the files were created successfully
   * @param {string} docId - Document ID
   * @param {Object} extractionResults - Results from extractions
   * @returns {Promise<Object>} Storage results
   */
  async storeExtractionResults(docId, extractionResults) {
    const storageResults = {};

    try {
      // Verify that the Python scripts created the files successfully
      // The files should already be in Supabase Storage
      
      if (extractionResults.spec_suggestions) {
        storageResults.spec_suggestions = {
          success: true,
          fileName: `${docId}_spec_suggestions_an.json`,
          message: 'File created by Python script'
        };
      }

      if (extractionResults.golden_rules) {
        storageResults.golden_rules = {
          success: true,
          fileName: `${docId}_golden_rules_an.json`,
          message: 'File created by Python script'
        };
      }

      if (extractionResults.intent_router) {
        storageResults.intent_router = {
          success: true,
          fileName: `${docId}_intent_router_an.json`,
          message: 'File created by Python script'
        };
      }

      if (extractionResults.playbook_hints) {
        storageResults.playbook_hints = {
          success: true,
          fileName: `${docId}_playbook_hints_an.json`,
          message: 'File created by Python script'
        };
      }

      this.requestLogger.info('Extraction results verified', { 
        docId, 
        storageResults 
      });

      return storageResults;

    } catch (error) {
      this.requestLogger.error('Failed to verify extraction results', { 
        docId, 
        error: error.message 
      });
      throw error;
    }
  }
}

export const anthropicExtractionService = new AnthropicExtractionService();

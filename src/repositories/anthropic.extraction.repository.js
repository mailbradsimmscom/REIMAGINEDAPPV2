// src/repositories/anthropic.extraction.repository.js

import { getSupabaseClient } from './supabaseClient.js';
import { logger } from '../utils/logger.js';

/**
 * Repository for Anthropic extraction data operations
 * Handles all I/O operations for storing Anthropic extraction results
 */
class AnthropicExtractionRepository {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  /**
   * Store specifications JSON to Supabase Storage
   * @param {string} docId - Document ID
   * @param {Object} specifications - Specifications data
   * @returns {Promise<Object>} Storage result
   */
  async storeSpecSuggestions(docId, specifications) {
    try {
      const supabase = await getSupabaseClient();
      
      const fileName = `${docId}_spec_suggestions_an.json`;
      const filePath = `manuals/${docId}/DIP/${fileName}`;
      
      const jsonContent = JSON.stringify(specifications, null, 2);
      
      const { data, error } = await supabase.storage
        .from('documents')
        .upload(filePath, jsonContent, {
          contentType: 'text/plain',
          upsert: true
        });

      if (error) {
        this.requestLogger.error('Failed to store spec suggestions', { 
          docId, 
          fileName, 
          error: error.message 
        });
        throw error;
      }

      this.requestLogger.info('Spec suggestions stored successfully', { 
        docId, 
        fileName, 
        path: data.path 
      });

      return {
        success: true,
        fileName,
        path: data.path,
        size: jsonContent.length
      };

    } catch (error) {
      this.requestLogger.error('Error storing spec suggestions', { 
        docId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Store golden rules JSON to Supabase Storage
   * @param {string} docId - Document ID
   * @param {Object} goldenRules - Golden rules data
   * @returns {Promise<Object>} Storage result
   */
  async storeGoldenRules(docId, goldenRules) {
    try {
      const supabase = await getSupabaseClient();
      
      const fileName = `${docId}_golden_rules_an.json`;
      const filePath = `manuals/${docId}/DIP/${fileName}`;
      
      const jsonContent = JSON.stringify(goldenRules, null, 2);
      
      const { data, error } = await supabase.storage
        .from('documents')
        .upload(filePath, jsonContent, {
          contentType: 'text/plain',
          upsert: true
        });

      if (error) {
        this.requestLogger.error('Failed to store golden rules', { 
          docId, 
          fileName, 
          error: error.message 
        });
        throw error;
      }

      this.requestLogger.info('Golden rules stored successfully', { 
        docId, 
        fileName, 
        path: data.path 
      });

      return {
        success: true,
        fileName,
        path: data.path,
        size: jsonContent.length
      };

    } catch (error) {
      this.requestLogger.error('Error storing golden rules', { 
        docId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Store intent router JSON to Supabase Storage
   * @param {string} docId - Document ID
   * @param {Object} intentRouter - Intent router data
   * @returns {Promise<Object>} Storage result
   */
  async storeIntentRouter(docId, intentRouter) {
    try {
      const supabase = await getSupabaseClient();
      
      const fileName = `${docId}_intent_router_an.json`;
      const filePath = `manuals/${docId}/DIP/${fileName}`;
      
      const jsonContent = JSON.stringify(intentRouter, null, 2);
      
      const { data, error } = await supabase.storage
        .from('documents')
        .upload(filePath, jsonContent, {
          contentType: 'text/plain',
          upsert: true
        });

      if (error) {
        this.requestLogger.error('Failed to store intent router', { 
          docId, 
          fileName, 
          error: error.message 
        });
        throw error;
      }

      this.requestLogger.info('Intent router stored successfully', { 
        docId, 
        fileName, 
        path: data.path 
      });

      return {
        success: true,
        fileName,
        path: data.path,
        size: jsonContent.length
      };

    } catch (error) {
      this.requestLogger.error('Error storing intent router', { 
        docId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Store playbook hints JSON to Supabase Storage
   * @param {string} docId - Document ID
   * @param {Object} playbookHints - Playbook hints data
   * @returns {Promise<Object>} Storage result
   */
  async storePlaybookHints(docId, playbookHints) {
    try {
      const supabase = await getSupabaseClient();
      
      const fileName = `${docId}_playbook_hints_an.json`;
      const filePath = `manuals/${docId}/DIP/${fileName}`;
      
      const jsonContent = JSON.stringify(playbookHints, null, 2);
      
      const { data, error } = await supabase.storage
        .from('documents')
        .upload(filePath, jsonContent, {
          contentType: 'text/plain',
          upsert: true
        });

      if (error) {
        this.requestLogger.error('Failed to store playbook hints', { 
          docId, 
          fileName, 
          error: error.message 
        });
        throw error;
      }

      this.requestLogger.info('Playbook hints stored successfully', { 
        docId, 
        fileName, 
        path: data.path 
      });

      return {
        success: true,
        fileName,
        path: data.path,
        size: jsonContent.length
      };

    } catch (error) {
      this.requestLogger.error('Error storing playbook hints', { 
        docId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Read JSON file from Supabase Storage
   * @param {string} docId - Document ID
   * @param {string} fileName - File name to read
   * @returns {Promise<Object>} JSON data
   */
  async readJsonFile(docId, fileName) {
    try {
      const supabase = await getSupabaseClient();
      
      const filePath = `manuals/${docId}/DIP/${fileName}`;
      
      this.requestLogger.debug('Reading JSON file from Supabase Storage', { 
        docId, 
        fileName, 
        filePath,
        bucket: 'documents'
      });
      
      const { data, error } = await supabase.storage
        .from('documents')
        .download(filePath);

      if (error) {
        this.requestLogger.error('Failed to read JSON file', { 
          docId, 
          fileName, 
          error: error.message,
          errorCode: error.statusCode,
          filePath
        });
        throw error;
      }

      const text = await data.text();
      const jsonData = JSON.parse(text);
      
      this.requestLogger.debug('JSON file parsed successfully', { 
        docId, 
        fileName,
        textLength: text.length,
        jsonKeys: Object.keys(jsonData)
      });

      this.requestLogger.info('JSON file read successfully', { 
        docId, 
        fileName 
      });

      return jsonData;

    } catch (error) {
      this.requestLogger.error('Error reading JSON file', { 
        docId, 
        fileName, 
        error: error.message,
        errorStack: error.stack
      });
      throw error;
    }
  }
}

export const anthropicExtractionRepository = new AnthropicExtractionRepository();

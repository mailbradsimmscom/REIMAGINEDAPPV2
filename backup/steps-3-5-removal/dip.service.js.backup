/**
 * DIP Service
 * Handles Document Intelligence Packet processing via Python sidecar
 */

import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';

class DIPService {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  /**
   * Generate DIP from document file
   * @param {Buffer} fileBuffer - The PDF file buffer
   * @param {string} docId - Document ID
   * @param {string} fileName - File name
   * @param {Object} options - Processing options
   * @returns {Object} DIP generation result
   */
  // COMMENTED OUT - OLD 2-FILE DIP METHOD
  // async generateDIP(fileBuffer, docId, fileName, options = {}) {
  //   try {
  //     this.requestLogger.info('Starting DIP generation', { docId, fileName });

  //     const sidecarUrl = getEnv().PYTHON_SIDECAR_URL;
  //     if (!sidecarUrl) {
  //       throw new Error('Python sidecar URL not configured');
  //     }

  //     // Call DIP endpoint
  //     const response = await fetch(`${sidecarUrl}/v1/dip`, {
  //       method: 'POST',
  //       headers: {
  //         'Content-Type': 'application/json'
  //       },
  //       body: JSON.stringify({ doc_id: docId })
  //     });

  //     if (!response.ok) {
  //       const errorText = await response.text();
  //       throw new Error(`DIP generation failed: ${response.status} ${errorText}`);
  //     }

  //     const result = await response.json();
      
  //     if (!result.success) {
  //       throw new Error(`DIP generation failed: ${result.error || 'Unknown error'}`);
  //     }

  //     this.requestLogger.info('DIP generation completed', {
  //       docId,
  //       entitiesCount: result.entities_count,
  //       hintsCount: result.hints_count,
  //       testsCount: result.tests_count,
  //       processingTime: result.processing_time
  //     });

  //     return result;
  //   } catch (error) {
  //     this.requestLogger.error('DIP generation failed', {
  //       error: error.message,
  //       docId,
  //       fileName
  //     });
  //     throw error;
  //   }
  // }

  /**
   * Run complete DIP packet processing and save files
   * @param {string} docId - Document ID
   * @param {string} filePath - Path to the PDF file
   * @param {string} outputDir - Output directory for DIP files
   * @param {Object} options - Processing options
   * @returns {Object} DIP packet processing result
   */
  async runDIPPacket(docId, filePath, outputDir, options = {}) {
    try {
      this.requestLogger.info('Starting DIP packet processing', { docId, filePath, outputDir });

      const sidecarUrl = getEnv().PYTHON_SIDECAR_URL;
      if (!sidecarUrl) {
        throw new Error('Python sidecar URL not configured');
      }

      const requestData = {
        doc_id: docId,
        file_path: filePath,
        output_dir: outputDir,
        options: {
          enhanced: true,
          ...options
        }
      };

      // Call DIP packet endpoint
      const response = await fetch(`${sidecarUrl}/v1/runDocIntelligencePacket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DIP packet processing failed: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(`DIP packet processing failed: ${result.error || 'Unknown error'}`);
      }

      this.requestLogger.info('DIP packet processing completed', {
        docId,
        processingTime: result.processing_time,
        outputFiles: Object.keys(result.output_files || {})
      });

      return result;
    } catch (error) {
      this.requestLogger.error('DIP packet processing failed', {
        error: error.message,
        docId,
        filePath
      });
      throw error;
    }
  }

  /**
   * Check if DIP processing is available
   * @returns {boolean} True if DIP processing is available
   */
  async checkDIPAvailability() {
    try {
      const sidecarUrl = getEnv().PYTHON_SIDECAR_URL;
      if (!sidecarUrl) {
        return false;
      }

      const response = await fetch(`${sidecarUrl}/health`);
      return response.ok;
    } catch (error) {
      this.requestLogger.warn('DIP availability check failed', { error: error.message });
      return false;
    }
  }

  /**
   * Get DIP processing statistics
   * @param {string} docId - Document ID
   * @returns {Object} DIP statistics
   */
  async getDIPStats(docId) {
    try {
      // This would typically read from the generated DIP files
      // For now, return basic stats
      return {
        docId,
        entitiesExtracted: 0,
        specHintsFound: 0,
        goldenTestsGenerated: 0,
        lastProcessed: null
      };
    } catch (error) {
      this.requestLogger.error('Failed to get DIP stats', { error: error.message, docId });
      throw error;
    }
  }
}

export default new DIPService();

import express from 'express';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/upload/documents - List documents for upload page
router.get('/documents', 
  async (req, res, next) => {
    try {
      const supabase = await getSupabaseClient();
      
      // Step 1: Query documents table for basic info
      const { data: documents, error } = await supabase
        .from('documents')
        .select('doc_id, manufacturer_norm, model_norm, created_at, last_ingested_at')
        .order('last_ingested_at', { ascending: false });

      if (error) {
        logger.error('Failed to fetch documents from database', { error: error.message });
        throw error;
      }

      // Step 2: For each document, get filename from storage
      const formattedDocuments = await Promise.all(
        documents.map(async (doc) => {
          try {
            // List files in the document's storage directory
            const { data: storageFiles, error: storageError } = await supabase.storage
              .from('documents')
              .list('manuals/' + doc.doc_id + '/');

            let filename = 'Unknown';
            let fileSize = 0;

            if (!storageError && storageFiles && storageFiles.length > 0) {
              // Find the main document file (usually PDF)
              const mainFile = storageFiles.find(file => 
                file.name.endsWith('.pdf') || 
                file.name.endsWith('.doc') || 
                file.name.endsWith('.docx')
              ) || storageFiles[0]; // Fallback to first file
              
              filename = mainFile.name;
              fileSize = mainFile.metadata?.size || 0;
            }

                   return {
                     id: doc.doc_id,
                     manufacturer: doc.manufacturer_norm || 'Unknown',
                     model: doc.model_norm || 'Unknown',
                     filename: filename,
                     size: fileSize
                   };
          } catch (storageErr) {
            logger.error('Failed to get storage info for document', { 
              doc_id: doc.doc_id, 
              error: storageErr.message 
            });
                   return {
                     id: doc.doc_id,
                     manufacturer: doc.manufacturer_norm || 'Unknown',
                     model: doc.model_norm || 'Unknown',
                     filename: 'Error loading filename',
                     size: 0
                   };
          }
        })
      );

      const envelope = {
        success: true,
        data: {
          documents: formattedDocuments,
          count: formattedDocuments.length
        },
        error: null
      };

      return res.json(envelope);
      
    } catch (error) {
      logger.error('Upload documents API error', { error: error.message });
      return next(error);
    }
  }
);

// Method not allowed for all other methods
router.all('/documents', (req, res) => {
  return res.status(405).json({
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  });
});

export default router;

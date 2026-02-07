import express from 'express';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// Require Supabase for all upload routes
router.use(requireServices(['supabase']));

// GET /admin/upload/documents - List documents for upload page
router.get('/documents', 
  async (req, res, next) => {
    try {
      const supabase = await getSupabaseClient();
      
      // Step 1: Query documents table for basic info
      const { data: documents, error } = await supabase
        .from('documents')
        .select('doc_id, manufacturer_norm, model_norm, created_at, last_ingested_at, ingest_stats')
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
                     size: fileSize,
                     created_at: doc.created_at,
                     ingest_stats: doc.ingest_stats || null
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
                     size: 0,
                     created_at: doc.created_at,
                     ingest_stats: doc.ingest_stats || null
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

// PATCH /admin/upload/documents/:docId/ingest-stats - Save ingest stats for a document
router.patch('/documents/:docId/ingest-stats',
  async (req, res, next) => {
    try {
      const { docId } = req.params;
      const { ingest_stats } = req.body;

      if (!docId) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_DOC_ID', message: 'docId is required' }
        });
      }

      if (!ingest_stats || typeof ingest_stats !== 'object') {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATS', message: 'ingest_stats object is required' }
        });
      }

      const supabase = await getSupabaseClient();

      const { data, error } = await supabase
        .from('documents')
        .update({
          ingest_stats,
          updated_at: new Date().toISOString()
        })
        .eq('doc_id', docId)
        .select('doc_id, ingest_stats')
        .single();

      if (error) {
        logger.error('Failed to save ingest stats', { error: error.message, docId });
        throw error;
      }

      logger.info('Ingest stats saved', { docId });

      return res.json({
        success: true,
        data: { doc_id: data.doc_id, ingest_stats: data.ingest_stats }
      });

    } catch (error) {
      logger.error('Save ingest stats error', { error: error.message });
      return next(error);
    }
  }
);

export default router;

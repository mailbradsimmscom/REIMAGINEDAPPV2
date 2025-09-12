// src/routes/admin/dip-cleaner.route.js
import { Router } from "express";
import { cleanDipForDoc } from '../services/dip-cleaner/dip-cleaner.service.js';
import { adminOnly } from '../../middleware/admin.js';
import { logger } from '../../utils/logger.js';

export const dipCleanerRouter = Router();

/**
 * POST /admin/api/dip/clean
 * Body: { doc_id: string, job_id?: string }
 */
dipCleanerRouter.post("/api/dip/clean", adminOnly, async (req, res) => {
  try {
    const { doc_id: docId, job_id: jobId } = req.body ?? {};
    if (!docId) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'INVALID_REQUEST', message: 'doc_id required' },
        requestId: req.id
      });
    }

    const result = await cleanDipForDoc(docId, jobId ?? null);
    
    return res.status(200).json({
      success: true,
      data: result,
      error: null,
      requestId: req.id
    });
  } catch (e) {
    logger.error('DIP Cleaner route error', { error: e.message, docId: req.body?.doc_id });
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: String(e?.message ?? e) },
      requestId: req.id
    });
  }
});

/**
 * Duplicate Review Routes
 * API endpoints for human-in-the-loop deduplication
 */

import express from 'express';
import * as duplicateReviewService from '../../services/duplicate-review.service.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

/**
 * GET /admin/api/duplicate-review/candidates
 * Get unreviewed duplicate pairs for human review
 */
router.get('/candidates', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();

  try {
    requestLogger.info('Fetching duplicate candidates');

    const result = await duplicateReviewService.getCandidates();

    if (result.error) {
      return res.status(404).json({
        success: false,
        error: {
          code: result.error,
          message: result.message
        },
        data: {
          total: 0,
          reviewed: 0,
          remaining: 0,
          pairs: []
        }
      });
    }

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    requestLogger.error('Error fetching candidates', { error: error.message });
    return next(error);
  }
});

/**
 * POST /admin/api/duplicate-review/decision
 * Submit a human decision on a duplicate pair
 *
 * Body:
 * {
 *   "task_a_id": "task-123",
 *   "task_b_id": "task-456",
 *   "human_decision": "duplicate" | "keep_both",
 *   "delete_which": "task_a" | "task_b" | "both" (required if human_decision is "duplicate"),
 *   "confidence": "high" | "medium" | "low" (optional),
 *   "notes": "Optional notes" (optional)
 * }
 */
router.post('/decision', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { task_a_id, task_b_id, human_decision, confidence, notes, delete_which } = req.body;

    // Validation
    if (!task_a_id || !task_b_id) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'task_a_id and task_b_id are required'
        }
      });
    }

    if (!human_decision || !['duplicate', 'keep_both'].includes(human_decision)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_DECISION',
          message: 'human_decision must be "duplicate" or "keep_both"'
        }
      });
    }

    if (human_decision === 'duplicate' && !delete_which) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DELETE_WHICH',
          message: 'delete_which is required when marking as duplicate'
        }
      });
    }

    if (delete_which && !['task_a', 'task_b', 'both'].includes(delete_which)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_DELETE_WHICH',
          message: 'delete_which must be "task_a", "task_b", or "both"'
        }
      });
    }

    if (confidence && !['high', 'medium', 'low'].includes(confidence)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CONFIDENCE',
          message: 'confidence must be "high", "medium", or "low"'
        }
      });
    }

    requestLogger.info('Processing decision', {
      taskAId: task_a_id,
      taskBId: task_b_id,
      decision: human_decision,
      deleteWhich: delete_which
    });

    const result = await duplicateReviewService.submitDecision({
      task_a_id,
      task_b_id,
      human_decision,
      confidence,
      notes,
      delete_which
    });

    // Get updated candidate count
    const candidates = await duplicateReviewService.getCandidates();

    return res.json({
      success: true,
      data: {
        ...result,
        remaining_pairs: candidates.remaining
      }
    });
  } catch (error) {
    requestLogger.error('Error processing decision', { error: error.message });

    // Check if it's a Pinecone deletion error
    if (error.message.includes('Failed to delete from Pinecone')) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'PINECONE_DELETION_FAILED',
          message: error.message
        }
      });
    }

    return next(error);
  }
});

/**
 * GET /admin/api/duplicate-review/stats
 * Get review statistics and ML training readiness
 */
router.get('/stats', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();

  try {
    requestLogger.info('Fetching review stats');

    const stats = await duplicateReviewService.getStats();

    return res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    requestLogger.error('Error fetching stats', { error: error.message });
    return next(error);
  }
});

export default router;

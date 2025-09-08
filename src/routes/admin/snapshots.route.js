/**
 * Admin snapshots route - Rollback functionality and snapshot management
 * Provides endpoints for managing snapshots and rolling back changes
 */

import { Router } from 'express';
import { 
  listSnapshots, 
  getSnapshotInfo, 
  deleteSnapshot, 
  cleanupSnapshots,
  rollbackTo 
} from '../../utils/snapshots.service.js';
import { logger } from '../../utils/logger.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { EnvelopeSchema } from '../../schemas/envelope.schema.js';

const router = Router();

// Add validateResponse middleware
router.use(validateResponse(EnvelopeSchema));

/**
 * GET /admin/snapshots
 * List all available snapshots
 */
router.get('/admin/snapshots', async (req, res) => {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const { limit = 50, offset = 0 } = req.query;
    
    requestLogger.info('Listing snapshots', { limit, offset });
    
    const snapshots = await listSnapshots();
    
    // Apply pagination
    const startIndex = parseInt(offset);
    const endIndex = startIndex + parseInt(limit);
    const paginatedSnapshots = snapshots.slice(startIndex, endIndex);
    
    requestLogger.info('Snapshots listed', { 
      total: snapshots.length, 
      returned: paginatedSnapshots.length 
    });
    
    res.json({
      success: true,
      data: {
        snapshots: paginatedSnapshots,
        pagination: {
          total: snapshots.length,
          limit: parseInt(limit),
          offset: parseInt(offset),
          has_more: endIndex < snapshots.length
        }
      },
      requestId: requestLogger.requestId
    });
    
  } catch (error) {
    requestLogger.error('Failed to list snapshots', { error: error.message });
    
    res.status(500).json({
      success: false,
      error: 'Failed to list snapshots',
      details: error.message,
      requestId: requestLogger.requestId
    });
  }
});

/**
 * GET /admin/snapshots/:snapshotId
 * Get detailed information about a specific snapshot
 */
router.get('/admin/snapshots/:snapshotId', async (req, res) => {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const { snapshotId } = req.params;
    
    if (!snapshotId || typeof snapshotId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid snapshot ID is required',
        requestId: requestLogger.requestId
      });
    }
    
    requestLogger.info('Getting snapshot info', { snapshotId });
    
    const snapshotInfo = await getSnapshotInfo(snapshotId);
    
    requestLogger.info('Snapshot info retrieved', { 
      snapshotId, 
      fileCount: snapshotInfo.file_count 
    });
    
    res.json({
      success: true,
      data: snapshotInfo,
      requestId: requestLogger.requestId
    });
    
  } catch (error) {
    requestLogger.error('Failed to get snapshot info', { 
      snapshotId: req.params.snapshotId, 
      error: error.message 
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to get snapshot info',
      details: error.message,
      requestId: requestLogger.requestId
    });
  }
});

/**
 * POST /admin/snapshots/rollback
 * Rollback to a specific snapshot
 */
router.post('/admin/snapshots/rollback', expressJson(), async (req, res) => {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const { snapshot_id, confirm = false } = req.body;
    
    if (!snapshot_id || typeof snapshot_id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid snapshot ID is required',
        requestId: requestLogger.requestId
      });
    }
    
    if (!confirm) {
      return res.status(400).json({
        success: false,
        error: 'Rollback confirmation is required',
        details: 'Set confirm: true in request body to proceed with rollback',
        requestId: requestLogger.requestId
      });
    }
    
    requestLogger.info('Starting rollback', { snapshotId: snapshot_id });
    
    // Perform rollback
    const rollbackResult = await rollbackTo(snapshot_id);
    
    // Log rollback action for audit
    requestLogger.info('Rollback completed', {
      snapshotId: snapshot_id,
      restoredFiles: rollbackResult.restored_files.length,
      errors: rollbackResult.errors.length,
      action: 'rollback',
      timestamp: rollbackResult.restored_at
    });
    
    res.json({
      success: true,
      data: rollbackResult,
      requestId: requestLogger.requestId
    });
    
  } catch (error) {
    requestLogger.error('Failed to rollback', { 
      snapshotId: req.body.snapshot_id, 
      error: error.message 
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to rollback',
      details: error.message,
      requestId: requestLogger.requestId
    });
  }
});

/**
 * DELETE /admin/snapshots/:snapshotId
 * Delete a specific snapshot
 */
router.delete('/admin/snapshots/:snapshotId', async (req, res) => {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const { snapshotId } = req.params;
    
    if (!snapshotId || typeof snapshotId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid snapshot ID is required',
        requestId: requestLogger.requestId
      });
    }
    
    requestLogger.info('Deleting snapshot', { snapshotId });
    
    const deleteResult = await deleteSnapshot(snapshotId);
    
    // Log deletion action for audit
    requestLogger.info('Snapshot deleted', {
      snapshotId,
      action: 'delete',
      timestamp: deleteResult.deleted_at
    });
    
    res.json({
      success: true,
      data: deleteResult,
      requestId: requestLogger.requestId
    });
    
  } catch (error) {
    requestLogger.error('Failed to delete snapshot', { 
      snapshotId: req.params.snapshotId, 
      error: error.message 
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to delete snapshot',
      details: error.message,
      requestId: requestLogger.requestId
    });
  }
});

/**
 * POST /admin/snapshots/cleanup
 * Clean up old snapshots (keep only the most recent N)
 */
router.post('/admin/snapshots/cleanup', expressJson(), async (req, res) => {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const { keep_count = 10 } = req.body;
    
    if (typeof keep_count !== 'number' || keep_count < 1) {
      return res.status(400).json({
        success: false,
        error: 'Valid keep_count (number >= 1) is required',
        requestId: requestLogger.requestId
      });
    }
    
    requestLogger.info('Starting snapshot cleanup', { keepCount: keep_count });
    
    const cleanupResult = await cleanupSnapshots(keep_count);
    
    // Log cleanup action for audit
    requestLogger.info('Snapshot cleanup completed', {
      keptCount: cleanupResult.kept_count,
      deletedCount: cleanupResult.deleted_count,
      deletedSnapshots: cleanupResult.deleted_snapshots,
      action: 'cleanup',
      timestamp: new Date().toISOString()
    });
    
    res.json({
      success: true,
      data: cleanupResult,
      requestId: requestLogger.requestId
    });
    
  } catch (error) {
    requestLogger.error('Failed to cleanup snapshots', { error: error.message });
    
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup snapshots',
      details: error.message,
      requestId: requestLogger.requestId
    });
  }
});

/**
 * Express JSON middleware (simplified)
 * @returns {Function} Express middleware
 */
function expressJson() {
  return (req, res, next) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        req.body = JSON.parse(body);
        next();
      } catch (error) {
        res.status(400).json({
          success: false,
          error: 'Invalid JSON payload'
        });
      }
    });
  };
}

export default router;

/**
 * Snapshot service for safe configuration file management
 * Provides version control and rollback capabilities for JSON config files
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';

// Snapshot storage directory
const SNAP_DIR = path.resolve(process.cwd(), '.data-snapshots');

/**
 * Create a snapshot of specified files
 * @param {string[]} files - Array of file paths to snapshot (relative to project root)
 * @returns {Promise<Object>} Snapshot result with ID and directory
 */
export async function createSnapshot(files) {
  const requestLogger = logger.createRequestLogger();
  
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Files array is required and cannot be empty');
  }
  
  try {
    // Create timestamp-based snapshot ID
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotId = `snap-${timestamp}`;
    const snapshotDir = path.join(SNAP_DIR, snapshotId);
    
    // Create snapshot directory
    await fs.mkdir(snapshotDir, { recursive: true });
    
    const snapshotInfo = {
      snapshot_id: snapshotId,
      dir: snapshotDir,
      files: [],
      created_at: new Date().toISOString(),
      file_count: 0
    };
    
    // Copy each file to snapshot directory
    for (const filePath of files) {
      try {
        const sourcePath = path.resolve(process.cwd(), filePath);
        const targetPath = path.join(snapshotDir, filePath);
        
        // Ensure target directory exists
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        
        // Copy file
        await fs.copyFile(sourcePath, targetPath);
        
        snapshotInfo.files.push(filePath);
        snapshotInfo.file_count++;
        
        requestLogger.info('File snapshotted', { 
          file: filePath, 
          snapshotId,
          size: (await fs.stat(sourcePath)).size
        });
        
      } catch (fileError) {
        // Log warning but continue with other files
        requestLogger.warn('Failed to snapshot file', { 
          file: filePath, 
          error: fileError.message,
          snapshotId
        });
      }
    }
    
    // Write snapshot metadata
    const metadataPath = path.join(snapshotDir, '.snapshot.json');
    await fs.writeFile(metadataPath, JSON.stringify(snapshotInfo, null, 2));
    
    requestLogger.info('Snapshot created', { 
      snapshotId, 
      fileCount: snapshotInfo.file_count,
      totalFiles: files.length
    });
    
    return snapshotInfo;
    
  } catch (error) {
    requestLogger.error('Failed to create snapshot', { 
      error: error.message,
      fileCount: files.length
    });
    throw error;
  }
}

/**
 * Restore files from a snapshot
 * @param {string} snapshotId - Snapshot ID to restore from
 * @returns {Promise<Object>} Restore result with restored files count
 */
export async function rollbackTo(snapshotId) {
  const requestLogger = logger.createRequestLogger();
  
  if (!snapshotId || typeof snapshotId !== 'string') {
    throw new Error('Valid snapshot ID is required');
  }
  
  try {
    const snapshotDir = path.join(SNAP_DIR, snapshotId);
    
    // Check if snapshot exists
    try {
      await fs.access(snapshotDir);
    } catch {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    
    // Read snapshot metadata
    const metadataPath = path.join(snapshotDir, '.snapshot.json');
    let snapshotInfo;
    try {
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      snapshotInfo = JSON.parse(metadataContent);
    } catch {
      // Fallback: list files in snapshot directory
      snapshotInfo = {
        snapshot_id: snapshotId,
        files: await listFiles(snapshotDir),
        file_count: 0
      };
    }
    
    const restoreResult = {
      snapshot_id: snapshotId,
      restored_files: [],
      restored_count: 0,
      errors: [],
      restored_at: new Date().toISOString()
    };
    
    // Restore each file
    for (const filePath of snapshotInfo.files) {
      try {
        const sourcePath = path.join(snapshotDir, filePath);
        const targetPath = path.resolve(process.cwd(), filePath);
        
        // Ensure target directory exists
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        
        // Copy file back
        await fs.copyFile(sourcePath, targetPath);
        
        restoreResult.restored_files.push(filePath);
        restoreResult.restored_count++;
        
        requestLogger.info('File restored', { 
          file: filePath, 
          snapshotId
        });
        
      } catch (fileError) {
        const error = `Failed to restore ${filePath}: ${fileError.message}`;
        restoreResult.errors.push(error);
        requestLogger.warn('Failed to restore file', { 
          file: filePath, 
          error: fileError.message,
          snapshotId
        });
      }
    }
    
    requestLogger.info('Rollback completed', { 
      snapshotId, 
      restoredCount: restoreResult.restored_count,
      errorCount: restoreResult.errors.length
    });
    
    return restoreResult;
    
  } catch (error) {
    requestLogger.error('Failed to rollback', { 
      snapshotId, 
      error: error.message
    });
    throw error;
  }
}

/**
 * List all available snapshots
 * @returns {Promise<Array>} Array of snapshot information
 */
export async function listSnapshots() {
  const requestLogger = logger.createRequestLogger();
  
  try {
    // Ensure snapshots directory exists
    await fs.mkdir(SNAP_DIR, { recursive: true });
    
    const entries = await fs.readdir(SNAP_DIR, { withFileTypes: true });
    const snapshots = [];
    
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('snap-')) {
        const snapshotDir = path.join(SNAP_DIR, entry.name);
        const metadataPath = path.join(snapshotDir, '.snapshot.json');
        
        let snapshotInfo;
        try {
          const metadataContent = await fs.readFile(metadataPath, 'utf-8');
          snapshotInfo = JSON.parse(metadataContent);
        } catch {
          // Fallback: basic info
          snapshotInfo = {
            snapshot_id: entry.name,
            created_at: (await fs.stat(snapshotDir)).mtime.toISOString(),
            file_count: (await listFiles(snapshotDir)).length
          };
        }
        
        snapshots.push(snapshotInfo);
      }
    }
    
    // Sort by creation time (newest first)
    snapshots.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    requestLogger.info('Snapshots listed', { count: snapshots.length });
    
    return snapshots;
    
  } catch (error) {
    requestLogger.error('Failed to list snapshots', { error: error.message });
    throw error;
  }
}

/**
 * Delete a snapshot
 * @param {string} snapshotId - Snapshot ID to delete
 * @returns {Promise<Object>} Deletion result
 */
export async function deleteSnapshot(snapshotId) {
  const requestLogger = logger.createRequestLogger();
  
  if (!snapshotId || typeof snapshotId !== 'string') {
    throw new Error('Valid snapshot ID is required');
  }
  
  try {
    const snapshotDir = path.join(SNAP_DIR, snapshotId);
    
    // Check if snapshot exists
    try {
      await fs.access(snapshotDir);
    } catch {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    
    // Remove snapshot directory
    await fs.rm(snapshotDir, { recursive: true, force: true });
    
    requestLogger.info('Snapshot deleted', { snapshotId });
    
    return {
      snapshot_id: snapshotId,
      deleted_at: new Date().toISOString(),
      success: true
    };
    
  } catch (error) {
    requestLogger.error('Failed to delete snapshot', { 
      snapshotId, 
      error: error.message
    });
    throw error;
  }
}

/**
 * Get snapshot information
 * @param {string} snapshotId - Snapshot ID
 * @returns {Promise<Object>} Snapshot information
 */
export async function getSnapshotInfo(snapshotId) {
  const requestLogger = logger.createRequestLogger();
  
  if (!snapshotId || typeof snapshotId !== 'string') {
    throw new Error('Valid snapshot ID is required');
  }
  
  try {
    const snapshotDir = path.join(SNAP_DIR, snapshotId);
    const metadataPath = path.join(snapshotDir, '.snapshot.json');
    
    // Check if snapshot exists
    try {
      await fs.access(snapshotDir);
    } catch {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    
    // Read metadata
    const metadataContent = await fs.readFile(metadataPath, 'utf-8');
    const snapshotInfo = JSON.parse(metadataContent);
    
    // Add current file sizes
    const fileSizes = {};
    for (const filePath of snapshotInfo.files) {
      try {
        const fullPath = path.join(snapshotDir, filePath);
        const stats = await fs.stat(fullPath);
        fileSizes[filePath] = stats.size;
      } catch {
        fileSizes[filePath] = 0;
      }
    }
    
    snapshotInfo.file_sizes = fileSizes;
    
    requestLogger.info('Snapshot info retrieved', { snapshotId });
    
    return snapshotInfo;
    
  } catch (error) {
    requestLogger.error('Failed to get snapshot info', { 
      snapshotId, 
      error: error.message
    });
    throw error;
  }
}

/**
 * Clean up old snapshots (keep only the most recent N)
 * @param {number} keepCount - Number of snapshots to keep (default: 10)
 * @returns {Promise<Object>} Cleanup result
 */
export async function cleanupSnapshots(keepCount = 10) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const snapshots = await listSnapshots();
    
    if (snapshots.length <= keepCount) {
      return {
        kept_count: snapshots.length,
        deleted_count: 0,
        deleted_snapshots: []
      };
    }
    
    const toDelete = snapshots.slice(keepCount);
    const deletedSnapshots = [];
    
    for (const snapshot of toDelete) {
      try {
        await deleteSnapshot(snapshot.snapshot_id);
        deletedSnapshots.push(snapshot.snapshot_id);
      } catch (error) {
        requestLogger.warn('Failed to delete snapshot during cleanup', {
          snapshotId: snapshot.snapshot_id,
          error: error.message
        });
      }
    }
    
    requestLogger.info('Snapshot cleanup completed', {
      keptCount: keepCount,
      deletedCount: deletedSnapshots.length
    });
    
    return {
      kept_count: keepCount,
      deleted_count: deletedSnapshots.length,
      deleted_snapshots: deletedSnapshots
    };
    
  } catch (error) {
    requestLogger.error('Failed to cleanup snapshots', { error: error.message });
    throw error;
  }
}

/**
 * Helper function to recursively list files in a directory
 * @param {string} dir - Directory path
 * @param {string} prefix - Path prefix for relative paths
 * @returns {Promise<Array>} Array of relative file paths
 */
async function listFiles(dir, prefix = '') {
  const files = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const name = entry.name;
      
      // Skip snapshot metadata file
      if (name === '.snapshot.json') continue;
      
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const fullPath = path.join(dir, name);
      
      if (entry.isDirectory()) {
        const subFiles = await listFiles(fullPath, relativePath);
        files.push(...subFiles);
      } else {
        files.push(relativePath);
      }
    }
  } catch (error) {
    // Directory might not exist or be accessible
    logger.warn('Failed to list directory', { dir, error: error.message });
  }
  
  return files;
}

/**
 * Maintenance Tasks Routes
 * API endpoints for browsing maintenance tasks
 */

import express from 'express';
import { Pinecone } from '@pinecone-database/pinecone';
import { logger } from '../../utils/logger.js';
import { getEnv } from '../../config/env.js';

const router = express.Router();

const env = getEnv();
const pinecone = new Pinecone({ apiKey: env.PINECONE_API_KEY });

/**
 * GET /admin/api/maintenance-tasks/list
 * Get all maintenance tasks from Pinecone
 */
router.get('/list', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();

  try {
    requestLogger.info('Fetching all maintenance tasks');

    // Fetch all tasks from Pinecone directly
    const index = pinecone.index(env.PINECONE_INDEX);
    const namespace = index.namespace('MAINTENANCE_TASKS');

    let allVectors = [];
    let paginationToken = undefined;

    // Paginate through all vectors
    do {
      const listResponse = await namespace.listPaginated({
        prefix: 'task-',
        limit: 100,
        paginationToken
      });

      if (listResponse.vectors) {
        allVectors.push(...listResponse.vectors);
      }

      paginationToken = listResponse.pagination?.next;
    } while (paginationToken);

    // Fetch full records with embeddings
    const fetchResponse = await namespace.fetch(allVectors.map(v => v.id));
    const records = Object.values(fetchResponse.records || {});

    // Transform to simpler format
    const tasks = records.map(record => ({
      id: record.id,
      description: record.metadata.description,
      asset_uid: record.metadata.asset_uid,
      system_name: record.metadata.system_name,
      frequency_basis: record.metadata.frequency_basis,
      frequency_type: record.metadata.frequency_type ?? null,
      frequency_value: record.metadata.frequency_value ?? null,
      frequency_hours: record.metadata.frequency_hours ?? null,
      task_type: record.metadata.task_type,
      criticality: record.metadata.criticality ?? null,
      confidence: record.metadata.confidence ?? null,
      source: record.metadata.source ?? null
    }));

    requestLogger.info('Fetched tasks', { count: tasks.length });

    return res.json({
      success: true,
      data: {
        tasks,
        total: tasks.length
      }
    });
  } catch (error) {
    requestLogger.error('Error fetching tasks', { error: error.message });
    return next(error);
  }
});

export default router;

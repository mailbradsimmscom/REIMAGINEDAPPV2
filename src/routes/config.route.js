import express from 'express';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const requestLogger = logger.createRequestLogger();

// Single source of truth for chat configuration
router.get('/chat', (req, res) => {
  const env = getEnv();

  const config = {
    TWO_CALL_MODE: env.TWO_CALL_MODE === 'true',
    WEB_ENRICHMENT_TIMEOUT_MS: parseInt(env.WEB_ENRICHMENT_TIMEOUT_MS || '60000'),
    PINECONE_CHUNKS_FOR_CACHE: parseInt(env.PINECONE_CHUNKS_FOR_CACHE || '5'),
    PINECONE_CHUNK_SIZE: parseInt(env.PINECONE_CHUNK_SIZE || '1000')
  };

  requestLogger.info('📋 Chat config requested', config);

  res.json({
    success: true,
    data: config
  });
});

export default router;
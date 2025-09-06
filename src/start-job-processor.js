/**
 * Standalone Job Processor Worker
 * Runs the job processor as a dedicated Node process
 * Use when deploying as a separate container or process manager
 */

import 'dotenv/config';
import { logger } from './utils/logger.js';
import { getEnv } from './config/env.js';
import jobProcessor from './services/job.processor.js';

const log = logger.createRequestLogger();

/**
 * This file runs the job processor as a dedicated Node process.
 * Use when deploying as a separate container or process manager.
 */

let processor;

async function main() {
  log.info('Starting job worker…');

  // Concurrency & polling cadence come from env with safe defaults
  const concurrency = Number(getEnv({ loose: true }).JOB_CONCURRENCY ?? 2);
  const pollIntervalMs = Number(getEnv({ loose: true }).JOB_POLL_INTERVAL_MS ?? 5000);

  // Check if job processor is already running
  if (processor && processor.isRunning) {
    log.warn('Job processor already running');
    return;
  }

  // Start the run loop
  await jobProcessor.start();
  log.info({ concurrency, pollIntervalMs }, 'Job worker started');
}

// Graceful shutdown
async function shutdown(signal = 'SIGTERM') {
  try {
    log.info({ signal }, 'Shutting down job worker…');
    if (processor) {
      await processor.stop?.(); // call stop() if implemented
    }
    log.info('Job worker stopped. Bye!');
    process.exit(0);
  } catch (err) {
    log.error({ err }, 'Error during worker shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  log.error({ err }, 'Unhandled promise rejection in worker');
});
process.on('uncaughtException', (err) => {
  log.error({ err }, 'Uncaught exception in worker');
  // Let your orchestrator restart the worker
  process.exit(1);
});

main().catch((err) => {
  logger.error({ err }, 'Fatal: worker failed to start');
  process.exit(1);
});

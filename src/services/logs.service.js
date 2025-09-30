import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';

const moduleLogger = logger.createModuleLogger('logs.service');

/**
 * Read and parse log files from the logs directory
 * Merges logs from node-web, python-sidecar, and worker
 */
export async function getLogs({ level, service, module, correlationId, limit = 100, search } = {}) {
  const logsDir = join(process.cwd(), 'logs');

  try {
    // Define log files to read
    const logFiles = [
      'combined.log',                      // Node.js combined logs
      'python-sidecar-combined.log',       // Python sidecar logs
    ];

    let allLogs = [];

    // Read each log file
    for (const file of logFiles) {
      const filePath = join(logsDir, file);

      try {
        const content = await fs.readFile(filePath, 'utf8');
        const logs = content
          .split('\n')
          .filter(line => line.trim())
          .map(line => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(log => log !== null);

        allLogs = allLogs.concat(logs);
      } catch (error) {
        // File doesn't exist or can't be read, skip it
        moduleLogger.debug(`Could not read log file: ${file}`, {
          error: error.message
        });
      }
    }

    // Sort by timestamp (newest first)
    allLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Apply filters
    let filteredLogs = allLogs;

    if (level && level !== 'all') {
      filteredLogs = filteredLogs.filter(log => log.level === level.toUpperCase());
    }

    if (service && service !== 'all') {
      filteredLogs = filteredLogs.filter(log => log.service === service);
    }

    if (module && module !== 'all') {
      filteredLogs = filteredLogs.filter(log => log.module === module);
    }

    if (correlationId) {
      filteredLogs = filteredLogs.filter(log =>
        log.correlationId === correlationId ||
        log.correlation_id === correlationId ||
        log.request_id === correlationId
      );
    }

    if (search) {
      const searchLower = search.toLowerCase();
      filteredLogs = filteredLogs.filter(log =>
        log.message?.toLowerCase().includes(searchLower) ||
        JSON.stringify(log).toLowerCase().includes(searchLower)
      );
    }

    // Apply limit
    const limitedLogs = filteredLogs.slice(0, limit);

    return {
      logs: limitedLogs,
      total: filteredLogs.length,
      returned: limitedLogs.length,
      filters: {
        level,
        service,
        module,
        correlationId,
        search,
        limit
      }
    };

  } catch (error) {
    moduleLogger.error('Failed to read logs', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Get available services from log files
 */
export async function getLogMetadata() {
  try {
    const result = await getLogs({ limit: 1000 }); // Sample logs to get metadata

    const services = new Set();
    const modules = new Set();
    const levels = new Set();

    result.logs.forEach(log => {
      if (log.service) services.add(log.service);
      if (log.module) modules.add(log.module);
      if (log.level) levels.add(log.level);
    });

    return {
      services: Array.from(services).sort(),
      modules: Array.from(modules).sort(),
      levels: Array.from(levels).sort()
    };
  } catch (error) {
    moduleLogger.error('Failed to get log metadata', {
      error: error.message
    });
    return {
      services: ['node-web', 'python-sidecar', 'worker'],
      modules: [],
      levels: ['ERROR', 'WARN', 'INFO', 'DEBUG']
    };
  }
}
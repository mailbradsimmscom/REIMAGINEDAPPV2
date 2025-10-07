import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';

const moduleLogger = logger.createModuleLogger('logs.service');

/**
 * Strip ANSI color codes from string
 */
function stripAnsiCodes(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Parse log file content based on format
 * Handles both chat format [CHAT] HH:MM:SS | message and standard format
 */
function parseLogFile(content, source) {
  const lines = content.split('\n').filter(line => line.trim());
  const logs = [];
  let currentLog = null;

  for (let line of lines) {
    // Strip ANSI color codes
    line = stripAnsiCodes(line);

    // Check if this is a chat log entry: [CHAT] 12:34:56 | message
    const chatMatch = line.match(/^\[(\w+)\]\s+(\d{2}:\d{2}:\d{2})\s+\|\s+(.+)$/);
    // Check if this is a standard log entry: [2025-10-07T00:43:21.123Z] [INFO] [module] message
    const standardMatch = line.match(/^\[([^\]]+)\]\s+\[(\w+)\]\s+\[([^\]]+)\]\s+(.+)$/);

    if (chatMatch) {
      // Save previous log if exists
      if (currentLog) {
        logs.push(currentLog);
      }

      // Parse chat format
      const [, type, time, message] = chatMatch;
      currentLog = {
        timestamp: parseLogTimestamp(time),
        type,
        level: mapTypeToLevel(type),
        message,
        details: {},
        source,
        service: source.startsWith('node') ? 'node-web' : 'python-sidecar'
      };
    } else if (standardMatch) {
      // Save previous log if exists
      if (currentLog) {
        logs.push(currentLog);
      }

      // Parse standard format
      const [, timestamp, level, module, message] = standardMatch;
      currentLog = {
        timestamp,
        type: level,
        level,
        message,
        module,
        source,
        service: source.startsWith('node') ? 'node-web' : 'python-sidecar'
      };
    } else if (currentLog && line.trim().startsWith('  ')) {
      // This is a detail line (indented) - add to current log
      const detailMatch = line.trim().match(/^([^:]+):\s*(.+)$/);
      if (detailMatch) {
        const [, key, value] = detailMatch;
        if (!currentLog.details) currentLog.details = {};
        currentLog.details[key] = value;
      }
    }
  }

  // Don't forget last log
  if (currentLog) {
    logs.push(currentLog);
  }

  return logs;
}

/**
 * Map log type to level
 */
function mapTypeToLevel(type) {
  const mapping = {
    'ERROR': 'ERROR',
    'WARN': 'WARN',
    'WARNING': 'WARN',
    'INFO': 'INFO',
    'DEBUG': 'DEBUG',
    'CHAT': 'INFO',
    'RESPONSE': 'INFO',
    'SUCCESS': 'INFO',
    'MATCH': 'INFO',
    'SEARCH': 'INFO'
  };
  return mapping[type.toUpperCase()] || 'INFO';
}

/**
 * Parse time from log (HH:MM:SS format) and convert to ISO timestamp
 */
function parseLogTimestamp(timeStr) {
  const today = new Date();
  const [hours, minutes, seconds] = timeStr.split(':').map(Number);
  today.setHours(hours, minutes, seconds, 0);
  return today.toISOString();
}

// Map source names to file paths
const LOG_FILES = {
  'node-chat': 'chat/node-chat.log',
  'node-api': 'api/node-api.log',
  'node-errors': 'errors/node-errors.log',
  'node-debug': 'debug/node-debug.log',
  'python-chat': 'chat/python-chat.log',
  'python-api': 'api/python-api.log',
  'python-errors': 'errors/python-errors.log',
  'python-debug': 'debug/python-debug.log'
};

/**
 * Calculate timestamp for "since" filter
 */
function calculateSinceTimestamp(since) {
  if (!since || since === 'all') return null;

  const now = new Date();
  const match = since.match(/^(\d+)([hm])$/);
  if (!match) return null;

  const [, amount, unit] = match;
  const ms = unit === 'h' ? amount * 60 * 60 * 1000 : amount * 60 * 1000;

  return new Date(now.getTime() - ms);
}

/**
 * Read and parse log files from the logs directory
 * Reads from new organized log structure (chat/, api/, errors/, debug/)
 */
export async function getLogs({ level, service, module, correlationId, limit = 100, search, source, since } = {}) {
  const logsDir = join(process.cwd(), 'logs');

  try {
    let allLogs = [];

    // If specific source requested, only read that file
    const filesToRead = source && LOG_FILES[source]
      ? [{ path: LOG_FILES[source], source }]
      : Object.entries(LOG_FILES).map(([src, path]) => ({ path, source: src }));

    // Read each log file
    for (const { path: relativePath, source: logSource } of filesToRead) {
      const filePath = join(logsDir, relativePath);

      try {
        const content = await fs.readFile(filePath, 'utf8');
        const logs = parseLogFile(content, logSource);
        allLogs = allLogs.concat(logs);
      } catch (error) {
        // File doesn't exist or can't be read, skip it
        moduleLogger.debug(`Could not read log file: ${relativePath}`, {
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

    // Filter by time range
    const sinceTimestamp = calculateSinceTimestamp(since);
    if (sinceTimestamp) {
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= sinceTimestamp);
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
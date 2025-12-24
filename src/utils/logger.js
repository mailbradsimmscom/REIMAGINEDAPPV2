import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

class Logger {
  constructor() {
    this.logsDir = join(process.cwd(), 'logs');
    this.maxLogSize = 5 * 1024 * 1024; // 5MB
    this.maxLogFiles = 5;
    this.healthCheckPaths = ['/health', '/admin/api/health', '/v1/pinecone/stats'];
    this.ensureLogsDirectory();
  }

  // Get environment values at runtime
  async getEnv() {
    const { getEnv } = await import('../config/env.js');
    return getEnv();
  }

  async ensureLogsDirectory() {
    try {
      await fs.access(this.logsDir);
    } catch {
      await fs.mkdir(this.logsDir, { recursive: true });
    }

    // Create subdirectories
    const subdirs = ['chat', 'api', 'errors', 'debug'];
    for (const dir of subdirs) {
      const dirPath = join(this.logsDir, dir);
      try {
        await fs.access(dirPath);
      } catch {
        await fs.mkdir(dirPath, { recursive: true });
      }
    }
  }

  isHealthCheck(meta = {}) {
    // Check if this is a health check request
    if (meta.path) {
      return this.healthCheckPaths.some(hc => meta.path.includes(hc));
    }
    if (meta.message && typeof meta.message === 'string') {
      return this.healthCheckPaths.some(hc => meta.message.includes(hc));
    }
    return false;
  }

  formatChatLog(level, message, meta = {}) {
    const timestamp = new Date().toTimeString().split(' ')[0];
    const logType = meta.logType || level;

    let formatted = `[${logType}] ${timestamp} | ${message}`;

    if (meta.details) {
      for (const [key, value] of Object.entries(meta.details)) {
        formatted += `\n  ${key}: ${value}`;
      }
    }

    return formatted + '\n';
  }

  formatHumanLog(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const module = meta.module || 'unknown';

    let formatted = `[${timestamp}] [${level.toUpperCase()}] [${module}] ${message}`;

    // Include ALL meta fields (except internal ones)
    const skipKeys = new Set(['module', 'correlationId', 'requestId']);
    const metaEntries = Object.entries(meta).filter(([k]) => !skipKeys.has(k));

    if (metaEntries.length > 0) {
      for (const [key, value] of metaEntries) {
        if (value !== undefined && value !== null) {
          const valueStr = typeof value === 'object' ? JSON.stringify(value) : value;
          formatted += `\n  ${key}: ${valueStr}`;
        }
      }
    }

    return formatted + '\n';
  }

  async writeLog(level, message, meta = {}) {
    try {
      const env = await this.getEnv();

      // Skip health checks for API logs
      const isHealthCheck = this.isHealthCheck(meta);

      // In production, ONLY log to console (Render captures console output)
      if (env.NODE_ENV === 'production') {
        // Log everything to console (Render will capture it)
        if (!isHealthCheck) {
          const timestamp = new Date().toISOString();
          const module = meta.module || 'app';
          console.log(`[${timestamp}] [${level.toUpperCase()}] [${module}] ${message}`, meta);
        }
        return; // Skip file writes in production
      }

      // Development: Log to console for visibility (except health checks)
      if ((level === 'error' || level === 'warn') && !isHealthCheck) {
        console.log(`[${level.toUpperCase()}] ${message}`, meta);
      }

      // Development: Write to files
      const isChat = meta.module?.includes('chat') || meta.logType === 'CHAT';
      const isError = level === 'error';

      // Write to chat log if chat-related
      if (isChat) {
        const chatLog = this.formatChatLog(level, message, meta);
        const chatFile = join(this.logsDir, 'chat', 'node-chat.log');
        await fs.appendFile(chatFile, chatLog);
      }

      // Write to API log (excluding health checks)
      if (!isHealthCheck) {
        const apiLog = this.formatHumanLog(level, message, meta);
        const apiFile = join(this.logsDir, 'api', 'node-api.log');
        await fs.appendFile(apiFile, apiLog);
      }

      // Write to error log
      if (isError) {
        const errorLog = this.formatHumanLog(level, message, meta);
        const errorFile = join(this.logsDir, 'errors', 'node-errors.log');
        await fs.appendFile(errorFile, errorLog);
      }

      // Write to debug log (everything)
      const debugLog = this.formatHumanLog(level, message, meta);
      const debugFile = join(this.logsDir, 'debug', 'node-debug.log');
      await fs.appendFile(debugFile, debugLog);

    } catch (error) {
      // Fallback to console if file writing fails
      console.error('Logging failed:', error.message);
    }
  }

  async checkLogRotation(logFile) {
    try {
      const stats = await fs.stat(logFile);
      if (stats.size > this.maxLogSize) {
        await this.rotateLog(logFile);
      }
    } catch (error) {
      // File doesn't exist yet, that's okay
    }
  }

  async rotateLog(logFile) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = `${logFile}.${timestamp}`;
    
    try {
      await fs.rename(logFile, backupFile);
      
      // Keep only the most recent files
      const files = await fs.readdir(this.logsDir);
      const logFiles = files.filter(f => f.startsWith('combined.log.')).sort().reverse();
      
      if (logFiles.length > this.maxLogFiles) {
        for (const file of logFiles.slice(this.maxLogFiles)) {
          await fs.unlink(join(this.logsDir, file));
        }
      }
    } catch (error) {
      // Rotation failed, continue with current file
    }
  }

  async readLogs(options = {}) {
    const { level = 'all', limit = 100, correlationId } = options;
    
    try {
      const logFile = join(this.logsDir, 'combined.log');
      const content = await fs.readFile(logFile, 'utf8');
      
      let logs = content
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

      // Filter by level
      if (level !== 'all') {
        logs = logs.filter(log => log.level === level.toUpperCase());
      }

      // Filter by correlation ID
      if (correlationId) {
        logs = logs.filter(log => log.correlationId === correlationId);
      }

      // Apply limit and reverse for newest first
      return logs.slice(-limit).reverse();
    } catch (error) {
      return [];
    }
  }

  // Convenience methods
  async error(message, meta = {}) {
    await this.writeLog('ERROR', message, meta);
  }

  async warn(message, meta = {}) {
    await this.writeLog('WARN', message, meta);
  }

  async info(message, meta = {}) {
    await this.writeLog('INFO', message, meta);
  }

  async debug(message, meta = {}) {
    await this.writeLog('DEBUG', message, meta);
  }

  // Performance logging
  async performance(operation, duration, meta = {}) {
    await this.writeLog('INFO', 'Performance metric', {
      operation,
      duration,
      unit: 'ms',
      ...meta
    });
  }

  // Security logging
  async security(event, userId, meta = {}) {
    await this.writeLog('WARN', 'Security event', {
      event,
      userId,
      ...meta
    });
  }

  // Chat logging with structured format
  async chat(type, message, details = {}, meta = {}) {
    await this.writeLog('INFO', message, {
      ...meta,
      logType: type,  // CHAT, MATCH, SEARCH, RESPONSE, SUCCESS, ERROR
      details,
      module: 'chat'
    });
  }

  // Request-scoped logging
  createRequestLogger(correlationId = randomUUID(), module = 'unknown') {
    return {
      requestId: correlationId,  // Expose for passing to other services
      error: (message, meta = {}) => this.error(message, { correlationId, module, ...meta }),
      warn: (message, meta = {}) => this.warn(message, { correlationId, module, ...meta }),
      info: (message, meta = {}) => this.info(message, { correlationId, module, ...meta }),
      debug: (message, meta = {}) => this.debug(message, { correlationId, module, ...meta }),
      performance: (operation, duration, meta = {}) => this.performance(operation, duration, { correlationId, module, ...meta }),
      chat: (type, message, details = {}, meta = {}) => this.chat(type, message, details, { correlationId, module, ...meta })
    };
  }

  // Module-scoped logging (for services, repositories, etc.)
  createModuleLogger(module) {
    return {
      error: (message, meta = {}) => this.error(message, { module, ...meta }),
      warn: (message, meta = {}) => this.warn(message, { module, ...meta }),
      info: (message, meta = {}) => this.info(message, { module, ...meta }),
      debug: (message, meta = {}) => this.debug(message, { module, ...meta }),
      performance: (operation, duration, meta = {}) => this.performance(operation, duration, { module, ...meta }),
      chat: (type, message, details = {}, meta = {}) => this.chat(type, message, details, { module, ...meta }),
      createRequestLogger: (correlationId) => this.createRequestLogger(correlationId, module)
    };
  }
}

// Create singleton instance
export const logger = new Logger();

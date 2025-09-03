import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

class Logger {
  constructor() {
    this.logsDir = join(process.cwd(), 'logs');
    this.maxLogSize = 5 * 1024 * 1024; // 5MB
    this.maxLogFiles = 5;
    this.ensureLogsDirectory();
  }

  // Get environment values at runtime
  async getEnv() {
    const { env } = await import('../config/env.js');
    return env;
  }

  async ensureLogsDirectory() {
    try {
      await fs.access(this.logsDir);
    } catch {
      await fs.mkdir(this.logsDir, { recursive: true });
    }
  }

  async writeLog(level, message, meta = {}) {
    const env = await this.getEnv();
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      correlationId: meta.correlationId || randomUUID(),
      service: 'reimagined-app',
      version: env.appVersion,
      environment: env.nodeEnv,
      ...meta
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    const logFile = join(this.logsDir, 'combined.log');

    try {
      await fs.appendFile(logFile, logLine);
      
      // Also write to level-specific file
      const levelFile = join(this.logsDir, `${level.toLowerCase()}.log`);
      await fs.appendFile(levelFile, logLine);
      
      // Check if we need to rotate logs
      await this.checkLogRotation(logFile);
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

  // Request-scoped logging
  createRequestLogger(correlationId = randomUUID()) {
    return {
      error: (message, meta = {}) => this.error(message, { correlationId, ...meta }),
      warn: (message, meta = {}) => this.warn(message, { correlationId, ...meta }),
      info: (message, meta = {}) => this.info(message, { correlationId, ...meta }),
      debug: (message, meta = {}) => this.debug(message, { correlationId, ...meta }),
      performance: (operation, duration, meta = {}) => this.performance(operation, duration, { correlationId, ...meta })
    };
  }
}

// Create singleton instance
export const logger = new Logger();

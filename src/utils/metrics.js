/**
 * Metrics collection utility for tracking fuzzy matching and context operations
 * Provides performance monitoring and success rate tracking
 */

import { logger } from './logger.js';

export class MetricsCollector {
  constructor() {
    this.metrics = new Map();
    this.startTimes = new Map();
    this.requestCounts = new Map();
  }

  /**
   * Start timing an operation
   * @param {string} operation - Operation name
   * @param {Object} tags - Additional tags for the operation
   */
  startTimer(operation, tags = {}) {
    const key = this._buildKey(operation, tags);
    this.startTimes.set(key, Date.now());
  }

  /**
   * End timing an operation and record the duration
   * @param {string} operation - Operation name
   * @param {Object} tags - Additional tags for the operation
   * @returns {number} Duration in milliseconds
   */
  endTimer(operation, tags = {}) {
    const key = this._buildKey(operation, tags);
    const startTime = this.startTimes.get(key);
    
    if (!startTime) {
      logger.warn('Timer not found for operation', { operation, tags });
      return 0;
    }
    
    const duration = Date.now() - startTime;
    this.recordMetric('operation_duration', duration, { operation, ...tags });
    this.startTimes.delete(key);
    
    return duration;
  }

  /**
   * Record a metric value
   * @param {string} name - Metric name
   * @param {number} value - Metric value
   * @param {Object} tags - Additional tags
   */
  recordMetric(name, value, tags = {}) {
    const key = this._buildKey(name, tags);
    const existing = this.metrics.get(key) || { 
      count: 0, 
      sum: 0, 
      min: Infinity, 
      max: -Infinity,
      values: []
    };
    
    existing.count++;
    existing.sum += value;
    existing.min = Math.min(existing.min, value);
    existing.max = Math.max(existing.max, value);
    existing.avg = existing.sum / existing.count;
    existing.values.push(value);
    
    // Keep only last 100 values to prevent memory bloat
    if (existing.values.length > 100) {
      existing.values = existing.values.slice(-100);
    }
    
    this.metrics.set(key, existing);
  }

  /**
   * Increment a counter metric
   * @param {string} name - Counter name
   * @param {Object} tags - Additional tags
   * @param {number} increment - Increment amount (default: 1)
   */
  incrementCounter(name, tags = {}, increment = 1) {
    const key = this._buildKey(name, tags);
    const existing = this.metrics.get(key) || { count: 0 };
    existing.count += increment;
    this.metrics.set(key, existing);
  }

  /**
   * Record a success/failure event
   * @param {string} operation - Operation name
   * @param {boolean} success - Whether the operation succeeded
   * @param {Object} tags - Additional tags
   */
  recordSuccess(operation, success, tags = {}) {
    // Record with simplified key for success rate calculation
    this.incrementCounter('operation_result', { operation, success });
    
    // Also record with additional tags for detailed analysis
    if (Object.keys(tags).length > 0) {
      this.incrementCounter('operation_result_detailed', { operation, success, ...tags });
    }
  }

  /**
   * Get all metrics
   * @returns {Object} All collected metrics
   */
  getMetrics() {
    const result = {};
    for (const [key, data] of this.metrics) {
      result[key] = { ...data };
    }
    return result;
  }

  /**
   * Get metrics summary for specific operations
   * @param {string} operation - Operation name
   * @returns {Object} Metrics summary
   */
  getOperationSummary(operation) {
    const operationMetrics = {};
    
    for (const [key, data] of this.metrics) {
      if (key.includes(`operation=${operation}`)) {
        const metricName = key.split('&')[0];
        operationMetrics[metricName] = { ...data };
      }
    }
    
    return operationMetrics;
  }

  /**
   * Get success rate for an operation
   * @param {string} operation - Operation name
   * @returns {number} Success rate (0-1)
   */
  getSuccessRate(operation) {
    const successKey = this._buildKey('operation_result', { operation, success: true });
    const failureKey = this._buildKey('operation_result', { operation, success: false });
    
    const successCount = this.metrics.get(successKey)?.count || 0;
    const failureCount = this.metrics.get(failureKey)?.count || 0;
    const total = successCount + failureCount;
    
    return total > 0 ? successCount / total : 0;
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics.clear();
    this.startTimes.clear();
    this.requestCounts.clear();
  }

  /**
   * Build a key for metrics storage
   * @param {string} name - Metric name
   * @param {Object} tags - Tags
   * @returns {string} Storage key
   */
  _buildKey(name, tags) {
    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    
    return tagString ? `${name}&${tagString}` : name;
  }

  /**
   * Get metrics in a format suitable for monitoring dashboards
   * @returns {Object} Dashboard-ready metrics
   */
  getDashboardMetrics() {
    const dashboard = {
      context_rewrite: {
        total_operations: 0,
        success_rate: 0,
        avg_duration: 0,
        result_breakdown: {},
        performance_score: 0
      },
      maintenance_detection: {
        total_questions: 0,
        detection_rate: 0,
        fuzzy_matches: 0,
        exact_matches: 0,
        avg_duration: 0,
        performance_score: 0
      },
      units_normalization: {
        total_operations: 0,
        success_rate: 0,
        avg_duration: 0,
        fuzzy_success_rate: 0,
        unit_type_breakdown: {},
        performance_score: 0,
        hit_rate_by_category: {}
      },
      fuzzy_matching: {
        total_operations: 0,
        success_rate: 0,
        avg_confidence: 0,
        typo_corrections: 0,
        performance_score: 0
      }
    };

    // Process maintenance detection metrics
    const maintenanceMetrics = this.getOperationSummary('maintenance_detection');
    if (maintenanceMetrics.operation_duration) {
      dashboard.maintenance_detection.total_questions = maintenanceMetrics.operation_duration.count;
      dashboard.maintenance_detection.avg_duration = maintenanceMetrics.operation_duration.avg;
    }
    
    const maintenanceSuccessRate = this.getSuccessRate('maintenance_detection');
    dashboard.maintenance_detection.performance_score = this._calculatePerformanceScore(
      maintenanceSuccessRate, 
      maintenanceMetrics.operation_duration?.avg || 0, 
      100 // target duration ms
    );

    // Process units normalization metrics
    const unitsMetrics = this.getOperationSummary('units_normalization');
    if (unitsMetrics.operation_duration) {
      dashboard.units_normalization.total_operations = unitsMetrics.operation_duration.count;
      dashboard.units_normalization.avg_duration = unitsMetrics.operation_duration.avg;
    }
    
    dashboard.units_normalization.success_rate = this.getSuccessRate('units_normalization');
    
    // Calculate fuzzy success rate for units
    const fuzzySuccessKey = this._buildKey('operation_result', { operation: 'units_normalization', success: true });
    const fuzzySuccessCount = this.metrics.get(fuzzySuccessKey)?.count || 0;
    const totalUnitsOps = dashboard.units_normalization.total_operations;
    dashboard.units_normalization.fuzzy_success_rate = totalUnitsOps > 0 ? fuzzySuccessCount / totalUnitsOps : 0;
    
    dashboard.units_normalization.performance_score = this._calculatePerformanceScore(
      dashboard.units_normalization.success_rate, 
      unitsMetrics.operation_duration?.avg || 0, 
      50 // target duration ms
    );

    // Process context rewrite metrics
    const contextRewriteMetrics = this.getOperationSummary('context_rewrite');
    if (contextRewriteMetrics.operation_duration) {
      dashboard.context_rewrite.total_operations = contextRewriteMetrics.operation_duration.count;
      dashboard.context_rewrite.avg_duration = contextRewriteMetrics.operation_duration.avg;
    }
    dashboard.context_rewrite.success_rate = this.getSuccessRate('context_rewrite');
    
    dashboard.context_rewrite.performance_score = this._calculatePerformanceScore(
      dashboard.context_rewrite.success_rate, 
      contextRewriteMetrics.operation_duration?.avg || 0, 
      100 // target duration ms
    );

    // Process fuzzy matching metrics
    const fuzzyMetrics = this.getOperationSummary('fuzzy_matching');
    if (fuzzyMetrics.operation_result) {
      dashboard.fuzzy_matching.total_operations = fuzzyMetrics.operation_result.count;
    }
    dashboard.fuzzy_matching.success_rate = this.getSuccessRate('fuzzy_matching');
    
    dashboard.fuzzy_matching.performance_score = this._calculatePerformanceScore(
      dashboard.fuzzy_matching.success_rate, 
      0, // no duration tracking for fuzzy matching
      0
    );

    return dashboard;
  }

  /**
   * Calculate performance score based on success rate and duration
   * @param {number} successRate - Success rate (0-1)
   * @param {number} avgDuration - Average duration in ms
   * @param {number} targetDuration - Target duration in ms
   * @returns {number} Performance score (0-100)
   */
  _calculatePerformanceScore(successRate, avgDuration, targetDuration) {
    const successScore = successRate * 70; // 70% weight for success rate
    const durationScore = targetDuration > 0 ? Math.max(0, 30 * (1 - avgDuration / targetDuration)) : 30;
    return Math.round(successScore + durationScore);
  }

  /**
   * Get detailed performance metrics for a specific operation
   * @param {string} operation - Operation name
   * @returns {Object} Detailed performance metrics
   */
  getPerformanceMetrics(operation) {
    const summary = this.getOperationSummary(operation);
    const successRate = this.getSuccessRate(operation);
    
    return {
      operation,
      success_rate: successRate,
      total_operations: summary.operation_duration?.count || 0,
      avg_duration: summary.operation_duration?.avg || 0,
      min_duration: summary.operation_duration?.min || 0,
      max_duration: summary.operation_duration?.max || 0,
      performance_score: this._calculatePerformanceScore(
        successRate, 
        summary.operation_duration?.avg || 0, 
        operation === 'units_normalization' ? 50 : 100
      ),
      metrics: summary
    };
  }
}

// Global metrics instance
export const metrics = new MetricsCollector();

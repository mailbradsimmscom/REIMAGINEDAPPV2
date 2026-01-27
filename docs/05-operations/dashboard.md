# System Dashboard

## Overview

The System Dashboard provides administrators with a high-level view of BoatOS health, metrics, and system status. It aggregates data from request metrics, fuzzy matching operations, and system health indicators.

**Who uses it:** Administrators, developers
**Access:** `/admin.htm` (requires admin token for API calls)

---

## User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Navigate to /admin.htm                                      │
│     └── HTML served from src/public/admin.htm                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Dashboard fetches metrics via AJAX                          │
│     └── GET /admin/api/metrics                                  │
│     └── GET /admin/api/health                                   │
│     └── Headers: x-admin-token: <token>                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. View aggregated metrics                                     │
│     ├── Chat Health (requests, latency, errors)                 │
│     ├── Fuzzy Matching (maintenance, units, context)            │
│     ├── System Health (uptime, memory)                          │
│     └── Recent Errors                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  admin.htm (Browser)                                            │
│  └── adminDashboard.js → fetchMetrics()                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                    x-admin-token header
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  /admin/api/metrics                                             │
│  └── metrics.route.js                                           │
│      ├── getRequestMetrics(timeframe)  ← requestLogging.js      │
│      ├── metricsUtils.getDashboardMetrics()  ← metrics.js       │
│      └── process.uptime(), process.memoryUsage()                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Data Sources                                                   │
│  ├── In-memory request buffer (requestLogging.js)               │
│  ├── In-memory metrics store (metrics.js)                       │
│  └── Node.js process stats                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Metrics Route

**File:** `src/routes/admin/metrics.route.js`

### GET /admin/api/metrics - Main Metrics Endpoint

```javascript
// src/routes/admin/metrics.route.js:27-149
router.get('/',
  validate(adminMetricsQuerySchema, 'query'),
  async (req, res, next) => {
  try {
    const requestLogger = logger.createRequestLogger();
    const { timeframe = '15m', limit = 100 } = req.query;

    // Get real request metrics
    const requestMetrics = getRequestMetrics(timeframe);

    // Get fuzzy matching and context rewrite metrics
    const dashboardMetrics = metricsUtils.getDashboardMetrics();

    const metricsData = {
      timeframe,
      windowStart: requestMetrics.windowStart,
      windowEnd: requestMetrics.windowEnd,

      // Chat Health Metrics (from real request data)
      chatHealth: {
        totalRequests: requestMetrics.totalRequests,
        requestsPerMinute: requestMetrics.requestsPerMinute,
        p95Latency: requestMetrics.p95Latency,
        errorRate: requestMetrics.errorRate,
        errorCount: requestMetrics.errorCount,
        successCount: requestMetrics.successCount
      },

      // Fuzzy Matching & Context Rewrite Metrics
      fuzzyMatching: {
        maintenanceDetection: {
          totalOperations: dashboardMetrics.maintenance_detection.total_questions,
          successRate: dashboardMetrics.maintenance_detection.success_rate,
          avgDuration: dashboardMetrics.maintenance_detection.avg_duration,
          performanceScore: dashboardMetrics.maintenance_detection.performance_score,
          fuzzyMatches: dashboardMetrics.maintenance_detection.fuzzy_matches,
          exactMatches: dashboardMetrics.maintenance_detection.exact_matches
        },
        unitsNormalization: {
          totalOperations: dashboardMetrics.units_normalization.total_operations,
          successRate: dashboardMetrics.units_normalization.success_rate,
          avgDuration: dashboardMetrics.units_normalization.avg_duration,
          performanceScore: dashboardMetrics.units_normalization.performance_score,
          fuzzySuccessRate: dashboardMetrics.units_normalization.fuzzy_success_rate
        },
        contextRewrite: {
          totalOperations: dashboardMetrics.context_rewrite.total_operations,
          successRate: dashboardMetrics.context_rewrite.success_rate,
          avgDuration: dashboardMetrics.context_rewrite.avg_duration,
          performanceScore: dashboardMetrics.context_rewrite.performance_score || 0
        },
        overall: {
          totalOperations: dashboardMetrics.fuzzy_matching.total_operations,
          successRate: dashboardMetrics.fuzzy_matching.success_rate,
          performanceScore: dashboardMetrics.fuzzy_matching.performance_score,
          typoCorrections: dashboardMetrics.fuzzy_matching.typo_corrections
        }
      },

      // System Health
      systemHealth: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        environment: getEnv().NODE_ENV
      },

      // Recent Errors (from real request data)
      recentErrors: requestMetrics.recentErrors,

      lastUpdated: new Date().toISOString(),
      dataSource: requestMetrics.dataSource
    };

    return res.json({ success: true, data: metricsData });
  } catch (error) {
    next(error);
  }
});
```

### Query Schema Validation

```javascript
// src/routes/admin/metrics.route.js:22-25
const adminMetricsQuerySchema = z.object({
  timeframe: z.enum(['5m', '15m', '1h', '24h']).default('15m'),
  limit: z.coerce.number().int().min(1).max(1000).default(100)
}).passthrough();
```

### GET /admin/api/metrics/fuzzy - Detailed Fuzzy Metrics

```javascript
// src/routes/admin/metrics.route.js:151-200
router.get('/fuzzy', async (req, res, next) => {
  try {
    const requestLogger = logger.createRequestLogger();

    // Get detailed fuzzy matching metrics
    const dashboardMetrics = metricsUtils.getDashboardMetrics();
    const allMetrics = metricsUtils.getMetrics();

    // Get performance metrics for each operation
    const maintenancePerformance = metricsUtils.getPerformanceMetrics('maintenance_detection');
    const unitsPerformance = metricsUtils.getPerformanceMetrics('units_normalization');
    const contextRewritePerformance = metricsUtils.getPerformanceMetrics('context_rewrite');

    const fuzzyMetrics = {
      summary: {
        maintenanceDetection: dashboardMetrics.maintenance_detection,
        unitsNormalization: dashboardMetrics.units_normalization,
        contextRewrite: dashboardMetrics.context_rewrite,
        overall: dashboardMetrics.fuzzy_matching
      },
      performance: {
        maintenanceDetection: maintenancePerformance,
        unitsNormalization: unitsPerformance,
        contextRewrite: contextRewritePerformance
      },
      raw: {
        totalMetrics: Object.keys(allMetrics).length,
        metricCategories: [...new Set(Object.keys(allMetrics).map(k => k.split('&')[0]))],
        lastUpdated: new Date().toISOString()
      }
    };

    return res.json({ success: true, data: fuzzyMetrics });
  } catch (error) {
    next(error);
  }
});
```

---

## MetricsCollector Class

**File:** `src/utils/metrics.js`

### Class Structure

```javascript
// src/utils/metrics.js:8-13
export class MetricsCollector {
  constructor() {
    this.metrics = new Map();
    this.startTimes = new Map();
    this.requestCounts = new Map();
  }
}
```

### Timer Methods

```javascript
// src/utils/metrics.js:20-45
startTimer(operation, tags = {}) {
  const key = this._buildKey(operation, tags);
  this.startTimes.set(key, Date.now());
}

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
```

### Record Metric

```javascript
// src/utils/metrics.js:53-76
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
```

### Increment Counter

```javascript
// src/utils/metrics.js:84-89
incrementCounter(name, tags = {}, increment = 1) {
  const key = this._buildKey(name, tags);
  const existing = this.metrics.get(key) || { count: 0 };
  existing.count += increment;
  this.metrics.set(key, existing);
}
```

### Success Rate Calculation

```javascript
// src/utils/metrics.js:142-151
getSuccessRate(operation) {
  const successKey = this._buildKey('operation_result', { operation, success: true });
  const failureKey = this._buildKey('operation_result', { operation, success: false });

  const successCount = this.metrics.get(successKey)?.count || 0;
  const failureCount = this.metrics.get(failureKey)?.count || 0;
  const total = successCount + failureCount;

  return total > 0 ? successCount / total : 0;
}
```

### Dashboard Metrics Aggregation

```javascript
// src/utils/metrics.js:181-279
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

  // ... similar processing for other metrics

  return dashboard;
}
```

### Performance Score Calculation

```javascript
// src/utils/metrics.js:288-292
_calculatePerformanceScore(successRate, avgDuration, targetDuration) {
  const successScore = successRate * 70; // 70% weight for success rate
  const durationScore = targetDuration > 0 ? Math.max(0, 30 * (1 - avgDuration / targetDuration)) : 30;
  return Math.round(successScore + durationScore);
}
```

### Key Building

```javascript
// src/utils/metrics.js:168-175
_buildKey(name, tags) {
  const tagString = Object.entries(tags)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return tagString ? `${name}&${tagString}` : name;
}
```

---

## Key Metrics

### Chat Health Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `totalRequests` | number | Total requests in timeframe |
| `requestsPerMinute` | number | Request rate |
| `p95Latency` | number | 95th percentile response time (ms) |
| `errorRate` | number | Error percentage (0-1) |
| `errorCount` | number | Total errors |
| `successCount` | number | Total successes |

### Fuzzy Matching Metrics

| Category | Metrics |
|----------|---------|
| **maintenanceDetection** | totalOperations, successRate, avgDuration, performanceScore, fuzzyMatches, exactMatches |
| **unitsNormalization** | totalOperations, successRate, avgDuration, performanceScore, fuzzySuccessRate |
| **contextRewrite** | totalOperations, successRate, avgDuration, performanceScore |
| **overall** | totalOperations, successRate, performanceScore, typoCorrections |

### System Health Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `uptime` | number | Process uptime in seconds |
| `memoryUsage.heapUsed` | number | Heap memory used (bytes) |
| `memoryUsage.heapTotal` | number | Total heap (bytes) |
| `memoryUsage.rss` | number | Resident set size (bytes) |
| `environment` | string | NODE_ENV value |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/metrics` | Aggregated system metrics |
| GET | `/admin/api/metrics/fuzzy` | Detailed fuzzy matching metrics |
| GET | `/admin/api/health` | Detailed health check |
| GET | `/admin/api/health/connectivity` | External service connectivity |

### Query Parameters (GET /admin/api/metrics)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `timeframe` | string | `15m` | Window: `5m`, `15m`, `1h`, `24h` |
| `limit` | number | `100` | Max records (1-1000) |

---

## Files & Locations

| Purpose | Path |
|---------|------|
| **Frontend** | |
| Dashboard HTML | `src/public/admin.htm` |
| Dashboard JS | `src/public/js/admin/*.js` |
| Dashboard section | `src/public/js/admin/sections/dashboard.js` |
| Metrics section | `src/public/js/admin/sections/metrics.js` |
| **Backend** | |
| Metrics route | `src/routes/admin/metrics.route.js` |
| Health route | `src/routes/admin/health.route.js` |
| Dashboard route | `src/routes/admin/dashboard.route.js` |
| Metrics utility | `src/utils/metrics.js` |
| Request metrics | `src/middleware/requestLogging.js` |

---

## Usage Example

### Recording Metrics in Code

```javascript
import { metrics } from '../utils/metrics.js';

// Start a timer
metrics.startTimer('maintenance_detection');

// ... do work ...

// End timer (automatically records duration)
const duration = metrics.endTimer('maintenance_detection');

// Record success/failure
metrics.recordSuccess('maintenance_detection', true, { fuzzyMatch: true });

// Increment a counter
metrics.incrementCounter('typo_corrections');

// Record a specific metric
metrics.recordMetric('confidence_score', 0.85, { operation: 'fuzzy_matching' });

// Get dashboard metrics
const dashboardMetrics = metrics.getDashboardMetrics();
```

### Response Format

```json
{
  "success": true,
  "data": {
    "timeframe": "15m",
    "windowStart": "2025-01-15T10:00:00Z",
    "windowEnd": "2025-01-15T10:15:00Z",
    "chatHealth": {
      "totalRequests": 150,
      "requestsPerMinute": 10,
      "p95Latency": 1250,
      "errorRate": 0.02,
      "errorCount": 3,
      "successCount": 147
    },
    "fuzzyMatching": {
      "maintenanceDetection": {
        "totalOperations": 45,
        "successRate": 0.93,
        "avgDuration": 85,
        "performanceScore": 78,
        "fuzzyMatches": 12,
        "exactMatches": 30
      },
      "unitsNormalization": {
        "totalOperations": 120,
        "successRate": 0.98,
        "avgDuration": 25,
        "performanceScore": 92,
        "fuzzySuccessRate": 0.95
      },
      "contextRewrite": {
        "totalOperations": 80,
        "successRate": 0.96,
        "avgDuration": 45,
        "performanceScore": 85
      },
      "overall": {
        "totalOperations": 245,
        "successRate": 0.95,
        "performanceScore": 85,
        "typoCorrections": 8
      }
    },
    "systemHealth": {
      "uptime": 86400,
      "memoryUsage": {
        "heapUsed": 125000000,
        "heapTotal": 200000000,
        "rss": 250000000
      },
      "environment": "production"
    },
    "recentErrors": [
      {
        "timestamp": "2025-01-15T10:14:30Z",
        "path": "/chat/enhanced/process",
        "status": 500,
        "message": "OpenAI timeout"
      }
    ],
    "lastUpdated": "2025-01-15T10:15:00Z"
  }
}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_TOKEN` | - | Required for API access |
| `NODE_ENV` | `development` | Shown in system health |

---

## Testing

| Test File | What It Tests |
|-----------|---------------|
| `tests/smoke/route-map.test.js` | Dashboard routes exist |
| `tests/integration/monitoring.test.js` | Metrics API |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Dashboard is public" | **No.** API calls require admin token |
| "Real-time updates" | **No.** Manual refresh (no WebSocket) |
| "Persisted metrics" | **No.** In-memory only, resets on restart |
| "External monitoring" | **No.** No Datadog/NewRelic integration |
| "Historical data" | **No.** Only current timeframe window |

---

## Related Docs

- [logging.md](./logging.md) - Log viewer
- [monitoring.md](./monitoring.md) - Telemetry details
- [routes-variables.md](../00-foundations/routes-variables.md) - All admin routes
- [Testing](../20-admin-tools/testing.md) - Test coverage

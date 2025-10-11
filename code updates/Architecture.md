# REIMAGINEDAPPV2 – System Architecture (Current)

> Generated from the uploaded `review-pack` and `code updates` memos.

## 1. Overview & Purpose
This document maps the live backend architecture: runtime flow, layer boundaries, major modules, and recent changes. It’s intended as the source-of-truth for future Mintlify `.mdx` documentation.

## 2. System Entry Points
- **Landing page**: `GET /landing` (temporary catch-all)
- **Runtime**: `src/start.js` → `src/index.js` → `src/app.js`

### 2.1 start.js (bootstrap & process wiring)
`src/start.js`

```javascript
// src/start.js
import 'dotenv/config';
import app from './index.js';
import { getEnv } from './config/env.js';
import { logger } from './utils/logger.js';
import { printRoutes } from './debug/printRoutes.js';

function getPort() {
  const { PORT } = getEnv({ loose: true });
  const port = Number(PORT) || 3000;
  return Number.isFinite(port) ? port : 3000;
}

const port = getPort();

// Print routes after all routers are mounted
printRoutes(app, logger);

const server = app.listen(port, () => {
  logger.info(`Server listening on http://localhost:${port}`);
  // Also print routes after listen to confirm final state
  printRoutes(app, logger);
});

// Never call process.exit() here.
// Let the global error handler handle unexpected exceptions.
process.on('unhandledRejection', (err) => {
  logger.error('unhandledRejection', { message: err?.message });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { message: err?.message });
});

export default server;
```

### 2.2 index.js (server init)
`src/index.js`

```javascript
// src/index.js
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import app from './app.js';
import { logger } from './utils/logger.js';

import { securityHeaders, basicRateLimit } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { adminGate } from './middleware/admin.js';
import { trace404 } from './middleware/trace404.js';

// Routers
import healthRouter from './routes/health.router.js';
import systemsRouter from './routes/systems.router.js';
import systemManagementRouter from './routes/system-management.route.js';
import chatRouter from './routes/chat/index.js';
import documentRouter from './routes/document/index.js';
import pineconeRouter from './routes/pinecone.router.js';
import adminRouter from './routes/admin/index.js';
import pineconeAdminRouter from './routes/admin/pinecone-admin.route.js';
import testNormalizerRouter from './routes/test-normalizer.route.js';
// import langGraphTestRouter from './routes/langgraph-test.route.js'; // Temporarily disabled

import pineconeRepository from './repositories/pinecone.repository.js';
import { attachConfigInspector } from './debug/config.js';
import { attachRouteDebugger } from './debug/routes.js';
import { ensureLexicons } from './startup/configGuard.service.js';

// Ensure critical lexicon files exist at startup
ensureLexicons().catch(err => {
  logger.warn('Config guard failed (non-fatal)', { error: err.message });
});

// Safe mount function to identify failing routers
function safeMount(base, router) {
  try {
    app.use(base, router);
    logger.debug('mounted', { base }); 
  }
  catch (e) { 
    logger.error('MOUNT_FAILED', { base, error: e.message }); 
    throw e; 
  }
}

// --- global headers / rate limit (keep these light; helmet is already in app.js) ---
app.use(securityHeaders);
app.use(basicRateLimit);

// Log namespace choice on startup (dev only)
pineconeRepository.logNamespaceChoiceOnce().catch(err => {
  logger.warn('Failed to log namespace choice', { error: err.message });
});

// Attach config inspector (dev only)
attachConfigInspector(app);

// --- mount routers ---
safeMount('/healt
...
```

### 2.3 app.js (Express app & middleware wiring)
`src/app.js`

```javascript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { logger } from './utils/logger.js';
import { getEnv } from './config/env.js';
import adminRouter from './routes/admin/index.js';

// Create Express app
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for development
  crossOriginEmbedderPolicy: false // Disable COEP for development
}));

// CORS configuration - environment-based origin allowlist
const env = getEnv();
const allowedOrigins = env.NODE_ENV === 'production'
  ? ['https://your-production-domain.com']  // TODO: Update with actual production domain before deploying
  : true;  // Development: allow all origins for local testing

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Body parsing middleware with size limits
app.use(express.json({ 
  limit: '2mb' // 2MB limit for JSON payloads
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '2mb' 
}));

// Request logging middleware
import { requestLoggingMiddleware } from './middleware/requestLogging.js';
app.use(requestLoggingMiddleware);

// Static file serving
app.get('/styles.css', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/styles.css'));
    res.setHeader('content-type', 'text/css');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'File not found' });
  }
});

app.get('/app.js', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/app.js'));
    res.setHeader('content-type', 'text/javascript');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'File not found' });
  }
});

app.get('/', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/index.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'index.html not found' });
  }
});

app.get('/index.html', async (req, res) => {
  try {
    const content = a
...
```

## 3. Layered Architecture
- **Routes** → **Services** → **Repositories** → **Clients**
- **Middleware** wraps request lifecycle (security, validation, logging, error handling)
- **Utils & Config** provide shared helpers (normalization, fuzzy matching, env)

### 3.x security
`src/middleware/security.js`

```javascript
import { logger } from '../utils/logger.js';

/**
 * Security middleware - adds essential security headers
 * Equivalent to Helmet.js but lightweight and customized
 */
export function securityHeaders(req, res, next) {
  const requestLogger = req.requestLogger || logger.createRequestLogger();
  
  // Content Security Policy - restrict resource loading
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self'; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none';"
  );
  
  // X-Frame-Options - prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // X-Content-Type-Options - prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // X-XSS-Protection - enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer Policy - control referrer information
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions Policy - control browser features
  res.setHeader('Permissions-Policy', 
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  
  // Remove X-Powered-By header
  res.removeHeader('X-Powered-By');
  
  requestLogger.debug('Security headers applied', { url: req.url });
  next();
}

/**
 * Rate limiting middleware (basic implementation)
 * In production, consider using express-rate-limit
 */
export function basicRateLimit(req, res, next) {
  const requestLogger = req.requestLogger || logger.createRequestLogger();
  
  // Simple rate limiting - track requests per IP
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 1000; // 1000 requests per window
  
  // Initialize rate limit tracking if not exists
  if (!req.app.locals.rateLimit) {
    req.app.locals.rateLimit = new Map();
  }
  
  const rateLimit = req.app.locals.rateLimit;
  const clientData = rateLimit.get(clientIP) || { count: 0, resetTime: now + windowMs };
  
  // Reset if window has passed
  if (now > clientData.res
...
```

### 3.x validate
`src/middleware/validate.js`

```javascript
// src/middleware/validate.js
export function validate({ body }) {
  return (req, res, next) => {
    if (body) {
      const result = body.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      req.body = result.data;
    }
    next();
  };
}
```

### 3.x admin
`src/middleware/admin.js`

```javascript
import crypto from 'node:crypto';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ERR } from '../constants/errorCodes.js';

function readAdminToken(req) {
  const h = req.headers;
  const x = h['x-admin-token'];
  const auth = h['authorization'];
  if (x && typeof x === 'string') return x.trim();
  if (auth && typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

function mask(token) {
  if (!token) return 'not-set';
  if (token.length <= 8) return `${'*'.repeat(Math.max(0, token.length - 2))}${token.slice(-2)}`;
  return `${token.slice(0,4)}…${token.slice(-4)}`;
}

function tokenHash(token) {
  return token ? crypto.createHash('sha256').update(token).digest('hex').slice(0,12) : 'none';
}

export function adminGate(req, res, next) {
  const env = getEnv({ loose: true });
  const expected = env.ADMIN_TOKEN;
  const supplied = readAdminToken(req);

  if (!expected) {
    return res.status(401).json({ 
      success: false, 
      data: null, 
      error: { code: ERR.ADMIN_DISABLED, message: 'Admin token not configured' },
      requestId: res.locals?.requestId ?? null,
    });
  }
  if (!supplied) {
    logger.info('Admin auth: missing token');
    return res.status(401).json({ 
      success: false, 
      data: null, 
      error: { code: ERR.UNAUTHORIZED, message: 'Admin token required' },
      requestId: res.locals?.requestId ?? null,
    });
  }
  if (supplied !== expected) {
    logger.warn('Admin auth: bad token', { supplied: mask(supplied), supplied_sha: tokenHash(supplied) });
    return res.status(403).json({ 
      success: false, 
      data: null, 
      error: { code: ERR.FORBIDDEN, message: 'Invalid admin token' },
      requestId: res.locals?.requestId ?? null,
    });
  }

  // success — don't log the raw token (debug level to reduce noise)
  logger.debug('Admin auth: ok', { supplied_sha: tokenHash(supplied) });
  return next();
}

// Alias for compliance script
export const adminOnly = adminGate;

/**
 * Optional admin gate - only checks if token is provided
 * Useful for routes that can work with or without admin access
 */
...
```

### 3.x validateResponse
`src/middleware/validateResponse.js`

```javascript
// src/middleware/validateResponse.js
import { ENV } from '../config/env.js';

export const validateResponse = (schema) => (req, res, next) => {
  // Only gate when flag is on (RESPONSE_VALIDATE=1 in CI)
  if (ENV.RESPONSE_VALIDATE !== '1') return next();

  const origJson = res.json.bind(res);

  res.json = (payload) => {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const err = new Error('Response schema validation failed');
      err.status = 500;
      err.code = 'RESPONSE_SCHEMA_MISMATCH';
      err.details = parsed.error.format();
      throw err;
    }
    return origJson(payload);
  };

  next();
};
```

### 3.x error
`src/middleware/error.js`

```javascript
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { ERR } from '../constants/errorCodes.js';

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  
  const requestLogger = req.requestLogger || logger.createRequestLogger();
  
  // Handle Zod validation errors
  if (err instanceof z.ZodError) {
    // Enhanced context logging for validation errors
    const context = {
      url: req.url,
      method: req.method,
      issues: err.issues,
      requestBody: req.body ? JSON.stringify(req.body).substring(0, 500) : null,
      queryParams: req.query,
      userAgent: req.get('user-agent')
    };

    requestLogger.warn('Validation error', context);

    return res.status(400).json({
      success: false,
      data: null,
      error: {
        code: ERR.BAD_REQUEST,
        message: 'Validation failed',
        details: err.issues
      },
      requestId: res.locals?.requestId ?? null,
    });
  }
  
  // Handle service guard errors (return 503 Service Unavailable)
  if (err.code === ERR.SUPABASE_DISABLED || 
      err.code === ERR.PINECONE_DISABLED || 
      err.code === ERR.OPENAI_DISABLED || 
      err.code === ERR.SIDECAR_DISABLED) {
    
    requestLogger.warn('Service unavailable', { 
      service: err.code,
      message: err.message,
      url: req.url,
      method: req.method
    });
    
    return res.status(503).json({
      success: false,
      data: null,
      error: { 
        code: err.code, 
        message: err.message || 'Service temporarily unavailable',
        details: { service: err.code.replace('_DISABLED', '').toLowerCase() }
      },
      requestId: res.locals?.requestId ?? null,
    });
  }
  
  // Handle other errors
  const status = Number(err.status) || 500;
  const code = err.code || (status === 400 ? ERR.BAD_REQUEST : ERR.INTERNAL);
  const message = err.message || (status === 400 ? 'Validation failed' : 'Unexpected error');

  if (status >= 500) {
    // Enhanced error context logging
    const errorContext = {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
      userAgent: req.get('user-agent'),
      request
...
```

### 3.x methodNotAllowed
`src/middleware/methodNotAllowed.js`

```javascript
import { logger } from '../utils/logger.js';

/**
 * Middleware to handle method not allowed (405) responses
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export function methodNotAllowed(req, res, next) {
  const requestLogger = req.requestLogger || logger.createRequestLogger();
  
  // DEBUG: Add methodNotAllowed tracing
  requestLogger.info('🔍 [METHOD_NOT_ALLOWED]', { 
    method: req.method, 
    originalUrl: req.originalUrl, 
    url: req.url, 
    allowedMethods: req.route?.methods || [] 
  });
  
  requestLogger.warn('Method not allowed', {
    method: req.method,
    url: req.url,
    allowedMethods: req.route?.methods || []
  });
  
  return res.status(405).json({
    success: false,
    data: null,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} method not allowed for ${req.url}`
    }
  });
}
```

### 3.x trace404
`src/middleware/trace404.js`

```javascript
import { logger } from '../utils/logger.js';
import { ENV } from '../config/env.js';

export function trace404(req, _res, next) {
  if (ENV.NODE_ENV === 'production') return next();
  logger.createRequestLogger().warn('404 trace', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    routeBases: ['/health','/systems','/chat','/chat/enhanced','/document','/admin/docs','/pinecone'],
  });
  next();
}
```

### 3.x Route – jobs.route
`src/routes/admin/jobs.route.js`

```javascript
/**
 * Admin jobs management route
 * Provides manual job processing triggers for testing and debugging
 */

import { Router } from 'express';
import { logger } from '../../utils/logger.js';
import documentService from '../../services/document.service.js';
import documentRepository from '../../repositories/document.repository.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { EnvelopeSchema } from '../../schemas/envelope.schema.js';

const router = Router();
const log = logger.createRequestLogger();

// Add validateResponse middleware
router.use(validateResponse(EnvelopeSchema));

/**
 * GET /admin/jobs
 * List all jobs
 */
router.get('/', async (req, res, next) => {
  try {
    const { limit = 50, offset = 0, status } = req.query;
    
    const jobs = await documentRepository.getJobsByStatus(status, Number(limit), Number(offset));
    
    res.json({
      success: true,
      data: {
        jobs: jobs.map(job => ({
          job_id: job.job_id,
          doc_id: job.doc_id,
          status: job.status,
          created_at: job.created_at,
          updated_at: job.updated_at,
          storage_path: job.storage_path
        })),
        count: jobs.length,
        limit: Number(limit),
        offset: Number(offset)
      }
    });
    
  } catch (error) {
    log.error('Failed to list jobs', { error: error.message });
    next(error);
  }
});

/**
 * POST /admin/jobs/process-next
 * Manually trigger processing of the next queued job
 */
router.post('/process-next', async (req, res, next) => {
  try {
    log.info('Manual job processing triggered');

    // Get the next job stuck in parsing or queued (failed jobs that need retry)
    const queuedJobs = await documentRepository.getJobsByStatus('parsing', 1);

    if (queuedJobs.length === 0) {
      return res.json({
        success: true,
        data: {
          message: 'No jobs found for reprocessing',
          processed: false
        }
      });
    }

    const job = queuedJobs[0];
    log.info('Processing job manually', { jobId: job.job_id, docId: job.doc_id });

    // Process the job using document service
    await documentService.processJob(job.job_id);
    
...
```

### 3.x Route – jobs.route
`src/routes/document/jobs.route.js`

```javascript
import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { DocumentJobsEnvelope } from '../../schemas/document.schema.js';
import { 
  documentJobsQuerySchema, 
  documentJobsResponseSchema,
  documentGetQuerySchema,
  documentGetResponseSchema
} from '../../schemas/document.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// Apply response validation to all routes in this file
router.use(validateResponse(DocumentJobsEnvelope));

// GET /admin/docs/jobs - List jobs
router.get('/', 
  validate(documentJobsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { limit, offset, status } = req.query;
      
      const jobs = await documentService.listJobs(limit, offset, status);
      
      const envelope = {
        success: true,
        data: {
          jobs,
          count: jobs.length,
          limit,
          offset
        }
      };

      return res.json(envelope);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
```

### 3.1 Repositories (DB/External IO)
Repositories isolate persistence and external calls.

- `src/repositories/supabaseClient.js`

```javascript
// src/repositories/supabaseClient.js
import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';

let supabase = null;
let hasLoggedConfig = false;

async function getSupabaseConfig() {
  // Import env synchronously for lazy loading
  const { getEnv } = await import('../config/env.js');
  const env = getEnv();
  return {
    url: env.SUPABASE_URL,
    key:
      env.PY_SUPABASE_SERVICE_KEY ||  // Use same key as Python first
      env.SUPABASE_SERVICE_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_SERVICE_ROLE ||
      env.SERVICE_ROLE_KEY ||
      env.SUPABASE_ANON_KEY,
  };
}

export async function getSupabaseClient() {
  if (supabase) return supabase;

  const { url, key } = await getSupabaseConfig();
  if (!url || !key) {
    if (!hasLoggedConfig) {
      logger.warn('Supabase disabled: missing SUPABASE_URL or service/anon key.', {
        hasUrl: !!url,
        hasKey: !!key,
      });
      hasLoggedConfig = true;
    }
    return null; // graceful degradation
  }

  supabase = createClient(url, key);

  // Log once on first real init
  if (!hasLoggedConfig) {
    logger.info('🔑 Supabase client initialized', {
      supabaseUrlPrefix: url.split('//')[1]?.split('.')[0],
      hasServiceKey: !!key,
      keyPrefix: key?.substring(0, 20) + '...',
      keyType: key?.startsWith('eyJ') ? 'JWT' : key?.startsWith('sb_') ? 'SERVICE' : 'OTHER'
    });
    hasLoggedConfig = true;
  }

  return supabase;
}

// Convenience, if you want explicit storage access without extra clients:
export async function getSupabaseStorage() {
  const client = await getSupabaseClient();
  return client?.storage ?? null;
}

/** 👇 compat shim for older code */
export async function getSupabaseStorageClient() {
  return await getSupabaseClient();
}

// Prefer named exports; if you want a default, export the **getter**, not the instance:
export default getSupabaseClient;
```

- `src/repositories/systems.repository.js`

```javascript
import { getSupabaseClient } from './supabaseClient.js';
import { isSupabaseConfigured } from '../services/guards/index.js';

const TABLE = 'systems';

// Helper function to check if Supabase is available
async function checkSupabaseAvailability() {
  if (!isSupabaseConfigured()) {
    const error = new Error('Supabase not configured');
    error.code = 'SUPABASE_DISABLED';
    throw error;
  }
  
  const supabase = await getSupabaseClient();
  if (!supabase) {
    const error = new Error('Supabase client not available');
    error.code = 'SUPABASE_DISABLED';
    throw error;
  }
  
  return supabase;
}

export async function listSystems({ limit = 25, cursor } = {}) {
  const supabase = await checkSupabaseAvailability();
  let query = supabase.from(TABLE).select('*').order('asset_uid', { ascending: true }).limit(limit);
  if (cursor) {
    query = query.gt('asset_uid', cursor);
  }
  const { data, error } = await query;
  if (error) {
    const err = new Error(`Failed to list systems: ${error.message}`);
    err.cause = error;
    err.context = { operation: 'list', limit, cursor, table: TABLE };
    throw err;
  }
  return data ?? [];
}

export async function getSystemByAssetUid(assetUid) {
  const supabase = await checkSupabaseAvailability();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('asset_uid', assetUid)
    .limit(1)
    .single();
  if (error) {
    const err = new Error(`Failed to get system: ${error.message}`);
    err.cause = error;
    err.context = { operation: 'get_by_asset_uid', assetUid, table: TABLE };
    throw err;
  }
  return data ?? null;
}

export async function searchSystems(query, { limit = 10 } = {}) {
  const supabase = await checkSupabaseAvailability();
  
  try {
    const { data, error } = await supabase.rpc('search_systems', { q: query, top_n: limit });
    
    if (error) {
      const err = new Error(`RPC search_systems failed: ${error.message}`);
      err.cause = error;
      err.context = { 
        operation: 'search_rpc', 
        query, 
        limit, 
        rpcFunction: 'search_systems',
        table: TABLE 
      };
      throw err;
    }
    
    // Validate RPC response structur
...
```

- `src/repositories/system-management.repository.js`

```javascript
import { getSupabaseClient } from './supabaseClient.js';
import { logger } from '../utils/logger.js';

/**
 * System Management Repository
 *
 * All database operations for system management feature.
 * Follows cursor rules: ALL DB/storage/network I/O goes here.
 */

/**
 * Get distinct manufacturers from systems table
 * @returns {Promise<Array<string>>} Array of manufacturer names
 */
export async function getManufacturers() {
  const supabase = await getSupabaseClient();
  const requestLogger = logger.createRequestLogger();

  try {
    const { data, error } = await supabase
      .from('systems')
      .select('manufacturer_norm')
      .not('manufacturer_norm', 'is', null)
      .order('manufacturer_norm');

    if (error) throw error;

    // Get unique manufacturers
    const manufacturers = [...new Set(data.map(row => row.manufacturer_norm))];
    return manufacturers.sort();

  } catch (error) {
    requestLogger.error('Repository error fetching manufacturers', { error: error.message });
    throw error;
  }
}

/**
 * Get models for a specific manufacturer
 * @param {string} manufacturer - Manufacturer name
 * @returns {Promise<Array<string>>} Array of model names
 */
export async function getModelsByManufacturer(manufacturer) {
  const supabase = await getSupabaseClient();
  const requestLogger = logger.createRequestLogger();

  try {
    const { data, error } = await supabase
      .from('systems')
      .select('model_norm')
      .eq('manufacturer_norm', manufacturer)
      .not('model_norm', 'is', null)
      .order('model_norm');

    if (error) throw error;

    const models = [...new Set(data.map(row => row.model_norm))];
    return models.sort();

  } catch (error) {
    requestLogger.error('Repository error fetching models', {
      error: error.message,
      manufacturer
    });
    throw error;
  }
}

/**
 * Search for system by manufacturer and model
 * @param {string} manufacturer - Manufacturer name
 * @param {string} model - Model name
 * @returns {Promise<Array<Object>>} Array of system records
 */
export async function findSystemByManufacturerModel(manufacturer, model) {
  const supabase = await getSupabaseClient();
  const requestLog
...
```

- `src/repositories/document.repository.js`

```javascript
import { getSupabaseClient } from './supabaseClient.js';
import { logger } from '../utils/logger.js';
import { isSupabaseConfigured } from '../services/guards/index.js';

class DocumentRepository {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  // Helper method to check if Supabase is available
  async checkSupabaseAvailability() {
    if (!isSupabaseConfigured()) {
      const error = new Error('Supabase not configured');
      error.code = 'SUPABASE_DISABLED';
      throw error;
    }
    
    const supabase = await getSupabaseClient();
    if (!supabase) {
      const error = new Error('Supabase client not available');
      error.code = 'SUPABASE_DISABLED';
      throw error;
    }
    
    return supabase;
  }

  // Job Management
  async createJob(jobData) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('jobs')
        .insert([jobData])
        .select()
        .single();

      if (error) throw error;
      
      this.requestLogger.info('Job created', { jobId: data.job_id, docId: data.doc_id });
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to create job', { error: error.message, docId: jobData.doc_id });
      throw error;
    }
  }

  async getJob(jobId) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('job_id', jobId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to get job', { error: error.message, jobId });
      throw error;
    }
  }

  async updateJobStatus(jobId, status, updates = {}) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const updateData = {
        status,
        updated_at: new Date().toISOString(),
        ...updates
      };

      if (status === 'started' && !updates.started_at) {
        updateData.started_at = new Date().toISOString();
      }

      if (status === 'completed' || status === 'failed') {
        updateData.completed_at = new Da
...
```

- `src/repositories/document-chunks.repository.js`

```javascript
import { getSupabaseClient } from './supabaseClient.js';

const db = getSupabaseClient();

/**
 * Add spec tag to document chunk metadata for retrieval boost
 */
export async function addSpecTag(chunkId, tag) {
  const { data, error } = await db
    .from('document_chunks')
    .select('metadata')
    .eq('chunk_id', chunkId)
    .single();

  if (error) throw error;
  const meta = data?.metadata ?? {};
  const tags = Array.isArray(meta.spec_tags) ? meta.spec_tags : [];
  const next = { ...meta, spec_tags: [...tags, tag] };

  const { error: updError } = await db
    .from('document_chunks')
    .update({ metadata: next })
    .eq('chunk_id', chunkId);

  if (updError) throw updError;
}

export default { addSpecTag };
```

- `src/repositories/jobs.repository.js`

```javascript
// src/repositories/jobs.repository.js
import { getSupabaseClient } from './supabaseClient.js';
import { logger } from '../utils/logger.js';

class JobsRepository {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  // Helper method to check if Supabase is available
  async checkSupabaseAvailability() {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      const error = new Error('Supabase client not available');
      error.code = 'SUPABASE_DISABLED';
      throw error;
    }
    return supabase;
  }

  /**
   * Fetch a job by its ID from the jobs table.
   * @param {string} id - The job UUID
   * @returns {Promise<Object>} - The job row
   */
  async getJobById(id) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('job_id', id)
        .single();

      if (error) throw error;
      
      this.requestLogger.info('Job retrieved by ID', { jobId: id });
      return data;
    } catch (error) {
      this.requestLogger.error('Failed to get job by ID', { error: error.message, jobId: id });
      throw error;
    }
  }

  /**
   * Update a job's status by ID.
   * @param {string} id - The job UUID
   * @param {string} status - New status (queued|processing|completed|failed)
   * @param {Object} updates - Additional fields to update
   */
  async updateJobStatus(id, status, updates = {}) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const updateData = {
        status,
        updated_at: new Date().toISOString(),
        ...updates
      };

      if (status === 'processing' && !updates.started_at) {
        updateData.started_at = new Date().toISOString();
      }

      if (status === 'completed' || status === 'failed') {
        updateData.completed_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from('jobs')
        .update(updateData)
        .eq('job_id', id)
        .select()
        .single();

      if (error) throw error;
      
      this.requestLogger.info('Job status updated', { jobId: id, status });
    
...
```

- `src/repositories/pinecone.repository.js`

```javascript
import { logger } from '../utils/logger.js';
import { joinUrl } from '../utils/url.js';
import { ENV } from '../config/env.js';

class PineconeRepository {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  // Get sidecar URL at runtime
  async getSidecarUrl() {
    const { getEnv } = await import('../config/env.js');
    const env = getEnv();
    return env.PYTHON_SIDECAR_URL;
  }

  // Get namespace at runtime
  async getNamespace() {
    const { getEnv } = await import('../config/env.js');
    const env = getEnv();
    return env.PINECONE_NAMESPACE || env.DEFAULT_NAMESPACE || null;
  }

  // Resolve namespace with precedence: PINECONE_NAMESPACE > DEFAULT_NAMESPACE > null
  async resolveNamespace() {
    const { getEnv } = await import('../config/env.js');
    const env = getEnv({ loose: true });
    return env.PINECONE_NAMESPACE || env.DEFAULT_NAMESPACE || null;
  }

  // Log namespace choice once on boot in dev
  async logNamespaceChoiceOnce() {
    if (ENV.NODE_ENV === 'production') return;
    const ns = await this.resolveNamespace();
    logger.info('Pinecone namespace selected', { namespace: ns || '(none)' });
  }

  // Get index statistics
  async getIndexStats() {
    try {
      const sidecarUrl = await this.getSidecarUrl();
      const response = await fetch(joinUrl(sidecarUrl, '/v1/pinecone/stats'));
      
      if (!response.ok) {
        throw new Error(`Failed to get Pinecone stats: ${response.status}`);
      }
      
      const stats = await response.json();
      
      this.requestLogger.debug('Pinecone index stats retrieved', {
        totalVectors: stats.total_vector_count,
        dimension: stats.dimension
      });
      
      return stats;
    } catch (error) {
      this.requestLogger.error('Failed to get Pinecone index stats', { error: error.message });
      throw error;
    }
  }

  // Search vectors with metadata filtering
  async searchVectors(query, options = {}) {
    try {
      const sidecarUrl = await this.getSidecarUrl();
      const namespace = await this.getNamespace();
      
      const {
        topK = 10,
        filter = {},
        includeMetadata = true,
        includeValues = false

...
```

- `src/repositories/knowledge.repository.js`

```javascript
/**
 * Knowledge Repository
 * Handles fact-first retrieval from approved DIP suggestions
 */

import { logger } from '../utils/logger.js';
import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../config/env.js';

class KnowledgeRepository {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
    this.supabase = null;
    this.initSupabase();
  }

  initSupabase() {
    try {
      const env = getEnv();
      const supabaseUrl = env.SUPABASE_URL;
      const supabaseKey = env.SUPABASE_ANON_KEY;
      
      if (supabaseUrl && supabaseKey) {
        this.supabase = createClient(supabaseUrl, supabaseKey);
        this.requestLogger.info('Supabase client initialized for knowledge repository');
      } else {
        this.requestLogger.warn('Supabase credentials not available for knowledge repository');
      }
    } catch (error) {
      this.requestLogger.error('Failed to initialize Supabase client', { error: error.message });
    }
  }

  async checkSupabaseAvailability() {
    if (!this.supabase) {
      throw new Error('Database service unavailable');
    }
    return this.supabase;
  }

  /**
   * Find fact match by query string
   * Searches across all fact types in the knowledge_facts view
   */
  async findFactMatchByQuery(query) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      // Normalize query for better matching
      const normalizedQuery = query.toLowerCase().trim();
      
      // Search by key (spec suggestions)
      const { data: keyMatches, error: keyError } = await supabase
        .from('knowledge_facts')
        .select('*')
        .ilike('key', `%${normalizedQuery}%`)
        .limit(1);

      if (keyError) {
        this.requestLogger.error('Error searching by key', { error: keyError.message, query });
        throw keyError;
      }

      if (keyMatches && keyMatches.length > 0) {
        this.requestLogger.info('Fact match found by key', { 
          query, 
          factType: keyMatches[0].fact_type,
          key: keyMatches[0].key 
        });
        return keyMatches[0];
      }

      // Search by intent (intent hints)
      const { data: intentMatches, er
...
```

- `src/repositories/intent.repository.js`

```javascript
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from './supabaseClient.js';

class IntentRepository {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  async checkSupabaseAvailability() {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Database service unavailable');
    }
    return supabase;
  }

  /**
   * Get all intent routes with optional filtering
   */
  async getAllIntentRoutes(filters = {}) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      let query = supabase
        .from('intent_router')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters.intent) {
        query = query.eq('intent', filters.intent);
      }
      if (filters.pattern) {
        query = query.ilike('pattern', `%${filters.pattern}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      this.requestLogger.info('Retrieved intent routes', { count: data?.length || 0, filters });
      return { success: true, data: data || [] };
    } catch (error) {
      this.requestLogger.error('Failed to get intent routes', { error: error.message, filters });
      throw error;
    }
  }

  /**
   * Get a specific intent route by ID
   */
  async getIntentRouteById(id) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('intent_router')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      this.requestLogger.info('Retrieved intent route', { id, found: !!data });
      return { success: true, data };
    } catch (error) {
      this.requestLogger.error('Failed to get intent route by ID', { error: error.message, id });
      throw error;
    }
  }

  /**
   * Create a new intent route
   */
  async createIntentRoute(routeData, createdBy = 'admin') {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('intent_router')
        .insert({
          pattern: routeData.pattern,
          intent: routeData.int
...
```

- `src/repositories/sidecar.client.js`

```javascript
// src/repositories/sidecar.client.js
import { getEnv } from '../config/env.js';

export async function parsePdf(/* args */) {
  if (getEnv({ loose: true }).NODE_ENV === 'test' || getEnv({ loose: true }).SIDECAR_MOCK === '1') {
    // fast, deterministic fake
    return { 
      pages: 2, 
      tables: 0, 
      elements: [{type:'text', text:'ok'}] 
    };
  }
  
  // real call - this would be the actual implementation
  const res = await fetch(`${getEnv({ loose: true }).PYTHON_SIDECAR_URL}/parse`, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ /* args */ })
  });
  
  if (!res.ok) throw new Error(`Sidecar ${res.status}`);
  return res.json();
}
```

### 3.2 External Clients
- **OpenAI** client for LLM calls
- **Python Sidecar** HTTP client for PDF parsing / DIP

`src/clients/openai.client.js`

```javascript
// Centralized OpenAI client for consistent API calls
// Handles timeouts, retries, and configuration management

import { logger } from '../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Makes a structured JSON API call to OpenAI
 * @param {Object} params - Configuration object
 * @param {string} params.system - System prompt
 * @param {string} params.user - User prompt
 * @param {Object} params.schema - JSON schema for structured output
 * @param {string} params.model - OpenAI model to use
 * @param {number} params.maxOutputTokens - Maximum tokens to generate
 * @param {number} params.seed - Seed for deterministic output
 * @returns {Promise<Object>} - Parsed JSON response
 */
export async function oaiJson({ system, user, schema, model, maxOutputTokens, seed }) {
  const { getEnv } = await import('../config/env.js');
  const env = getEnv();
  
  const openaiApiKey = env.OPENAI_API_KEY;
  const openaiModel = model || env.OPENAI_MODEL || 'gpt-4';
  const maxTokens = maxOutputTokens || 200;
  const temperature = 0; // Always 0 for structured JSON
  const timeoutMs = parseInt(env.OPENAI_TIMEOUT_SECONDS || '15') * 1000;
  const retryAttempts = parseInt(env.OPENAI_RETRY_ATTEMPTS || '3');

  const requestBody = {
    model: openaiModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    max_completion_tokens: maxTokens,
    temperature,
    seed: seed || 11,
    response_format: { type: "json_object" }
  };

  return await makeOpenAICall(requestBody, openaiApiKey, timeoutMs, retryAttempts);
}

/**
 * Makes a natural language API call to OpenAI
 * @param {Object} params - Configuration object
 * @param {string} params.system - System prompt
 * @param {string} params.user - User prompt
 * @param {string} params.model - OpenAI model to use
 * @param {number} params.maxOutputTokens - Maximum tokens to generate
 * @param {number} params.seed - Seed for deterministic output
 * @param {string} params.style - Style preset for temperature control
 * @returns {Promise<string>} - Generated text response
 */
export async function oaiText({ system, user, model, maxOutputTokens, seed, style = 
...
```

`src/clients/python-sidecar.client.js`

```javascript
// Python Sidecar Client for chat workflow
// Handles HTTP calls to Python sequential workflow endpoint

import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';

const requestLogger = logger.createRequestLogger();

/**
 * Calls Python sidecar chat workflow endpoint
 * @param {Object} params - Configuration object
 * @param {string} params.query - User query
 * @param {Array<Object>} params.systemsContext - Equipment context from memory/search
 * @param {string} params.threadId - Conversation thread ID
 * @param {string} params.conversationSummary - Summary of conversation history
 * @param {Object} params.memoryContext - Memory context (weighted equipment tracking)
 * @param {string} params.synthesisModel - LLM model for synthesis (gpt-5 or gpt-4.1-mini)
 * @returns {Promise<Object>} - Chat response with classification, sources, and metadata
 */
export async function processChatWorkflow({
  query,
  systemsContext = [],
  threadId = null,
  conversationSummary = null,
  memoryContext = null,
  synthesisModel = 'gpt-5'
}) {
  const env = getEnv();

  const sidecarUrl = env.PYTHON_SIDECAR_URL || 'http://localhost:8000';
  const endpoint = `${sidecarUrl}/v1/chat/process`;
  const timeoutMs = parseInt(env.PYTHON_CHAT_TIMEOUT_MS || '30000'); // 30s default
  const retryAttempts = parseInt(env.PYTHON_CHAT_RETRY_ATTEMPTS || '2');

  const requestBody = {
    query,
    systems_context: systemsContext,
    thread_id: threadId,
    conversation_summary: conversationSummary,
    memory_context: memoryContext,
    synthesis_model: synthesisModel
  };

  return await makePythonSidecarCall(endpoint, requestBody, timeoutMs, retryAttempts);
}

/**
 * Makes the actual Python sidecar API call with retry logic
 * @param {string} endpoint - Full endpoint URL
 * @param {Object} requestBody - Request body
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {number} retryAttempts - Number of retry attempts
 * @returns {Promise<Object>} - Python sidecar API response
 */
async function makePythonSidecarCall(endpoint, requestBody, timeoutMs, retryAttempts) {
  let lastError;

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    
...
```

### 3.3 Utilities & Config
- **Normalization** (`src/utils/normalize.js`)
- **Fuzzy Matching** (`src/utils/fuzzyMatcher.js`)
- **Logger** (`src/utils/logger.js`)

`src/utils/fuzzyMatcher.js`

```javascript
/**
 * Fuzzy matching utility for handling typos in maintenance tokens and units
 * Uses Levenshtein distance algorithm for approximate string matching
 */

export class FuzzyMatcher {
  constructor(options = {}) {
    this.maxDistance = options.maxDistance || 2;
    this.minLength = options.minLength || 3;
    this.minConfidence = options.minConfidence || 0.6;
  }

  /**
   * Calculate Levenshtein distance between two strings
   * @param {string} a - First string
   * @param {string} b - Second string
   * @returns {number} Edit distance
   */
  levenshteinDistance(a, b) {
    if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);
    
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
    
    // Initialize first row and column
    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
    
    // Fill the matrix
    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // deletion
          matrix[j - 1][i] + 1,     // insertion
          matrix[j - 1][i - 1] + cost // substitution
        );
      }
    }
    
    return matrix[b.length][a.length];
  }

  /**
   * Find the best fuzzy match for input against a list of candidates
   * @param {string} input - Input string to match
   * @param {string[]} candidates - Array of candidate strings
   * @returns {Object|null} Best match object or null if no good match found
   */
  findBestMatch(input, candidates) {
    if (!input || !candidates?.length) return null;
    
    const normalizedInput = input.toLowerCase().trim();
    if (normalizedInput.length < this.minLength) return null;

    let bestMatch = null;
    let bestScore = Infinity;

    for (const candidate of candidates) {
      const normalizedCandidate = candidate.toLowerCase();
      const distance = this.levenshteinDistance(normalizedInput, normalizedCandidate);
      
      if (distance <= this.maxDistance && distance < bestScore) {
        bestScore = distance;
        const confidence = 1 - (dist
...
```

`src/utils/logger.js`

```javascript
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

    if (meta.error) {
      formatted += `\n  Error: ${meta.error}`;
      if (meta.stack) {
        formatted += `\n  Stack: ${meta.stack}`;
      }
    }

    return formatted + '\n';
  }

  async writeLog(level, message, meta = {}) {
    try {

...
```

## 4. Document Intelligence Pipeline (DIP) Flow
**Upload → Parse → DIP generate → Stage/Commit → Index**
- Upload triggers immediate inline job processing (post-worker migration)
- Python sidecar handles PDF parsing, OCR fallback, and JSON outputs
- Repositories persist chunks, DIP suggestions, and sync to Supabase
- Pinecone repository indexes vectors and metadata

## 5. Retrieval & Multi‑Equipment Architecture
- Query normalization → multi-equipment extraction (array-based) → parallel Pinecone queries
- Confidence scoring, fallback paths, and structured outputs

## 6. Recent Code Updates (Integrated)
Below is a concise index of the changes from `/code updates/`.

**Code Update Note 1: LLM Metrics Stats Panel Implementation**  
_File: 1 UI update and LLM logs.md_

**Date:** October 5, 2025
**Author:** Claude
## Summary
Implemented a comprehensive LLM metrics tracking and visualization system that captures detailed performance data from the Python chat workflow and displays it in a real-time stats panel in the UI.
## Problem Solved
Previously, there was no visibility into the LLM processing pipeline's performance characteristics. The system had comprehensive logging but no way to surface these metrics to users in real-time. This made it difficult to understand:
- How long each processing stage takes
- What classification decisions were made

---

**Equipment Extraction Fallback Implementation**  
_File: 10 Equipment Extraction Fallback Implementation.md_

**Date:** 2025-10-08
**Status:** ✅ Analysis Complete, Ready for Implementation
**Session:** Colloquial Keywords + Equipment Extraction Fallback
---
## 📋 TABLE OF CONTENTS
1. [Session Overview](#session-overview)
2. [Colloquial Keywords Implementation](#colloquial-keywords-implementation)
3. [Critical Bugs Fixed](#critical-bugs-fixed)

---

**Code Update #11: GPT-5 Max Tokens Fix for Reasoning Models**  
_File: 11 GPT-5 Max Tokens Fix for Reasoning Models.md_

**Date:** October 7, 2025
**Status:** ✅ FIXED
**Impact:** Critical - Synthesis was returning empty responses for all gpt-5 queries
---
## Problem Statement
Equipment extraction fallback (from Update #10) worked correctly - it successfully found the Marco water pump using LLM extraction when keyword search failed. However, the Python synthesis step returned completely empty content after 86 seconds, causing a 500 error.
### Observed Behavior
**Test Query:** "my water pump is turning off frequently"

---

**Equipment Search Bug - "where is rocna made" Returns 0 Systems**  
_File: 12 Equipment Search Bug - Rocna Not Found.md_

**Date:** 2025-10-08
**Status:** IN PROGRESS - Fix attempted but not working
**Priority:** HIGH - Affects all general product queries without possessive pronouns
---
## Problem Statement
When asking "where is rocna made?" the system returns **0 systems found** even though:
- ✅ Rocna exists in systems table (`SELECT * FROM search_systems('rocna', 10)` returns 1 result)
- ✅ Asset UID: `dac504d8-2fcd-4d9d-a5db-744fb64901e5`

---

**DIP Tables Production Migration and JSONB Text Column Population**  
_File: 13 DIP Tables Production Migration and JSONB Text Column Population.md_

**Date:** 2025-10-08
**Status:** ✅ COMPLETED
**Priority:** HIGH - Critical for DIP data retrieval in chat queries
---
## Problem Statement
The DIP (Document Intelligence Processing) retriever was querying staging tables instead of production tables, resulting in:
1. ❌ Chat queries not finding approved DIP data (specs, playbooks, golden tests, intent routing)
2. ❌ Only pending/unapproved data being searched

---

**Session 14: Document Upload Timeout Fixes, Schema Cleanup, and Pinecone Race Condition**  
_File: 14 Document Upload Timeout Fixes and Schema Cleanup.md_

## Session Summary
Fixed critical timeout issues causing document upload failures, cleaned up database schema mismatches in DIP ingestion, fixed ANTHROPIC_API_DELAY environment variable loading bug, and identified Pinecone eventual consistency race condition in colloquial keyword extraction.
---
## Problem 1: Document Upload Timeout Failure
### Initial Issue
- **Time:** 22:23:29
- **Error:** Document upload failed with generic "fetch failed" error
- **Root Cause:** Node.js undici fetch() default timeout of 5 minutes (300 seconds)

---

**Multi-Equipment Extraction: Array-Based LLM Implementation**  
_File: 15 Multi-Equipment Extraction Array-Based LLM Implementation.md_

**Date:** 2025-10-09
**Session Focus:** Fixing multi-equipment query extraction to return structured arrays instead of comma-separated strings
---
## Executive Summary
The equipment extraction system was returning comma-separated strings for multi-equipment queries (e.g., "GPS, V100, Zeus"), causing search failures because the database couldn't match literal comma-separated strings. We redesigned the LLM prompt and extraction logic to return structured JSON arrays, enabling individual searches for each piece of equipment and proper handling of implicit systems.
**Problem:** Multi-equipment que

---

**Implementation Guide: Multi-Equipment Array Extraction**  
_File: 15a IMPLEMENTATION_GUIDE_15.md_

**Reference:** Code Update #15
**Files to modify:** 2 files, ~235 lines
**Time estimate:** 2 hours
---
## Step 1: Update Equipment Extraction Service (30 min)
**File:** `src/services/equipment-extraction.service.js`
### 1A: Replace the EXTRACTION_PROMPT constant
**Find:** `const EXTRACTION_PROMPT = \`You are an equipment name extractor...`

---

**Code Update #16: Multi-Equipment Testing and Pinecone Metadata Issue Discovery**  
_File: 16 Multi-Equipment Testing and Pinecone Metadata Issue.md_

**Date:** 2025-10-09
**Status:** Implementation Complete, Critical Bug Found
**Related:** Code Update #15 (Multi-Equipment Extraction Implementation)
---
## Executive Summary
After implementing the multi-equipment extraction system (Code Update #15), comprehensive testing revealed:
1. ✅ **Multi-equipment extraction is working** - Successfully extracts 2-5 systems from queries like "GPS on V100 and Zeus"
2. ✅ **Array-based search is working** - Loops through each extracted equipment and searches individually

---

**Environment and Logging Compliance Cleanup**  
_File: 17 Environment and Logging Compliance Cleanup.md_

**Date:** 2025-10-09
**Session Focus:** .cursorrules audit, langchain cleanup, console.log → logger, process.env → getEnv()
---
## Problems Solved
### 1. Python venv Committed to Git (9,670 files)
**Issue:** `python-sidecar/venv/` was tracked in git, causing bloat and cross-platform issues
**Root Cause:** venv was committed before .gitignore was properly configured
### 2. LangGraph Dead Code Remaining After Migration

---

**Code Update #18: Multi-System Architecture Fix - Parallel Search and Pinecone Loop**  
_File: 18 Multi-System Architecture Fix - Parallel Search and Pinecone Loop.md_

**Date:** 2025-10-09
**Status:** Planning Complete, Ready for Implementation
**Related:** Code Update #16 (Multi-Equipment Testing and Pinecone Metadata Issue)
---
## Executive Summary
Session focused on fixing two critical architectural issues discovered during testing (Code Update #16):
1. **Node.js Equipment Search "Local Maximum" Trap** - Keyword search finding 1 result prevents LLM from detecting additional equipment
2. **Python Pinecone "First Equipment Lottery"** - Only searching the first equipment's metadata excludes all other equipment documentation

---

**Code Update #19: Equipment Extraction Fix and Confidence Score Tracing**  
_File: 19 Equipment Extraction Fix and Confidence Score Tracing.md_

**Date:** 2025-10-10
**Duration:** ~2 hours
**Status:** Extraction Fixed, Python Delivery Issue Discovered
---
## Executive Summary
Session focused on fixing equipment extraction for inventory-type queries like "tell me the models of harken winches I have?" which were returning 0 equipment. Successfully improved the LLM extraction prompt to handle these patterns, verified confidence scores are flowing through Node.js, but discovered that Python is receiving empty `systems_context` despite Node.js finding and processing the equipment correctly.
**Key Achievements:**
1. ✅ Fixed LLM extraction fo

---

**Code Update Note 2: LLM Metrics Panel Debug and Fix**  
_File: 2 Metrics Panel Debug and Fix.md_

**Date:** December 6, 2024
**Author:** Claude
## Summary
Fixed the LLM metrics stats panel that wasn't receiving data from the Python backend. Identified that metrics were being generated but not passed through the API response chain. Also implemented UI improvements for better readability and completeness of Pinecone search results display.
## Problem Identified & Solved
### Initial Issue
The stats panel was implemented (as per Update Note 1) but wasn't displaying any metrics data. Despite the UI components being in place, the `detailed_metrics` object wasn't reaching the frontend.
### Root C

---

**Code Update #20: Rank Field Missing from systemsContext Investigation**  
_File: 20 Rank Field Missing from systemsContext Investigation.md_

**Date:** 2025-10-10
**Duration:** ~4 hours
**Status:** Root Cause Identified, Fix Ready (No Code Changes Made)
---
## Executive Summary
Deep investigation into why Python displays "OWNERSHIP: POSSIBLE (confidence: 0.00)" for equipment that the user clearly owns. Traced the issue through the entire stack from PostgreSQL `ts_rank()` function → Node.js search → systemsContext building → Python display logic.
**Key Finding:** The `rank` field (PostgreSQL full-text search relevance score) is calculated correctly but **dropped when building `systemsContext`**, causing Python to default to `rank: 0`

---

**Python Environment Fix and LangGraph Cleanup Discovery**  
_File: 3 Python Environment Fix and LangGraph Cleanup Discovery.md_

**Date:** 2025-10-06
**Issue:** restart-all.sh script failing, Python environment confusion, and discovered leftover LangGraph packages
## Problem Summary
1. **Initial Issue:** restart-all.sh was incorrectly reporting Python service startup failure
2. **Root Cause:** Python venv symlinks resolved to system Python, causing confusion about which environment was active
3. **Critical Discovery:** LangGraph/LangChain packages still installed in venv despite being removed from requirements.txt
## Environment Confusion Investigation
### What We Found

---

**REIMAGINEDAPPV2 UI Fixes and Updates Summary**  
_File: 3 UI Fixes.md_

## Session Date: October 6, 2025
### Main Chat UI Fixes (src/public/index.html & chat-styles.css)
#### 1. Delete Thread Functionality
- **Issue**: Delete button wasn't working due to incorrect variable references
- **Fix**:
- Changed from `deleteChatSession(chat.id)` to `deleteChatThread(chat.latestThread.id)`
- Updated backend to delete from `THREADS_TABLE` instead of deprecated `SESSIONS_TABLE`
- Added proper logging for debugging

---

**Logging System Overhaul and Organization**  
_File: 4 Logging System Overhaul and Organization.md_

**Date:** October 6-7, 2025
**Status:** ✅ COMPLETE (All Phases 1-8 Done Including UI)
---
## Overview
Completely redesigned the logging infrastructure to solve the problem of "logs being of zero help." The old system was full of health check spam, lacked structure, and made debugging impossible. The new system provides:
- **Organized log files** by type (chat, api, errors, debug) ✅
- **Health check filtering** to eliminate noise ✅
- **Structured, human-readable logs** for chat operations ✅

---

**Docker to venv Migration Completion and Upload Process Deep Dive**  
_File: 5 Docker to venv Migration Completion and Upload Process.md_

**Date:** 2025-10-07
**Session Focus:** Completing Docker→venv migration, fixing chat UI scroll, documenting upload pipeline
---
## Problems Solved
### 1. Document Upload Failing with Docker Error
**Issue:** Upload jobs failing with `Cannot connect to the Docker daemon` error
**Root Cause:** `anthropic.extraction.service.js` still had 4 Docker commands that were never updated during Python environment migration
### 2. Chat UI Content Hidden Behind Input Bar

---

**Chat Layout Architecture Refactor - From Padding Hacks to Proper Grid/Flex**  
_File: 6 Chat Layout Architecture Refactor.md_

**Date:** 2025-10-07
**Session Focus:** Complete architectural refactor of chat interface layout from padding-based positioning to proper CSS Grid/Flexbox
---
## Executive Summary
The chat interface suffered from a fundamental architectural flaw: using fixed positioning with magic padding values to solve layout problems. This resulted in:
- Content being cut off at top and bottom
- Scroll behavior fighting with padding
- Interconnected panels affecting each other

---

**Worker to Linear Processing Migration Plan**  
_File: 7 Worker to Linear Processing Migration.md_

**Date:** 2025-10-07
**Goal:** Remove background worker polling, call `processJob()` directly after upload verification completes.
---
## 🎯 PROBLEM STATEMENT
**Current Issues:**
- Worker process crashes frequently
- Polling every 5 seconds for rare upload events = wasted resources
- 0-5 second latency before job pickup

---

**Upload Progress Popup Overhaul**  
_File: 8 Upload Progress Popup Overhaul.md_

**Date:** 2025-10-07
**Goal:** Fix upload progress popup to show real-time status with 9 clean stages, remove broken chunk counting, and improve error handling.
---
## 🎯 PROBLEM STATEMENT
**Current Issues:**
- Progress popup shows incorrect/missing status updates
- Chunk counting displays broken "1/1" value
- Popup only appears after upload completes (should show immediately)

---

**Colloquial Keyword Extraction for System Search**  
_File: 9 Colloquial Keyword Extraction for System Search.md_

**Date:** 2025-10-07
**Status:** ✅ Ready for Implementation
**Problem:** Chat workflow crashes when users describe equipment with colloquial terms or symptoms
---
## 🎯 PROBLEM STATEMENT
### The Issue
Users asking about equipment with natural language are getting zero results and workflow crashes:
**Failed Queries:**

---

**Compaction Summary - Thu Oct  9 12:21:05 EDT 2025**  
_File: compact-20251009_122105.md_

Session:

---

**Compaction Summary - Thu Oct  9 13:27:02 EDT 2025**  
_File: compact-20251009_132702.md_

Session:

---

**Compaction Summary - Thu Oct  9 14:18:12 EDT 2025**  
_File: compact-20251009_141812.md_

Session:

---

**Compaction Summary - Thu Oct  9 19:05:22 EDT 2025**  
_File: compact-20251009_190522.md_

Session:

---

**Compaction Summary - Thu Oct  9 19:41:20 EDT 2025**  
_File: compact-20251009_194120.md_

Session:

---

**Compaction Summary - Thu Oct  9 19:42:16 EDT 2025**  
_File: compact-20251009_194216.md_

Session:

---

**Compaction Summary - Thu Oct  9 20:31:30 EDT 2025**  
_File: compact-20251009_203130.md_

Session:

---

**Compaction Summary - Fri Oct 10 09:39:09 EDT 2025**  
_File: compact-20251010_093909.md_

Session:

---

**Compaction Summary - Fri Oct 10 21:17:12 EDT 2025**  
_File: compact-20251010_211712.md_

Session:

---

## 7. Environment & Deployment Notes
- Node 20+ with Express
- Python sidecar on `venv` (Docker no longer required locally)
- Feature flags and `.env` normalization (see clients and repositories)

## 8. Logging, Metrics, and Monitoring
- Structured logs; centralized logger utility
- Trace IDs through request lifecycle; error middleware for safe responses

## 9. Migration to Mintlify `.mdx`
- Convert this file to `docs/auto/architecture.mdx`
- Add callouts, tab groups, and intra-doc links for Code Reference pages

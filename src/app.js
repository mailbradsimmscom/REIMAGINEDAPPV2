import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { logger } from './utils/logger.js';
import { getEnv } from './config/env.js';
// Note: errorHandler and notFoundHandler are wired in src/index.js after routes are mounted
import adminRouter from './routes/admin/index.js';
import suppliesRouter from './routes/supplies/index.js';
import tripsRouter from './routes/trips/index.js';
import gpsRouter from './routes/gps.route.js';
import anchoragesRouter from './routes/anchorages/index.js';
import funnelRouter from './routes/funnel/index.js';
import seasonRecapRouter from './routes/season-recap/index.js';
import boatNowRouter from './routes/boat-now/index.js';

// Create Express app
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for development
  crossOriginEmbedderPolicy: false // Disable COEP for development
}));

// CORS configuration - environment-based
const env = getEnv();
app.use(cors({
  origin: function(origin, callback) {
    // Development and test environments allow localhost
    const isDevOrTest = env.NODE_ENV === 'development' || env.NODE_ENV === 'test' || process.env.CI;
    const allowedOrigins = isDevOrTest
      ? [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://192.168.20.106:3000',  // Local IP for mobile testing
          'http://192.168.20.106:3001'
        ]
      : [
          'https://chat.catamaranos.com',
          'https://admin.catamaranos.com',
          'https://boatos-main.onrender.com',         // Render URL for main app
          'https://boatos-python.onrender.com',       // Render URL for Python sidecar
          'https://boatos-maintenance.onrender.com'   // Render URL for maintenance agent
        ];

    // Allow requests with no origin (same-origin) or from whitelist
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Body parsing middleware with size limits
app.use(express.json({
  limit: '10mb' // 10MB limit for JSON payloads (needed for base64 images)
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
    const content = await fs.readFile(join(process.cwd(), 'src/public/unified-mobile.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'unified-mobile.html not found' });
  }
});

app.get('/index.html', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/unified-mobile.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'unified-mobile.html not found' });
  }
});

// Static file serving for /public path
app.use('/public', express.static(join(process.cwd(), 'src/public')));

// Root-level static file serving for CSS, JS, and other assets
app.use('/css', express.static(join(process.cwd(), 'src/public/css')));
app.use('/js', express.static(join(process.cwd(), 'src/public/js'), {
  setHeaders: (res, path) => {
    // Ensure JavaScript files have correct MIME type for ES6 modules (Safari requirement)
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
    }
  }
}));
app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

// Python sidecar proxy routes (for document-ingest.html)
app.post('/python/v1/llamaparse', async (req, res) => {
  try {
    const sidecarUrl = getEnv().PYTHON_SIDECAR_URL || 'http://localhost:8000';

    // Collect the raw body for multipart forwarding
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    // Forward query params (e.g., doc_id) to Python sidecar
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    const targetUrl = `${sidecarUrl}/v1/llamaparse${queryString}`;

    const response = await fetch(targetUrl, {
      method: 'POST',
      body: body,
      headers: { 'Content-Type': req.headers['content-type'] }
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('LlamaParse proxy error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/python/v1/detect-models', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const sidecarUrl = getEnv().PYTHON_SIDECAR_URL || 'http://localhost:8000';

    // Fetch reference tables to include in request
    const { getSupabaseClient } = await import('./repositories/supabaseClient.js');
    const supabase = await getSupabaseClient();

    const [mfrs, types, systems, subsystems] = await Promise.all([
      supabase.from('ref_manufacturers').select('name').order('name'),
      supabase.from('ref_product_types').select('name').order('name'),
      supabase.from('ref_system_categories').select('id, name').order('display_order'),
      supabase.from('ref_subsystem_categories').select('id, name, system_id').order('display_order')
    ]);

    // Build subsystem list with parent system names
    const systemMap = new Map(systems.data?.map(s => [s.id, s.name]) || []);
    const subsystemList = (subsystems.data || []).map(sub => ({
      name: sub.name,
      system_id: sub.system_id,
      system_name: systemMap.get(sub.system_id) || 'Unknown'
    }));

    // Add reference_data to request body
    const enrichedBody = {
      ...req.body,
      reference_data: {
        manufacturers: (mfrs.data || []).map(m => m.name),
        product_types: (types.data || []).map(t => t.name),
        system_categories: (systems.data || []).map(s => s.name),
        subsystem_categories: subsystemList
      }
    };

    const response = await fetch(`${sidecarUrl}/v1/detect-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enrichedBody)
    });

    const data = await response.json();
    // Include reference_data in response for frontend dropdown population
    data.reference_data = enrichedBody.reference_data;
    res.status(response.status).json(data);
  } catch (error) {
    logger.error('Model detection proxy error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// PIN authentication endpoint (public - no auth required)
app.post('/api/auth/pin', (req, res) => {
  const { pin } = req.body;
  const env = getEnv();

  if (!env.ADMIN_PIN) {
    return res.status(500).json({
      success: false,
      error: 'PIN authentication not configured'
    });
  }

  if (!pin || pin !== env.ADMIN_PIN) {
    return res.status(401).json({
      success: false,
      error: 'Invalid PIN'
    });
  }

  // PIN valid - return the admin token
  return res.json({
    success: true,
    token: env.ADMIN_TOKEN
  });
});

// Admin API routes
// Set _mountPath for Express 5 route introspection (see src/debug/routes.js)
adminRouter._mountPath = '/admin/api';
app.use('/admin/api', adminRouter);

// Supplies API routes
suppliesRouter._mountPath = '/api/supplies';
app.use('/api/supplies', suppliesRouter);

// Trips API routes
tripsRouter._mountPath = '/api/trips';
app.use('/api/trips', tripsRouter);

// GPS API routes (public, for position monitor)
gpsRouter._mountPath = '/api/gps';
app.use('/api/gps', gpsRouter);

// Anchorages API routes
anchoragesRouter._mountPath = '/api/anchorages';
app.use('/api/anchorages', anchoragesRouter);

// Funnel API routes
funnelRouter._mountPath = '/api/funnel';
app.use('/api/funnel', funnelRouter);

// Season Recap API routes
seasonRecapRouter._mountPath = '/api/season-recap';
app.use('/api/season-recap', seasonRecapRouter);

// Boat Now API routes
boatNowRouter._mountPath = '/api/boat-now';
app.use('/api/boat-now', boatNowRouter);

// Admin dashboard route (no auth required for HTML page)
app.get('/admin', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/admin.htm'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Admin dashboard not found' });
  }
});

// Supplies management route (no auth required for HTML page)
app.get('/supplies', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/supplies.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Supplies page not found' });
  }
});

// Supplies admin page (manage categories, units, locations)
app.get('/supplies/admin', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/supplies-admin.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Supplies admin page not found' });
  }
});

// Trips tracking page
app.get('/trips', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/trips.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Trips page not found' });
  }
});

// Trip detail page
app.get('/trips/detail', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/trip-detail.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Trip detail page not found' });
  }
});

// Trip edit page
app.get('/trips/edit', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/trip-edit.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Trip edit page not found' });
  }
});

// Anchorages tracking page
app.get('/anchorages', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/anchorages.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Anchorages page not found' });
  }
});

// Pipeline funnel visualization page
app.get('/funnel', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/funnel.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Funnel page not found' });
  }
});

// Testing pages (no auth required for HTML pages)
app.get('/admin/testing', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/testing.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Testing dashboard not found' });
  }
});

app.get('/admin/testing/specifications', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/testing-specifications.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Testing specifications page not found' });
  }
});

app.get('/admin/testing/playbook', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/testing-playbook.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Testing playbook page not found' });
  }
});

app.get('/admin/testing/intent-router', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/testing-intent-router.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Testing intent router page not found' });
  }
});

app.get('/admin/testing/golden-tests', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/testing-golden-tests.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Testing golden tests page not found' });
  }
});

// Landing page (no auth required)
app.get('/landing', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/landing.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Landing page not found' });
  }
});

// Document ingest page (v5 unified flow)
app.get('/ingest', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/document-ingest.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Document ingest page not found' });
  }
});

// Equipment onboarding page (document-first flow approval screen)
app.get('/onboarding', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/onboarding.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Onboarding page not found' });
  }
});

// Progress tracking page (no auth required for HTML page)
app.get('/admin/testing-progress', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/testing-progress.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Progress page not found' });
  }
});

// DIP suggestions review route (no auth required for HTML page)
app.get('/suggestions.html', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/suggestions.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Suggestions page not found' });
  }
});

// Unified mobile dashboard (no auth required for HTML page)
app.get('/unified-mobile.html', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/unified-mobile.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(500).send('Error loading page');
  }
});

// Performance logging middleware
app.use((req, res, next) => {
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - req.startTime;
    req.requestLogger.performance('http_request', duration, {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode
    });
    originalEnd.call(this, chunk, encoding);
  };
  next();
});

// NOTE: 404 and error handlers are wired in src/index.js AFTER routes are mounted
// Do NOT add them here - app.js is imported by index.js which adds routes after this

export default app;

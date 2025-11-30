import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { logger } from './utils/logger.js';
import { getEnv } from './config/env.js';
import adminRouter from './routes/admin/index.js';
import suppliesRouter from './routes/supplies/index.js';
import tripsRouter from './routes/trips/index.js';
import gpsRouter from './routes/gps.route.js';

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
    const allowedOrigins = env.NODE_ENV === 'development'
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
    const content = await fs.readFile(join(process.cwd(), 'src/public/index.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'index.html not found' });
  }
});

app.get('/index.html', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/index.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'index.html not found' });
  }
});

// Static file serving for /public path
app.use('/public', express.static(join(process.cwd(), 'src/public')));

// Root-level static file serving for CSS, JS, and other assets
app.use('/css', express.static(join(process.cwd(), 'src/public/css')));
app.use('/js', express.static(join(process.cwd(), 'src/public/js')));
app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

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
app.use('/admin/api', adminRouter);

// Supplies API routes
app.use('/api/supplies', suppliesRouter);

// Trips API routes
app.use('/api/trips', tripsRouter);

// GPS API routes (public, for position monitor)
app.use('/api/gps', gpsRouter);

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

// Document upload page (no auth required for HTML page)
app.get('/upload', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/upload.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Upload page not found' });
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

export default app;

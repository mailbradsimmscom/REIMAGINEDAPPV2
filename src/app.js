import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { logger } from './utils/logger.js';

// Create Express app
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for development
  crossOriginEmbedderPolicy: false // Disable COEP for development
}));

// CORS configuration
app.use(cors({
  origin: true, // Allow all origins for development
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
app.use((req, res, next) => {
  const requestLogger = logger.createRequestLogger();
  const startTime = Date.now();
  
  // DEBUG: Add request tracing
  console.log('🔍 [APP] REQUEST START:', req.method, req.originalUrl, '→', req.url);
  
  requestLogger.info('HTTP request received', { 
    method: req.method, 
    url: req.url,
    userAgent: req.headers['user-agent']?.substring(0, 100)
  });
  
  // Add logger to request for route handlers
  req.requestLogger = requestLogger;
  req.startTime = startTime;
  
  next();
});

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

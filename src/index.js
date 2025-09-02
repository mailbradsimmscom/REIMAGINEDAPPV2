import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { adminGate } from './middleware/admin.js';
import { securityHeaders, basicRateLimit } from './middleware/security.js';
import { env } from './config/env.js';

// Import all Express routers
import healthRouter from './routes/health.router.js';
import systemsRouter from './routes/systems.router.js';
import chatRouter from './routes/chat/index.js';
import adminRouter from './routes/admin/index.js';
import documentRouter from './routes/document/index.js';
import pineconeRouter from './routes/pinecone.router.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Express app
const app = express();

// Security middleware (must come first)
app.use(securityHeaders);
app.use(basicRateLimit);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow admin origin (you can configure this in env)
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001'
    ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token']
};

app.use(cors(corsOptions));

// Body parsing middleware with strict limits
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`, {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });
  next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes (order matters - more specific routes first)
app.use('/admin/docs', documentRouter);  // More specific admin route first
app.use('/admin', adminRouter);          // General admin route second
app.use('/chat/enhanced', chatRouter);
app.use('/systems', systemsRouter);
app.use('/pinecone', pineconeRouter);
app.use('/health', healthRouter);

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const startServer = () => {
  app.listen(env.port, () => {
    logger.info('Express server started', { 
      port: env.port,
      routes: {
        health: `http://localhost:${env.port}/health`,
        systems: `http://localhost:${env.port}/systems`,
        chat: `http://localhost:${env.port}/chat/enhanced`,
        admin: `http://localhost:${env.port}/admin`,
        documents: `http://localhost:${env.port}/admin/docs`,
        pinecone: `http://localhost:${env.port}/pinecone`
      },
      adminGate: 'x-admin-token required'
    });
  });
};

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start the server
startServer();

export default app;



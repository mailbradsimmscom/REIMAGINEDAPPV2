import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { logger } from './src/utils/logger.js';
import { errorHandler, notFoundHandler } from './src/middleware/error.js';
import { adminGate } from './src/middleware/admin.js';
import { securityHeaders, basicRateLimit } from './src/middleware/security.js';
import { getEnv } from './src/config/env.js';

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
  console.log(`${req.method} ${req.url}`);
  next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'src', 'public')));

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'public', 'index.html'));
});

// Test route to verify basic routing works
app.get('/test', (req, res) => {
  res.json({ message: 'Test route works!' });
});

// API Routes (order matters - more specific routes first)
console.log('Mounting routes...');

// Import routers with error handling
try {
  const healthRouter = await import('./src/routes/health.router.js');
  console.log('✓ Imported health router');
  app.use('/health', healthRouter.default);
  console.log('✓ Mounted /health');
} catch (error) {
  console.error('✗ Failed to import/mount health router:', error.message);
}

try {
  const systemsRouter = await import('./src/routes/systems.router.js');
  console.log('✓ Imported systems router');
  app.use('/systems', systemsRouter.default);
  console.log('✓ Mounted /systems');
} catch (error) {
  console.error('✗ Failed to import/mount systems router:', error.message);
}

try {
  const chatRouter = await import('./src/routes/chat/index.js');
  console.log('✓ Imported chat router');
  app.use('/chat/enhanced', chatRouter.default);
  console.log('✓ Mounted /chat/enhanced');
} catch (error) {
  console.error('✗ Failed to import/mount chat router:', error.message);
}

try {
  const adminRouter = await import('./src/routes/admin/index.js');
  console.log('✓ Imported admin router');
  app.use('/admin', adminRouter.default);
  console.log('✓ Mounted /admin');
} catch (error) {
  console.error('✗ Failed to import/mount admin router:', error.message);
}

try {
  const documentRouter = await import('./src/routes/document/index.js');
  console.log('✓ Imported document router');
  app.use('/admin/docs', documentRouter.default);
  console.log('✓ Mounted /admin/docs');
} catch (error) {
  console.error('✗ Failed to import/mount document router:', error.message);
}

try {
  const pineconeRouter = await import('./src/routes/pinecone.router.js');
  console.log('✓ Imported pinecone router');
  app.use('/pinecone', pineconeRouter.default);
  console.log('✓ Mounted /pinecone');
} catch (error) {
  console.error('✗ Failed to import/mount pinecone router:', error.message);
}

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Debug route to list all mounted routes
app.get('/debug/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      // Routes registered directly on the app
      routes.push({
        path: middleware.route.path,
        methods: Object.keys(middleware.route.methods)
      });
    } else if (middleware.name === 'router') {
      // Router middleware
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          routes.push({
            path: middleware.regexp.source + handler.route.path,
            methods: Object.keys(handler.route.methods)
          });
        }
      });
    }
  });
  res.json({ routes });
});

// Start server
const startServer = () => {
  const env = getEnv();
  const port = env.PORT || 3000;
  
  app.listen(port, () => {
    console.log('Express server started on port', port);
    console.log('Available routes:');
    console.log('- GET /test');
    console.log('- GET /health');
    console.log('- GET /systems');
    console.log('- GET /systems/search');
    console.log('- GET /systems/:assetUid');
    console.log('- GET /debug/routes');
  });
};

// Start the server
startServer();

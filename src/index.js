import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { adminGate } from './middleware/admin.js';

// Import all Express routers
import healthRouter from './routes/health.router.js';
import systemsRouter from './routes/systems.router.js';
import chatRouter from './routes/chat.router.js';
import adminRouter from './routes/admin.router.js';
import documentRouter from './routes/document.router.js';
import pineconeRouter from './routes/pinecone.router.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Express app
const app = express();

// Security middleware
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

// Serve admin.html for /admin route (must come before admin router)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes
app.use('/health', healthRouter);
app.use('/systems', systemsRouter);
app.use('/chat/enhanced', chatRouter);
app.use('/admin', adminRouter);
app.use('/admin/docs', documentRouter);
app.use('/pinecone', pineconeRouter);

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const port = process.env.PORT || 3000;
const startServer = () => {
  app.listen(port, () => {
    console.log(`🚀 Express server running on port ${port}`);
    console.log(`📊 Routes available:`);
    console.log(`   ✅ Health: http://localhost:${port}/health`);
    console.log(`   ✅ Systems: http://localhost:${port}/systems`);
    console.log(`   ✅ Chat: http://localhost:${port}/chat/enhanced`);
    console.log(`   ✅ Admin: http://localhost:${port}/admin`);
    console.log(`   ✅ Documents: http://localhost:${port}/admin/docs`);
    console.log(`   ✅ Pinecone: http://localhost:${port}/pinecone`);
    console.log(`🔒 Admin gate: x-admin-token: admin-secret-key`);
    logger.info('Express server started', { port });
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



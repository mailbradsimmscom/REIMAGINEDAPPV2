import 'dotenv/config';
import { createServer } from 'node:http';
import { healthRoute } from './routes/health.route.js';
import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { debugTablesRoute } from './routes/debug.tables.route.js';
import { debugEnvRoute } from './routes/debug.env.route.js';
import { debugTableCheckRoute } from './routes/debug.tableCheck.route.js';
import { systemsListRoute, systemsGetRoute, systemsSearchRoute } from './routes/systems.routes.js';
import { chatProcessMessageRoute, chatGetHistoryRoute, chatListChatsRoute, chatGetContextRoute } from './routes/chat.routes.js';
import { adminDashboardRoute, adminHealthRoute, adminLogsRoute, adminSystemsRoute, adminManufacturersRoute, adminModelsRoute, adminPineconeRoute } from './routes/admin.routes.js';
import { documentIngestRoute, documentJobStatusRoute, documentListJobsRoute, documentListDocumentsRoute, documentGetDocumentRoute } from './routes/document.routes.js';
import { logger } from './utils/logger.js';
import jobProcessor from './services/job.processor.js';

const server = createServer(async (req, res) => {
  const requestLogger = logger.createRequestLogger();
  const startTime = Date.now();
  
  try {
    requestLogger.info('HTTP request received', { 
      method: req.method, 
      url: req.url,
      userAgent: req.headers['user-agent']?.substring(0, 100)
    });
    
    // Serve static files (CSS and JS)
    if (req.method === 'GET' && (req.url.startsWith('/styles.css') || req.url.startsWith('/app.js'))) {
      const fileName = req.url.substring(1); // Remove leading slash
      const filePath = join(process.cwd(), 'src/public', fileName);
      try {
        const content = await fs.readFile(filePath);
        const ext = extname(filePath);
        const contentType = {
          '.css': 'text/css',
          '.js': 'text/javascript'
        }[ext] || 'text/plain';
        
        res.setHeader('content-type', contentType);
        res.end(content);
        return;
      } catch (error) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }
    }

    // Serve index.html for root path
    if (req.url === '/' || req.url === '/index.html') {
      try {
        const content = await fs.readFile(join(process.cwd(), 'src/public/index.html'));
        res.setHeader('content-type', 'text/html');
        res.end(content);
        return;
      } catch (error) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'index.html not found' }));
        return;
      }
    }

    if (req.url === '/health' && req.method === 'GET') {
      return healthRoute(req, res);
    }

    // Development-only debug routes
    if (process.env.NODE_ENV !== 'production') {
      if (req.url === '/debug/tables' && req.method === 'GET') {
        return debugTablesRoute(req, res);
      }

      if (req.url === '/debug/env' && req.method === 'GET') {
        return debugEnvRoute(req, res);
      }

      if (req.url.startsWith('/debug/table') && req.method === 'GET') {
        return debugTableCheckRoute(req, res);
      }


    }

    // Systems routes
    if (req.url.startsWith('/systems/search') && req.method === 'GET') {
      return systemsSearchRoute(req, res);
    }

    if (req.url === '/systems' && req.method === 'GET') {
      return systemsListRoute(req, res);
    }

    if (req.url.startsWith('/systems/') && req.method === 'GET') {
      return systemsGetRoute(req, res);
    }

    // Chat routes
    if (req.url === '/chat/process' && req.method === 'POST') {
      return chatProcessMessageRoute(req, res);
    }

    if (req.url.startsWith('/chat/history') && req.method === 'GET') {
      return chatGetHistoryRoute(req, res);
    }

    if (req.url.startsWith('/chat/list') && req.method === 'GET') {
      return chatListChatsRoute(req, res);
    }

    if (req.url.startsWith('/chat/context') && req.method === 'GET') {
      return chatGetContextRoute(req, res);
    }

    // Admin routes
    if (req.url === '/admin' && req.method === 'GET') {
      return adminDashboardRoute(req, res);
    }

    if (req.url === '/admin/health' && req.method === 'GET') {
      return adminHealthRoute(req, res);
    }

    if (req.url === '/admin/logs' && req.method === 'GET') {
      return adminLogsRoute(req, res);
    }

    if (req.url === '/admin/systems' && req.method === 'GET') {
      return adminSystemsRoute(req, res);
    }

    if (req.url === '/admin/systems/manufacturers' && req.method === 'GET') {
      return adminManufacturersRoute(req, res);
    }

    if (req.url.startsWith('/admin/systems/models') && req.method === 'GET') {
      return adminModelsRoute(req, res);
    }

    if (req.url === '/admin/pinecone' && req.method === 'GET') {
      return adminPineconeRoute(req, res);
    }

    // Document processing routes
    if (req.url === '/admin/docs/ingest' && req.method === 'POST') {
      return documentIngestRoute(req, res);
    }

    if (req.url.startsWith('/admin/docs/ingest/') && req.method === 'GET') {
      return documentJobStatusRoute(req, res);
    }

    if (req.url.startsWith('/admin/docs/jobs') && req.method === 'GET') {
      return documentListJobsRoute(req, res);
    }

    if (req.url.startsWith('/admin/docs/documents') && req.method === 'GET') {
      return documentListDocumentsRoute(req, res);
    }

    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Not Found' }));
    
    requestLogger.warn('404 Not Found', { url: req.url });
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
    
    requestLogger.error('Internal Server Error', { 
      error: error.message,
      url: req.url,
      stack: error.stack
    });
  } finally {
    const duration = Date.now() - startTime;
    requestLogger.performance('http_request', duration, { 
      method: req.method, 
      url: req.url,
      statusCode: res.statusCode
    });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
server.listen(port, async () => {
  await logger.info('Server started', { 
    port, 
    environment: process.env.NODE_ENV || 'development',
    version: process.env.APP_VERSION || '1.0.0'
  });
  
  // Start the job processor
  try {
    await jobProcessor.start();
    await logger.info('Job processor started');
  } catch (error) {
    await logger.error('Failed to start job processor', { error: error.message });
  }
});

export default server;



import 'dotenv/config';
import { createServer } from 'node:http';
import { healthRoute } from './routes/health.route.js';
import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { debugTablesRoute } from './routes/debug.tables.route.js';
import { debugEnvRoute } from './routes/debug.env.route.js';
import { debugTableCheckRoute } from './routes/debug.tableCheck.route.js';
import { debugPineconeRoute } from './routes/debug.pinecone.route.js';
import { systemsListRoute, systemsGetRoute, systemsSearchRoute } from './routes/systems.routes.js';

const server = createServer(async (req, res) => {
  try {
    // Serve static files
    if (req.method === 'GET') {
      const url = req.url === '/' ? '/index.html' : req.url;
      const filePath = join(process.cwd(), 'src', 'public', url);
      try {
        const data = await fs.readFile(filePath);
        const ext = extname(filePath);
        const contentType = ext === '.html' ? 'text/html; charset=utf-8'
          : ext === '.css' ? 'text/css; charset=utf-8'
          : ext === '.js' ? 'text/javascript; charset=utf-8'
          : ext === '.png' ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : 'application/octet-stream';
        res.statusCode = 200;
        res.setHeader('content-type', contentType);
        res.end(data);
        return;
      } catch {}
    }

    if (req.url === '/health' && req.method === 'GET') {
      return healthRoute(req, res);
    }

    if (req.url === '/debug/tables' && req.method === 'GET') {
      return debugTablesRoute(req, res);
    }

    if (req.url === '/debug/env' && req.method === 'GET') {
      return debugEnvRoute(req, res);
    }

    if (req.url.startsWith('/debug/table') && req.method === 'GET') {
      return debugTableCheckRoute(req, res);
    }

    if (req.url.startsWith('/debug/pinecone') && req.method === 'GET') {
      return debugPineconeRoute(req, res);
    }

    if (req.url.startsWith('/systems/search') && req.method === 'GET') {
      return systemsSearchRoute(req, res);
    }

    if (req.url === '/systems' && req.method === 'GET') {
      return systemsListRoute(req, res);
    }

    if (req.url.startsWith('/systems/') && req.method === 'GET') {
      return systemsGetRoute(req, res);
    }

    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Not Found' }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
server.listen(port, () => {
  // No console.log in production code; basic startup without logs
});

export default server;



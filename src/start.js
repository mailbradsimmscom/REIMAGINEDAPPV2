import app from './index.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

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
        pinecone: `http://localhost:${env.port}/pinecone`
      }
    });
  });
};

// Start the server
startServer();



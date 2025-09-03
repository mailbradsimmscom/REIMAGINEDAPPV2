import app from './index.js';
import { logger } from './utils/logger.js';

// Start server
const startServer = async () => {
  const { getEnv } = await import('./config/env.js');
  const env = getEnv();
  const port = env.PORT || 3000;
  
  app.listen(port, () => {
    logger.info('Express server started', { 
      port: port,
      routes: {
        health: `http://localhost:${port}/health`,
        systems: `http://localhost:${port}/systems`,
        chat: `http://localhost:${port}/chat/enhanced`,
        admin: `http://localhost:${port}/admin`,
        pinecone: `http://localhost:${port}/pinecone`
      }
    });
  });
};

// Start the server
startServer();



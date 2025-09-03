import app from './index.js';
import { getEnv } from './config/env.js';
import { logger } from './utils/logger.js';

// Start server
const startServer = () => {
  const env = getEnv({ loose: true });
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



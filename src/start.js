// src/start.js
import 'dotenv/config';
import app from './index.js';
import { getEnv } from './config/env.js';
import { logger } from './utils/logger.js';

function getPort() {
  const { PORT } = getEnv({ loose: true });
  const port = Number(PORT) || 3000;
  return Number.isFinite(port) ? port : 3000;
}

const port = getPort();
const server = app.listen(port, () => {
  logger.info(`Server listening on http://localhost:${port}`);
});

// Never call process.exit() here.
// Let the global error handler handle unexpected exceptions.
process.on('unhandledRejection', (err) => {
  logger.error('unhandledRejection', { message: err?.message });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { message: err?.message });
});

export default server;



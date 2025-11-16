// src/start.js
import 'dotenv/config';
import app from './index.js';
import { getEnv } from './config/env.js';
import { logger } from './utils/logger.js';
import { printRoutes } from './debug/printRoutes.js';
import { telegramBotService } from './services/telegram-bot.service.js';
import { anchorWatchAlertsService } from './services/anchor-watch-alerts.service.js';

function getPort() {
  const { PORT } = getEnv({ loose: true });
  const port = Number(PORT) || 3000;
  return Number.isFinite(port) ? port : 3000;
}

const port = getPort();

// Print routes after all routers are mounted
printRoutes(app, logger);

const server = app.listen(port, async () => {
  logger.info(`Server listening on http://localhost:${port}`);
  // Also print routes after listen to confirm final state
  printRoutes(app, logger);

  // Initialize Telegram bot if configured
  try {
    await telegramBotService.start();
    anchorWatchAlertsService.start();
    logger.info('Telegram bot and alerts initialized');
  } catch (error) {
    logger.warn('Telegram initialization failed (continuing without it)', { error: error.message });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await telegramBotService.stop();
  anchorWatchAlertsService.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await telegramBotService.stop();
  anchorWatchAlertsService.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
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



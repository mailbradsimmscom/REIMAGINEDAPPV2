// src/start.js
import 'dotenv/config';
import app from './index.js';
import { getEnv } from './config/env.js';
import { logger } from './utils/logger.js';
import { printRoutes } from './debug/printRoutes.js';
import { telegramBotService } from './services/telegram-bot.service.js';
import { dipTelegramBotService } from './services/dip-telegram-bot.service.js';
import { anchorWatchAlertsService } from './services/anchor-watch-alerts.service.js';
import { startWeatherCollector, stopWeatherCollector } from './services/trips/weather-collector.service.js';
import { startEdEmailScheduler, stopEdEmailScheduler } from './services/ed-email-scheduler.service.js';

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

  // Initialize background services
  const env = getEnv();

  // Weather collector runs in ALL environments
  try {
    startWeatherCollector();
    logger.info('Weather collector started');
  } catch (error) {
    logger.warn('Weather collector failed to start', { error: error.message });
  }

  // Ed email scheduler runs in ALL environments
  try {
    startEdEmailScheduler();
  } catch (error) {
    logger.warn('Ed email scheduler failed to start', { error: error.message });
  }

  // Other services run in PRODUCTION ONLY (prevents polling conflicts locally)
  if (env.NODE_ENV === 'production') {
    try {
      await telegramBotService.start();
      await dipTelegramBotService.start();
      anchorWatchAlertsService.start();
      logger.info('Background services initialized (production mode)');
    } catch (error) {
      logger.warn('Background service initialization failed (continuing without it)', { error: error.message });
    }
  } else {
    logger.info('Telegram/Anchor services disabled in development mode');
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  stopWeatherCollector();
  stopEdEmailScheduler();
  const env = getEnv();
  if (env.NODE_ENV === 'production') {
    await telegramBotService.stop();
    await dipTelegramBotService.stop();
    anchorWatchAlertsService.stop();
  }
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  stopWeatherCollector();
  stopEdEmailScheduler();
  const env = getEnv();
  if (env.NODE_ENV === 'production') {
    await telegramBotService.stop();
    await dipTelegramBotService.stop();
    anchorWatchAlertsService.stop();
  }
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



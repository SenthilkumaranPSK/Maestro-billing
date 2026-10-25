import pino from 'pino';

// Logger is provided by Fastify's built-in pino instance in routes.
// This utility logger is for standalone scripts/services.
export function createLogger(level = 'info') {
  const isDev = process.env.NODE_ENV === 'development';
  return pino({
    transport: isDev ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
    level: process.env.LOG_LEVEL ?? level,
  });
}

export const logger = createLogger();

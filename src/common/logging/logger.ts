import pino, { type DestinationStream, type Logger } from 'pino';

import type { AppConfig } from '../../config/env.js';

export function createLogger(
  config: Pick<AppConfig, 'logLevel'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: config.logLevel,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'request.headers.authorization',
        'request.headers.cookie',
        'req.headers.x-apisports-key',
        'request.headers.x-apisports-key',
        'apiKey',
        '*.apiKey',
        'SPORTS_API',
        'API_SPORTS_KEY',
        'password',
        '*.password',
        'passwordHash',
        '*.passwordHash',
        'accessToken',
        '*.accessToken',
        'refreshToken',
        '*.refreshToken',
        'refreshTokenHash',
        '*.refreshTokenHash',
        'token',
        '*.token',
        'tokenHash',
        '*.tokenHash',
      ],
      censor: '[REDACTED]',
    },
  };

  return destination === undefined ? pino(options) : pino(options, destination);
}

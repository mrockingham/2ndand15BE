import type { RequestHandler } from 'express';

export interface HealthControllerOptions {
  readonly now?: () => Date;
  readonly uptime?: () => number;
}

export function createHealthController(options: HealthControllerOptions = {}): RequestHandler {
  const now = options.now ?? (() => new Date());
  const uptime = options.uptime ?? (() => process.uptime());

  return (_request, response) => {
    response.status(200).json({
      data: {
        status: 'ok',
        timestamp: now().toISOString(),
        uptimeSeconds: uptime(),
      },
    });
  };
}

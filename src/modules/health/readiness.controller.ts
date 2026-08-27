import type { RequestHandler } from 'express';

export interface ReadinessControllerOptions {
  /** Should resolve true/false, or reject -- either failure path is treated
   * as "not ready". Must be a single lightweight query (e.g. SELECT 1), never
   * an external provider call (Highlightly/Resend) -- see Part 29. */
  readonly checkDatabase: () => Promise<boolean>;
}

/** GET /ready -- readiness probe distinct from GET /health (liveness). Never
 * fails liveness just because a dependency is down; this endpoint is the one
 * that's allowed to report non-200 when the DB is unreachable. */
export function createReadinessController(options: ReadinessControllerOptions): RequestHandler {
  return async (_request, response) => {
    let databaseOk: boolean;
    try {
      databaseOk = await options.checkDatabase();
    } catch {
      databaseOk = false;
    }

    response.status(databaseOk ? 200 : 503).json({
      data: {
        status: databaseOk ? 'ok' : 'degraded',
        checks: { database: databaseOk },
      },
    });
  };
}

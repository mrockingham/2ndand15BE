import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import type { Logger } from 'pino';

import { createPrismaClient } from '../common/database/prisma.js';
import { createLogger } from '../common/logging/logger.js';
import { loadCurrentGameSyncConfig } from '../config/env.js';
import { buildCurrentGamePoller } from '../modules/sports/build-current-game-poller.js';
import type { PollerCycleReport } from '../modules/sports/current-game-poller.js';

/**
 * Long-running production worker for the current-game live poller. Unlike
 * src/commands/current-game-poller.ts (bounded, requires --once or
 * --durationMinutes), this process loops indefinitely until it receives
 * SIGTERM/SIGINT, and never crashes on a single failed cycle -- see
 * docs/production/live-game-worker.md.
 *
 * Multi-instance safety (e.g. old+new process briefly overlapping during a
 * deploy) is inherited unchanged from CurrentGamePoller's DB claim/lease
 * locking (CurrentGamePollState.lockedAt/lockedBy) -- this file adds no
 * locking of its own.
 */

interface ShutdownSignal {
  readonly requested: () => boolean;
  readonly wait: () => Promise<void>;
}

export function createShutdownSignal(logger: Logger): ShutdownSignal {
  let requested = false;
  const waiters: (() => void)[] = [];

  const trigger = (signal: NodeJS.Signals): void => {
    if (requested) return;
    requested = true;
    logger.info({ signal }, 'current-game-worker received shutdown signal');
    for (const resolve of waiters.splice(0)) resolve();
  };

  process.on('SIGTERM', () => {
    trigger('SIGTERM');
  });
  process.on('SIGINT', () => {
    trigger('SIGINT');
  });

  return {
    requested: () => requested,
    wait: () =>
      new Promise((resolve) => {
        if (requested) {
          resolve();
          return;
        }
        waiters.push(resolve);
      }),
  };
}

/** Sleeps `ms`, but resolves early if shutdown is requested mid-sleep. */
export async function interruptibleSleep(ms: number, shutdown: ShutdownSignal): Promise<void> {
  await Promise.race([new Promise<void>((resolve) => setTimeout(resolve, ms)), shutdown.wait()]);
}

function summarizeCycle(report: PollerCycleReport): Record<string, unknown> {
  const providerRequests = report.ticks.reduce((sum, tick) => sum + tick.requestUsageDelta, 0);
  return {
    durationMs: report.durationMs,
    candidatesDiscovered: report.candidatesDiscovered,
    claimed: report.claimed,
    degraded: report.degraded,
    providerRequests,
    boxScoreRequests: report.ticks.reduce(
      (sum, tick) => sum + tick.playerStats.boxScoreRequests,
      0,
    ),
    playerStats: report.ticks.map((tick) => ({
      gameId: tick.gameId,
      attempted: tick.playerStats.attempted,
      ok: tick.playerStats.ok,
      received: tick.playerStats.received,
      persisted: tick.playerStats.persisted,
      unresolved: tick.playerStats.unresolved,
      coverage: tick.playerStats.coverage,
      nextPollAt: tick.playerStats.nextPollAt,
    })),
  };
}

export async function main(): Promise<void> {
  const config = loadCurrentGameSyncConfig();
  const logger = createLogger(config);

  if (!config.currentGame.poller.enabled) {
    logger.error(
      'CURRENT_GAME_POLLER_ENABLED is false. Refusing to start the live-game worker -- ' +
        'set CURRENT_GAME_POLLER_ENABLED=true to run broad polling in production.',
    );
    process.exitCode = 1;
    return;
  }

  const prisma = createPrismaClient(config.databaseUrl);
  const shutdown = createShutdownSignal(logger);

  try {
    const { poller, workerId } = buildCurrentGamePoller(config, logger, prisma);
    logger.info({ workerId }, 'current-game-worker started');

    const cycleOptions = {
      schedulingConfig: {
        pregamePollSeconds: config.currentGame.poller.pregamePollSeconds,
        livePollSeconds: config.currentGame.poller.livePollSeconds,
        featuredPollSeconds: config.currentGame.poller.featuredPollSeconds,
        halftimePollSeconds: config.currentGame.poller.halftimePollSeconds,
        finalReconcile10Minutes: config.currentGame.poller.finalReconcile10Minutes,
        finalReconcile60Minutes: config.currentGame.poller.finalReconcile60Minutes,
      },
      policy: {
        nodeEnv: config.nodeEnv,
        evaluationMode: config.currentGame.evaluationMode,
        publicationApproved: config.currentGame.publicationApproved,
      },
      lockLeaseSeconds: config.currentGame.poller.lockLeaseSeconds,
      batchSize: config.currentGame.poller.batchSize,
      rateLimitDegradeThreshold: config.currentGame.poller.rateLimitDegradeThreshold,
      playerStatsPollSeconds: config.currentGame.poller.playerStatsPollSeconds,
    };
    const heartbeatMs = config.currentGame.poller.heartbeatSeconds * 1_000;

    while (!shutdown.requested()) {
      try {
        const report = await poller.runCycle(cycleOptions);
        logger.info(summarizeCycle(report), 'current-game-worker cycle completed');
      } catch (error: unknown) {
        logger.error(
          { message: error instanceof Error ? error.message : 'Unknown error' },
          'current-game-worker cycle failed; will retry after the normal heartbeat delay',
        );
      }

      if (shutdown.requested()) break;
      await interruptibleSleep(heartbeatMs, shutdown);
    }

    logger.info('current-game-worker shutting down');
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => {
      process.exitCode ??= 0;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({
          error: {
            message:
              error instanceof Error ? error.message : 'current-game-worker failed to start.',
          },
        })}\n`,
      );
      process.exitCode = 1;
    });
}

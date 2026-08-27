import 'dotenv/config';

import { z } from 'zod';

import { createPrismaClient } from '../common/database/prisma.js';
import { createLogger } from '../common/logging/logger.js';
import { loadCurrentGameSyncConfig } from '../config/env.js';
import { buildCurrentGamePoller } from '../modules/sports/build-current-game-poller.js';

interface Args {
  readonly once: boolean;
  readonly durationMinutes: number | null;
  readonly gameId: string | null;
  readonly dryRun: boolean;
}

let prisma: ReturnType<typeof createPrismaClient> | undefined;

try {
  const args = parseArgs(process.argv.slice(2));
  const config = loadCurrentGameSyncConfig();
  const policy = {
    nodeEnv: config.nodeEnv,
    evaluationMode: config.currentGame.evaluationMode,
    publicationApproved: config.currentGame.publicationApproved,
  };
  if (!config.currentGame.poller.enabled && !args.dryRun && args.gameId === null) {
    throw new Error(
      'CURRENT_GAME_POLLER_ENABLED is false. Broad polling is disabled by default; use --dry-run to preview, ' +
        '--gameId=<uuid> to debug one reviewed game, or set CURRENT_GAME_POLLER_ENABLED=true to run for real.',
    );
  }

  const logger = createLogger(config);
  prisma = createPrismaClient(config.databaseUrl);
  const { poller } = buildCurrentGamePoller(config, logger, prisma);

  const cycleOptions = {
    schedulingConfig: {
      pregamePollSeconds: config.currentGame.poller.pregamePollSeconds,
      livePollSeconds: config.currentGame.poller.livePollSeconds,
      featuredPollSeconds: config.currentGame.poller.featuredPollSeconds,
      halftimePollSeconds: config.currentGame.poller.halftimePollSeconds,
      finalReconcile10Minutes: config.currentGame.poller.finalReconcile10Minutes,
      finalReconcile60Minutes: config.currentGame.poller.finalReconcile60Minutes,
    },
    policy,
    lockLeaseSeconds: config.currentGame.poller.lockLeaseSeconds,
    batchSize: config.currentGame.poller.batchSize,
    rateLimitDegradeThreshold: config.currentGame.poller.rateLimitDegradeThreshold,
    ...(args.gameId === null ? {} : { onlyGameId: args.gameId }),
    dryRun: args.dryRun,
  };

  const endAt = args.durationMinutes === null ? null : Date.now() + args.durationMinutes * 60_000;
  let interrupted = false;
  process.on('SIGINT', () => {
    interrupted = true;
  });
  const isInterrupted = (): boolean => interrupted;

  const reports = [];
  for (;;) {
    const report = await poller.runCycle(cycleOptions);
    reports.push(report);
    process.stdout.write(
      `${JSON.stringify({
        startedAt: report.startedAt,
        durationMs: report.durationMs,
        candidatesDiscovered: report.candidatesDiscovered,
        claimed: report.claimed,
        degraded: report.degraded,
        rateLimitObservation: report.rateLimitObservation,
        dryRunPreview: report.dryRunPreview,
        ticks: report.ticks.map((tick) => ({
          gameId: tick.gameId,
          class: `${tick.schedulingClassBefore}->${tick.schedulingClassAfter}`,
          featuredReason: tick.featuredReason,
          nextPollAt: tick.nextPollAt,
          requests: tick.requestUsageDelta,
          gameStateOk: tick.gameState.ok,
          teamStatsOk: tick.teamStats.ok,
          teamStatsClassification: tick.teamStats.classification,
          playsOk: tick.plays.ok,
          playsInsertedUpdatedUnchanged: [
            tick.plays.inserted,
            tick.plays.updated,
            tick.plays.unchanged,
          ],
          playsStoredTotal: tick.plays.storedTotal,
          playsBlocked: tick.plays.blocked,
          playsFinalReplacementStatus: tick.plays.finalReplacementStatus,
          highlightsAttempted: tick.highlights.attempted,
          highlightsOk: tick.highlights.ok,
          highlightsCoverage: tick.highlights.coverage,
        })),
      })}\n`,
    );
    if (args.once || endAt === null) break;
    if (isInterrupted() || Date.now() >= endAt) break;
    const remainingMs = endAt - Date.now();
    const sleepMs = Math.max(
      0,
      Math.min(config.currentGame.poller.heartbeatSeconds * 1_000, remainingMs),
    );
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
    if (isInterrupted()) break;
  }

  const totalRequests = reports.reduce(
    (total, report) => total + report.ticks.reduce((sum, tick) => sum + tick.requestUsageDelta, 0),
    0,
  );
  process.stdout.write(
    `${JSON.stringify({
      summary: {
        cycles: reports.length,
        totalTicks: reports.reduce((total, report) => total + report.ticks.length, 0),
        totalProviderRequests: totalRequests,
      },
    })}\n`,
  );
} catch (error: unknown) {
  process.stderr.write(
    `${JSON.stringify({
      error: { message: error instanceof Error ? error.message : 'Poller run failed.' },
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}

function parseArgs(argv: readonly string[]): Args {
  const value = (name: string): string | undefined =>
    argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
  const hasFlag = (name: string): boolean => argv.includes(`--${name}`);

  const once = hasFlag('once');
  const durationRaw = value('durationMinutes');
  let durationMinutes: number | null = null;
  if (durationRaw !== undefined) {
    const duration = z.coerce.number().int().min(1).max(600).safeParse(durationRaw);
    if (!duration.success)
      throw new Error('--durationMinutes must be an integer between 1 and 600.');
    durationMinutes = duration.data;
  }
  if (!once && durationMinutes === null) {
    throw new Error('Use --once for a single bounded cycle, or --durationMinutes=<n> to loop.');
  }

  const gameIdRaw = value('gameId');
  let gameId: string | null = null;
  if (gameIdRaw !== undefined) {
    const parsed = z.uuid().safeParse(gameIdRaw);
    if (!parsed.success) throw new Error('--gameId must be a valid UUID.');
    gameId = parsed.data;
  }

  return { once, durationMinutes, gameId, dryRun: hasFlag('dry-run') };
}

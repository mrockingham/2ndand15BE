import 'dotenv/config';

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { z } from 'zod';

import { createPrismaClient } from '../common/database/prisma.js';
import { createLogger } from '../common/logging/logger.js';
import { loadCurrentGameSyncConfig } from '../config/env.js';
import { PrismaCurrentGameSyncRepository } from '../modules/sports/current-game-sync.repository.js';
import { PrismaCurrentGameDetailsRepository } from '../modules/sports/current-game-details.repository.js';
import { PrismaCurrentGamePlayRepository } from '../modules/sports/current-game-play.repository.js';
import {
  HighlightlyEvaluationError,
  HighlightlyEvaluationHttpClient,
} from '../modules/sports/evaluation/highlightly/highlightly-http-client.js';
import {
  highlightlyDetailedMatchSchema,
  highlightlyRawMatchDetailResponseSchema,
} from '../modules/sports/evaluation/highlightly/highlightly-schemas.js';
import {
  runLiveValidationTick,
  type MatchDetailFetcher,
  type TickRecord,
} from '../modules/sports/live-game-validation.js';
import { HighlightlyCurrentGameDetailsProvider } from '../modules/sports/providers/highlightly/highlightly-current-game-details-provider.js';
import { HighlightlyCurrentGamePlayProvider } from '../modules/sports/providers/highlightly/highlightly-current-game-play-provider.js';
import { HighlightlyCurrentGameProvider } from '../modules/sports/providers/highlightly/highlightly-current-game-provider.js';
import { CurrentGameDetailsSyncService } from '../modules/sports/sync-current-game-details.js';
import {
  CurrentGameSyncError,
  CurrentGameSyncService,
} from '../modules/sports/sync-current-games.js';
import type { GamePlay } from '../generated/prisma/client.js';

interface Args {
  readonly gameId: string;
  readonly output: string;
  readonly intervalSeconds: number;
  readonly durationMinutes: number | null;
  readonly apply: boolean;
  readonly marker: string | undefined;
}

const CONSECUTIVE_AUTH_OR_RATE_LIMIT_STOP_THRESHOLD = 3;

let prisma: ReturnType<typeof createPrismaClient> | undefined;

try {
  const args = parseArgs(process.argv.slice(2));
  ensureOutputDirectory(args.output);

  if (args.marker !== undefined) {
    appendLine(args.output, {
      type: 'marker',
      localTimestamp: new Date().toISOString(),
      note: args.marker,
    });
    process.stdout.write(`${JSON.stringify({ recorded: args.marker, output: args.output })}\n`);
    process.exit(0);
  }

  const config = loadCurrentGameSyncConfig();
  const policy = {
    nodeEnv: config.nodeEnv,
    evaluationMode: config.currentGame.evaluationMode,
    publicationApproved: config.currentGame.publicationApproved,
  };
  if (args.apply && !policy.publicationApproved) {
    throw new Error(
      '--apply requires HIGHLIGHTLY_PUBLICATION_APPROVED=true. Refusing to write to core Game/CurrentGameTeamStat tables from a diagnostic run.',
    );
  }

  const logger = createLogger(config);
  prisma = createPrismaClient(config.databaseUrl);
  const client = new HighlightlyEvaluationHttpClient({
    baseUrl: config.currentGame.highlightly.baseUrl,
    apiKey: config.currentGame.highlightly.apiKey,
    requestTimeoutMs: config.currentGame.highlightly.requestTimeoutMs,
    maxRetries: config.currentGame.highlightly.maxRetries,
    logger,
  });

  const matchDetailFetcher: MatchDetailFetcher = {
    async fetch(providerGameId) {
      const payload = await client.get(
        `/matches/${providerGameId}`,
        {},
        highlightlyRawMatchDetailResponseSchema,
      );
      const parsed = highlightlyDetailedMatchSchema.safeParse(payload[0]);
      if (!parsed.success || String(parsed.data.id) !== providerGameId) {
        return { detail: null, failureReason: 'Detailed match failed validation.' };
      }
      return { detail: parsed.data, failureReason: null };
    },
  };

  const deps = {
    gameSyncService: new CurrentGameSyncService(
      new HighlightlyCurrentGameProvider(client),
      new PrismaCurrentGameSyncRepository(prisma),
    ),
    detailsService: new CurrentGameDetailsSyncService(
      new HighlightlyCurrentGameDetailsProvider(client),
      new PrismaCurrentGameDetailsRepository(prisma),
    ),
    playProvider: new HighlightlyCurrentGamePlayProvider(client),
    playRepository: new PrismaCurrentGamePlayRepository(prisma),
    matchDetailFetcher,
    requestCounter: client,
    rateLimitObservation: () => client.getRateLimitObservation(),
    now: () => new Date(),
  };

  appendLine(args.output, {
    type: 'run_start',
    localTimestamp: new Date().toISOString(),
    gameId: args.gameId,
    intervalSeconds: args.intervalSeconds,
    durationMinutes: args.durationMinutes,
    apply: args.apply,
  });

  let previousPlays: readonly GamePlay[] = [];
  const firstObservedAt = new Map<string, string>();
  let tickIndex = 0;
  let consecutiveAuthOrRateLimit = 0;
  const requestDurations: number[] = [];
  let operationsAttempted = 0;
  let operationsFailed = 0;
  let rateLimited = 0;
  let timedOut = 0;
  let providerHttpRequestsTotal = 0;

  let interrupted = false;
  process.on('SIGINT', () => {
    interrupted = true;
  });
  const isInterrupted = (): boolean => interrupted;

  const endAt = args.durationMinutes === null ? null : Date.now() + args.durationMinutes * 60_000;
  let stopReason = 'SINGLE_TICK_COMPLETE';

  for (;;) {
    tickIndex += 1;
    let record: TickRecord;
    try {
      const result = await runLiveValidationTick(deps, {
        gameId: args.gameId,
        apply: args.apply,
        policy,
        tickIndex,
        previousPlays,
        firstObservedAt,
      });
      record = result.record;
      previousPlays = result.syntheticPlays;
    } catch (error: unknown) {
      const providerError = error instanceof HighlightlyEvaluationError ? error : null;
      const syncError = error instanceof CurrentGameSyncError ? error : null;
      const message =
        syncError?.message ??
        providerError?.message ??
        (error instanceof Error ? error.message : 'Unknown diagnostic tick failure.');
      const category = syncError?.code ?? providerError?.code ?? 'FATAL';
      appendLine(args.output, {
        type: 'tick_fatal',
        tickIndex,
        localTimestamp: new Date().toISOString(),
        category,
        message,
      });
      process.stderr.write(`${JSON.stringify({ tickIndex, category, message })}\n`);
      if (category === 'GAME_NOT_FOUND' || category === 'GAME_PROVIDER_MAPPING_REQUIRED') {
        stopReason = `FATAL_${category}`;
        break;
      }
      stopReason = category;
      if (!shouldContinueAfterTick(endAt, isInterrupted())) break;
      await sleepUntilNextTick(endAt, args.intervalSeconds);
      if (isInterrupted()) {
        stopReason = 'INTERRUPTED';
        break;
      }
      continue;
    }

    appendLine(args.output, record);
    providerHttpRequestsTotal += record.requestUsageDelta;
    for (const step of [record.gameState.outcome, record.teamStats.outcome, record.plays.outcome]) {
      if (!step.attempted) continue;
      operationsAttempted += 1;
      if (step.durationMs !== null) requestDurations.push(step.durationMs);
      if (!step.ok) {
        operationsFailed += 1;
        if (step.errorCategory === 'RATE_LIMITED') rateLimited += 1;
        if (step.errorCategory === 'REQUEST_TIMEOUT') timedOut += 1;
      }
    }
    const authOrRateLimited = [
      record.gameState.outcome,
      record.teamStats.outcome,
      record.plays.outcome,
    ].some(
      (step) =>
        step.errorCategory === 'AUTHENTICATION_FAILED' || step.errorCategory === 'RATE_LIMITED',
    );
    consecutiveAuthOrRateLimit = authOrRateLimited ? consecutiveAuthOrRateLimit + 1 : 0;

    printProgress(record);

    if (consecutiveAuthOrRateLimit >= CONSECUTIVE_AUTH_OR_RATE_LIMIT_STOP_THRESHOLD) {
      stopReason = 'REPEATED_AUTH_OR_RATE_LIMIT_FAILURE';
      break;
    }
    if (!shouldContinueAfterTick(endAt, isInterrupted())) break;
    await sleepUntilNextTick(endAt, args.intervalSeconds);
    if (isInterrupted()) {
      stopReason = 'INTERRUPTED';
      break;
    }
  }

  const summary = {
    totalTicks: tickIndex,
    providerHttpRequestsTotal,
    providerHttpRequestsPerTick:
      tickIndex === 0 ? null : rounded(providerHttpRequestsTotal / tickIndex),
    operationsAttempted,
    operationsFailed,
    rateLimited,
    timedOut,
    durationMs:
      requestDurations.length === 0
        ? null
        : {
            avg: average(requestDurations),
            p50: percentile(requestDurations, 50),
            p95: percentile(requestDurations, 95),
            max: Math.max(...requestDurations),
          },
    stopReason,
  };
  appendLine(args.output, {
    type: 'run_end',
    localTimestamp: new Date().toISOString(),
    reason: stopReason,
    summary,
  });
  process.stdout.write(`${JSON.stringify({ output: args.output, summary }, null, 2)}\n`);
} catch (error: unknown) {
  process.stderr.write(
    `${JSON.stringify({
      error: {
        message: error instanceof Error ? error.message : 'Live validation failed.',
      },
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}

function shouldContinueAfterTick(endAt: number | null, interrupted: boolean): boolean {
  if (endAt === null) return false;
  if (interrupted) return false;
  return Date.now() < endAt;
}

async function sleepUntilNextTick(endAt: number | null, intervalSeconds: number): Promise<void> {
  if (endAt === null) return;
  const remainingMs = endAt - Date.now();
  const sleepMs = Math.max(0, Math.min(intervalSeconds * 1_000, remainingMs));
  await new Promise((resolve) => setTimeout(resolve, sleepMs));
}

function printProgress(record: TickRecord): void {
  const g = record.gameState;
  const p = record.plays;
  process.stdout.write(
    `[tick ${String(record.tickIndex)}] ${record.localRequestTimestamp} status=${g.providerStatus ?? 'unknown'} ` +
      `score=${String(g.homeScore)}-${String(g.awayScore)} q=${String(g.period)} clock=${g.clock ?? ''} ` +
      `plays=${String(p.normalizedPlayCount)} new=${String(p.newlyObservedThisTick.length)} ` +
      `gameStateOk=${String(g.outcome.ok)} teamStatsOk=${String(record.teamStats.outcome.ok)} playsOk=${String(p.outcome.ok)}\n`,
  );
}

function appendLine(path: string, value: unknown): void {
  appendFileSync(path, `${JSON.stringify(value)}\n`, { encoding: 'utf8' });
}

function ensureOutputDirectory(path: string): void {
  const directory = dirname(path);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
}

function average(values: readonly number[]): number {
  return rounded(values.reduce((total, value) => total + value, 0) / values.length);
}

function percentile(values: readonly number[], percentileRank: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileRank / 100) * sorted.length) - 1);
  return rounded(sorted[Math.max(0, index)] ?? 0);
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseArgs(argv: readonly string[]): Args {
  const value = (name: string): string | undefined =>
    argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
  const hasFlag = (name: string): boolean => argv.includes(`--${name}`);

  const gameId = z.uuid().safeParse(value('gameId'));
  if (!gameId.success) throw new Error('A valid --gameId=<uuid> is required.');

  const output = value('output') ?? `var/live-validation/${gameId.data}.jsonl`;

  const intervalRaw = value('intervalSeconds');
  const interval = z.coerce.number().int().min(60).max(3_600).default(60).safeParse(intervalRaw);
  if (!interval.success) {
    throw new Error(
      '--intervalSeconds must be an integer of at least 60 (do not poll faster than once per minute).',
    );
  }

  const durationRaw = value('durationMinutes');
  let durationMinutes: number | null = null;
  if (durationRaw !== undefined) {
    const duration = z.coerce.number().int().min(1).max(600).safeParse(durationRaw);
    if (!duration.success)
      throw new Error('--durationMinutes must be an integer between 1 and 600.');
    durationMinutes = duration.data;
  }

  return {
    gameId: gameId.data,
    output,
    intervalSeconds: interval.data,
    durationMinutes,
    apply: hasFlag('apply'),
    marker: value('marker'),
  };
}

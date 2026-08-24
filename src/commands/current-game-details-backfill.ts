import 'dotenv/config';

import { z } from 'zod';

import { createPrismaClient } from '../common/database/prisma.js';
import { createLogger } from '../common/logging/logger.js';
import { loadCurrentGameSyncConfig } from '../config/env.js';
import { PrismaCurrentGameDetailsRepository } from '../modules/sports/current-game-details.repository.js';
import {
  HighlightlyEvaluationError,
  HighlightlyEvaluationHttpClient,
} from '../modules/sports/evaluation/highlightly/highlightly-http-client.js';
import { HighlightlyCurrentGameDetailsProvider } from '../modules/sports/providers/highlightly/highlightly-current-game-details-provider.js';
import { CurrentGameSyncError } from '../modules/sports/sync-current-games.js';
import { CurrentGameDetailsSyncService } from '../modules/sports/sync-current-game-details.js';

interface Args {
  readonly apply: boolean;
  readonly season: number | undefined;
  readonly seasonType: 'PRE' | 'REG' | 'POST' | undefined;
  readonly week: number | undefined;
  readonly limit: number | undefined;
  readonly force: boolean;
}

interface GameResult {
  readonly gameId: string;
  readonly matchup: string;
  readonly outcome: 'SYNCED' | 'SKIPPED' | 'FAILED';
  readonly reason?: string;
  readonly playerStats?: {
    readonly received: number;
    readonly matched: number;
    readonly unmatched: number;
    readonly ambiguous: number;
    readonly persisted: number;
  };
}

let prisma: ReturnType<typeof createPrismaClient> | undefined;

try {
  const args = parseArgs(process.argv.slice(2));
  const config = loadCurrentGameSyncConfig();
  const logger = createLogger(config);
  prisma = createPrismaClient(config.databaseUrl);
  const client = new HighlightlyEvaluationHttpClient({
    baseUrl: config.currentGame.highlightly.baseUrl,
    apiKey: config.currentGame.highlightly.apiKey,
    requestTimeoutMs: config.currentGame.highlightly.requestTimeoutMs,
    maxRetries: config.currentGame.highlightly.maxRetries,
    logger,
  });
  const provider = new HighlightlyCurrentGameDetailsProvider(client);
  const repository = new PrismaCurrentGameDetailsRepository(prisma);
  const service = new CurrentGameDetailsSyncService(provider, repository, undefined, provider);
  const policy = {
    nodeEnv: config.nodeEnv,
    evaluationMode: config.currentGame.evaluationMode,
    publicationApproved: config.currentGame.publicationApproved,
  };

  const candidates = await prisma.game.findMany({
    where: {
      league: 'NFL',
      status: 'FINAL',
      providerMaps: { some: { provider: 'highlightly' } },
      ...(args.season === undefined ? {} : { season: args.season }),
      ...(args.seasonType === undefined ? {} : { seasonType: args.seasonType }),
      ...(args.week === undefined ? {} : { week: args.week }),
      // Skip games that already have a coverage row (already attempted) unless --force.
      ...(args.force ? {} : { currentPlayerCoverage: null }),
    },
    select: {
      id: true,
      homeTeam: { select: { abbreviation: true } },
      awayTeam: { select: { abbreviation: true } },
    },
    orderBy: { startTime: 'asc' },
    ...(args.limit === undefined ? {} : { take: args.limit }),
  });

  process.stdout.write(
    `${JSON.stringify({
      startingBackfill: true,
      candidateCount: candidates.length,
      apply: args.apply,
      note: 'Each game takes roughly 1-3 minutes: Highlightly has no bulk player-profile endpoint, so profiles are fetched one at a time, paced ~1s apart. Ctrl+C stops cleanly after the game currently in progress finishes.',
    })}\n`,
  );

  let interrupted = false;
  process.on('SIGINT', () => {
    interrupted = true;
    process.stdout.write(
      `${JSON.stringify({ interrupting: 'Finishing the current game, then stopping.' })}\n`,
    );
  });
  const isInterrupted = (): boolean => interrupted;

  const results: GameResult[] = [];
  for (const [index, game] of candidates.entries()) {
    if (isInterrupted()) break;
    const matchup = `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`;
    process.stdout.write(
      `${JSON.stringify({ progress: `${String(index + 1)}/${String(candidates.length)}`, gameId: game.id, matchup, status: 'starting' })}\n`,
    );
    try {
      const report = await service.sync({ gameId: game.id, apply: args.apply, policy });
      results.push({
        gameId: game.id,
        matchup,
        outcome: 'SYNCED',
        playerStats: {
          received: report.playerStats.received,
          matched: report.playerStats.matched,
          unmatched: report.playerStats.unmatched,
          ambiguous: report.playerStats.ambiguous,
          persisted: report.playerStats.persisted,
        },
      });
      process.stdout.write(
        `${JSON.stringify({
          progress: `${String(index + 1)}/${String(candidates.length)}`,
          gameId: game.id,
          matchup,
          status: 'done',
          playerStats: results.at(-1)?.playerStats,
        })}\n`,
      );
    } catch (error: unknown) {
      const message = describeError(error);
      results.push({ gameId: game.id, matchup, outcome: 'FAILED', reason: message });
      process.stdout.write(
        `${JSON.stringify({ progress: `${String(index + 1)}/${String(candidates.length)}`, gameId: game.id, matchup, status: 'failed', reason: message })}\n`,
      );
    }
  }

  const summary = {
    dryRun: !args.apply,
    interrupted,
    candidatesFound: candidates.length,
    processed: results.length,
    synced: results.filter((result) => result.outcome === 'SYNCED').length,
    failed: results.filter((result) => result.outcome === 'FAILED').length,
    totalPlayersPersisted: results.reduce(
      (sum, result) => sum + (result.playerStats?.persisted ?? 0),
      0,
    ),
    totalPlayersUnresolved: results.reduce(
      (sum, result) => sum + (result.playerStats?.unmatched ?? 0),
      0,
    ),
    results,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error: unknown) {
  process.stderr.write(`${JSON.stringify({ error: { message: describeError(error) } })}\n`);
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}

function describeError(error: unknown): string {
  const providerError = error instanceof HighlightlyEvaluationError ? error : null;
  const syncError = error instanceof CurrentGameSyncError ? error : null;
  return (
    syncError?.message ??
    providerError?.message ??
    (error instanceof Error ? error.message : 'Backfill failed; inspect private operational logs.')
  );
}

function parseArgs(argv: readonly string[]): Args {
  const value = (name: string): string | undefined =>
    argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
  const hasFlag = (name: string): boolean => argv.includes(`--${name}`);

  const dryRun = hasFlag('dry-run');
  const apply = hasFlag('apply');
  if (dryRun === apply) {
    throw new Error('Requires exactly one of --dry-run or --apply.');
  }

  const seasonRaw = value('season');
  const season =
    seasonRaw === undefined
      ? undefined
      : (() => {
          const parsed = z.coerce.number().int().min(1920).max(2100).safeParse(seasonRaw);
          if (!parsed.success) throw new Error('--season must be a valid year.');
          return parsed.data;
        })();

  const seasonTypeRaw = value('seasonType');
  const seasonType =
    seasonTypeRaw === undefined
      ? undefined
      : (() => {
          const parsed = z.enum(['PRE', 'REG', 'POST']).safeParse(seasonTypeRaw);
          if (!parsed.success) throw new Error('--seasonType must be one of PRE, REG, POST.');
          return parsed.data;
        })();

  const weekRaw = value('week');
  const week =
    weekRaw === undefined
      ? undefined
      : (() => {
          const parsed = z.coerce.number().int().min(1).max(22).safeParse(weekRaw);
          if (!parsed.success) throw new Error('--week must be an integer between 1 and 22.');
          return parsed.data;
        })();

  const limitRaw = value('limit');
  const limit =
    limitRaw === undefined
      ? undefined
      : (() => {
          const parsed = z.coerce.number().int().min(1).max(500).safeParse(limitRaw);
          if (!parsed.success) throw new Error('--limit must be a positive integer.');
          return parsed.data;
        })();

  return { apply, season, seasonType, week, limit, force: hasFlag('force') };
}

import 'dotenv/config';

import { z } from 'zod';

import { createPrismaClient } from '../common/database/prisma.js';
import { createLogger } from '../common/logging/logger.js';
import { loadCurrentGameSyncConfig } from '../config/env.js';
import {
  HighlightlyEvaluationError,
  HighlightlyEvaluationHttpClient,
} from '../modules/sports/evaluation/highlightly/highlightly-http-client.js';
import { PrismaCurrentGameSyncRepository } from '../modules/sports/current-game-sync.repository.js';
import { PrismaCurrentGameDetailsRepository } from '../modules/sports/current-game-details.repository.js';
import { HighlightlyCurrentGameDetailsProvider } from '../modules/sports/providers/highlightly/highlightly-current-game-details-provider.js';
import { HighlightlyCurrentGameProvider } from '../modules/sports/providers/highlightly/highlightly-current-game-provider.js';
import { CurrentGameDetailsSyncService } from '../modules/sports/sync-current-game-details.js';
import {
  CurrentGameSyncError,
  CurrentGameSyncService,
} from '../modules/sports/sync-current-games.js';

type Action = 'verify' | 'sync';

let prisma: ReturnType<typeof createPrismaClient> | undefined;

try {
  const action = parseAction(process.argv[2]);
  const scope = parseScope(process.argv);
  const apply = parseApply(action, process.argv);
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
  const provider = new HighlightlyCurrentGameProvider(client);
  const policy = {
    nodeEnv: config.nodeEnv,
    evaluationMode: config.currentGame.evaluationMode,
    publicationApproved: config.currentGame.publicationApproved,
  };
  const service = new CurrentGameSyncService(provider, new PrismaCurrentGameSyncRepository(prisma));
  const report =
    scope.kind === 'game'
      ? await service.sync({ gameId: scope.gameId, apply, policy })
      : await service.syncWindow({ ...scope.value, apply, policy });

  const detailsProvider = new HighlightlyCurrentGameDetailsProvider(client);
  const detailsService = new CurrentGameDetailsSyncService(
    detailsProvider,
    new PrismaCurrentGameDetailsRepository(prisma),
  );
  const teamStats: unknown[] = [];
  for (const item of report.results) {
    if (
      item.providerGameId === null ||
      item.providerSnapshot?.status !== 'FINAL' ||
      !['WOULD_UPDATE', 'UPDATED', 'UNCHANGED'].includes(item.outcome)
    )
      continue;
    try {
      teamStats.push({
        internalGameId: item.internalGameId,
        outcome: 'AVAILABLE',
        report: await detailsService.sync({
          gameId: item.internalGameId,
          providerGameId: item.providerGameId,
          includePlayerStats: false,
          apply,
          policy,
        }),
      });
    } catch (error: unknown) {
      teamStats.push({
        internalGameId: item.internalGameId,
        outcome: 'UNAVAILABLE',
        reason:
          error instanceof Error ? error.message : 'Provider team statistics were unavailable.',
      });
    }
  }
  process.stdout.write(`${JSON.stringify({ gameState: report, teamStats }, null, 2)}\n`);
} catch (error: unknown) {
  const providerError = error instanceof HighlightlyEvaluationError ? error : null;
  const syncError = error instanceof CurrentGameSyncError ? error : null;
  const safeMessage =
    syncError?.message ??
    providerError?.message ??
    'Current-game synchronization failed; inspect private operational logs.';
  process.stderr.write(
    `${JSON.stringify({
      error: {
        code: syncError?.code ?? providerError?.code ?? 'CURRENT_GAME_SYNC_FAILED',
        message: safeMessage,
        statusCode: providerError?.statusCode ?? null,
        endpoint: providerError?.getEndpointPath() ?? null,
      },
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}

function parseAction(value: string | undefined): Action {
  if (value === 'verify' || value === 'sync') return value;
  throw new Error('Expected current-game action: verify or sync.');
}

function parseScope(arguments_: readonly string[]):
  | { readonly kind: 'game'; readonly gameId: string }
  | {
      readonly kind: 'window';
      readonly value: {
        readonly season: number;
        readonly seasonType: 'PRE' | 'REG' | 'POST';
        readonly week?: number;
        readonly startTime?: Date;
        readonly endTime?: Date;
      };
    } {
  const argument = arguments_.find((value) => value.startsWith('--gameId='));
  if (argument !== undefined) {
    const parsed = z.uuid().safeParse(argument.slice('--gameId='.length));
    if (!parsed.success) throw new Error('A valid --gameId=<uuid> is required.');
    return { kind: 'game', gameId: parsed.data };
  }
  const value = (name: string): string | undefined =>
    arguments_.find((candidate) => candidate.startsWith(`--${name}=`))?.slice(name.length + 3);
  const parsed = z
    .object({
      season: z.coerce.number().int().min(2020).max(2100),
      seasonType: z.enum(['PRE', 'REG', 'POST']),
      week: z.coerce.number().int().min(1).max(25).optional(),
      startTime: z.iso.datetime({ offset: true }).optional(),
      endTime: z.iso.datetime({ offset: true }).optional(),
    })
    .safeParse({
      season: value('season'),
      seasonType: value('seasonType'),
      week: value('week'),
      startTime: value('from'),
      endTime: value('to'),
    });
  if (!parsed.success)
    throw new Error(
      'Use --gameId=<uuid>, or --season=<year> --seasonType=<PRE|REG|POST> with --week=<n> or --from/--to.',
    );
  return {
    kind: 'window',
    value: {
      season: parsed.data.season,
      seasonType: parsed.data.seasonType,
      ...(parsed.data.week === undefined ? {} : { week: parsed.data.week }),
      ...(parsed.data.startTime === undefined
        ? {}
        : { startTime: new Date(parsed.data.startTime) }),
      ...(parsed.data.endTime === undefined ? {} : { endTime: new Date(parsed.data.endTime) }),
    },
  };
}

function parseApply(action: Action, arguments_: readonly string[]): boolean {
  const dryRun = arguments_.includes('--dry-run');
  const apply = arguments_.includes('--apply');
  if (action === 'verify') {
    if (dryRun || apply) throw new Error('The verify action does not accept mutation flags.');
    return false;
  }
  if (dryRun === apply)
    throw new Error('The sync action requires exactly one of --dry-run or --apply.');
  return apply;
}

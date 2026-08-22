import 'dotenv/config';

import { z } from 'zod';

import { createPrismaClient } from '../common/database/prisma.js';
import { createLogger } from '../common/logging/logger.js';
import { loadCurrentGameSyncConfig } from '../config/env.js';
import { PrismaCurrentGamePlayRepository } from '../modules/sports/current-game-play.repository.js';
import {
  HighlightlyEvaluationError,
  HighlightlyEvaluationHttpClient,
} from '../modules/sports/evaluation/highlightly/highlightly-http-client.js';
import { HighlightlyCurrentGamePlayProvider } from '../modules/sports/providers/highlightly/highlightly-current-game-play-provider.js';
import { CurrentGamePlaySyncService } from '../modules/sports/sync-current-game-plays.js';
import { CurrentGameSyncError } from '../modules/sports/sync-current-games.js';

type Action = 'verify' | 'sync';
let prisma: ReturnType<typeof createPrismaClient> | undefined;

try {
  const action = parseAction(process.argv[2]);
  const gameId = parseGameId(process.argv);
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
  const service = new CurrentGamePlaySyncService(
    new HighlightlyCurrentGamePlayProvider(client),
    new PrismaCurrentGamePlayRepository(prisma),
  );
  const report = await service.sync({
    gameId,
    apply,
    policy: {
      nodeEnv: config.nodeEnv,
      evaluationMode: config.currentGame.evaluationMode,
      publicationApproved: config.currentGame.publicationApproved,
    },
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.blocked) process.exitCode = 1;
} catch (error: unknown) {
  const providerError = error instanceof HighlightlyEvaluationError ? error : null;
  const syncError = error instanceof CurrentGameSyncError ? error : null;
  process.stderr.write(
    `${JSON.stringify({
      error: {
        code: syncError?.code ?? providerError?.code ?? 'CURRENT_GAME_PLAYS_SYNC_FAILED',
        message:
          syncError?.message ??
          providerError?.message ??
          'Current-game play synchronization failed; inspect private operational logs.',
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
  throw new Error('Expected current-game play action: verify or sync.');
}

function parseGameId(arguments_: readonly string[]): string {
  const argument = arguments_.find((value) => value.startsWith('--gameId='));
  const parsed = z.uuid().safeParse(argument?.slice('--gameId='.length));
  if (!parsed.success) throw new Error('A valid --gameId=<uuid> is required.');
  return parsed.data;
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

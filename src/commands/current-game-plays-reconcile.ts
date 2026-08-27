import 'dotenv/config';

import { z } from 'zod';

import { createPrismaClient } from '../common/database/prisma.js';
import { createLogger } from '../common/logging/logger.js';
import { loadCurrentGameSyncConfig } from '../config/env.js';
import {
  FinalPlaySnapshotService,
  type FinalReplacementPhase,
} from '../modules/sports/current-game-play-final-replacement.js';
import { ReconciliationDiagnosticService } from '../modules/sports/current-game-play-reconciliation-diagnostic.js';
import {
  PlayReconciliationRepairService,
  type RepairInput,
  type RepairMode,
} from '../modules/sports/current-game-play-repair.js';
import { PrismaCurrentGamePlayRepository } from '../modules/sports/current-game-play.repository.js';
import { PrismaCurrentGamePollStateRepository } from '../modules/sports/current-game-poll-state.repository.js';
import type { ManualPlayLink } from '../modules/sports/sync-current-game-plays.js';
import {
  HighlightlyEvaluationError,
  HighlightlyEvaluationHttpClient,
} from '../modules/sports/evaluation/highlightly/highlightly-http-client.js';
import { HighlightlyCurrentGamePlayProvider } from '../modules/sports/providers/highlightly/highlightly-current-game-play-provider.js';
import { CurrentGameSyncError } from '../modules/sports/sync-current-games.js';

let prisma: ReturnType<typeof createPrismaClient> | undefined;

try {
  const argv = process.argv.slice(2);
  const gameId = parseGameId(argv);
  const apply = argv.includes('--apply');

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
  const playProvider = new HighlightlyCurrentGamePlayProvider(client);
  const playRepository = new PrismaCurrentGamePlayRepository(prisma);
  const pollStateRepository = new PrismaCurrentGamePollStateRepository(prisma);

  if (!apply) {
    // Diagnostic is the CLI default: no flag is required for safe, read-only inspection.
    // --dry-run is accepted as an explicit no-op synonym for this same default.
    const diagnosticService = new ReconciliationDiagnosticService(playProvider, playRepository);
    const diagnostic = await diagnosticService.diagnose(gameId);
    process.stdout.write(`${JSON.stringify(diagnostic, null, 2)}\n`);
    if (diagnostic.safeRepairCandidate === 'NO_SAFE_REPAIR') process.exitCode = 1;
  } else if (
    argv.find((entry) => entry.startsWith('--mode='))?.slice('--mode='.length) === 'final-replace'
  ) {
    const finalPlaySnapshotService = new FinalPlaySnapshotService(playProvider, playRepository);
    const phase = parseFinalReplacementPhase(argv);
    const operatorEmail = argv
      .find((entry) => entry.startsWith('--operatorEmail='))
      ?.slice('--operatorEmail='.length);
    const actorEmailSnapshot =
      operatorEmail === undefined
        ? 'current-game-plays-reconcile-cli'
        : (() => {
            const parsed = z.email().safeParse(operatorEmail);
            if (!parsed.success)
              throw new Error('--operatorEmail, if supplied, must be a valid email.');
            return parsed.data;
          })();
    const result = await finalPlaySnapshotService.replace({ gameId, phase, actorEmailSnapshot });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === 'VALIDATION_FAILED') process.exitCode = 1;
  } else {
    const repairService = new PlayReconciliationRepairService(
      playProvider,
      playRepository,
      pollStateRepository,
    );
    const input = parseRepairInput(gameId, argv);
    const result = await repairService.repair(input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error: unknown) {
  const providerError = error instanceof HighlightlyEvaluationError ? error : null;
  const syncError = error instanceof CurrentGameSyncError ? error : null;
  process.stderr.write(
    `${JSON.stringify({
      error: {
        code: syncError?.code ?? providerError?.code ?? 'CURRENT_GAME_PLAYS_RECONCILE_FAILED',
        message:
          syncError?.message ??
          providerError?.message ??
          'Current-game play reconciliation failed; inspect private operational logs.',
        statusCode: providerError?.statusCode ?? null,
        endpoint: providerError?.getEndpointPath() ?? null,
      },
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}

function parseGameId(argv: readonly string[]): string {
  const value = argv.find((entry) => entry.startsWith('--gameId='))?.slice('--gameId='.length);
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new Error('A valid --gameId=<uuid> is required.');
  return parsed.data;
}

function parseRepairInput(gameId: string, argv: readonly string[]): RepairInput {
  const modeValue = argv.find((entry) => entry.startsWith('--mode='))?.slice('--mode='.length);
  const mode = parseMode(modeValue);
  const reason = argv.find((entry) => entry.startsWith('--reason='))?.slice('--reason='.length);
  if (reason === undefined || reason.trim().length === 0) {
    throw new Error('--reason="..." is required with --apply.');
  }
  const operatorEmail = argv
    .find((entry) => entry.startsWith('--operatorEmail='))
    ?.slice('--operatorEmail='.length);
  const parsedEmail = z.email().safeParse(operatorEmail);
  if (!parsedEmail.success)
    throw new Error('A valid --operatorEmail=<email> is required with --apply.');
  const actor = { userId: null, emailSnapshot: parsedEmail.data, requestId: null };

  if (mode === 'REBUILD_AFTER_CUTOFF') {
    const cutoffValue = argv
      .find((entry) => entry.startsWith('--cutoffSequence='))
      ?.slice('--cutoffSequence='.length);
    const parsedCutoff = z.coerce.number().int().min(1).safeParse(cutoffValue);
    if (!parsedCutoff.success) {
      throw new Error('--cutoffSequence=<n> is required with --mode=rebuild-after-cutoff.');
    }
    return { gameId, mode, actor, reason, cutoffSequence: parsedCutoff.data };
  }
  if (mode === 'STRUCTURAL_RELINK') {
    const relinkValue = argv
      .find((entry) => entry.startsWith('--relink='))
      ?.slice('--relink='.length);
    if (relinkValue === undefined || relinkValue.trim().length === 0) {
      throw new Error(
        '--relink=<existingId>:<sequence>,... is required with --mode=structural-relink.',
      );
    }
    return { gameId, mode, actor, reason, manualLinks: parseManualLinks(relinkValue) };
  }
  return { gameId, mode, actor, reason };
}

function parseFinalReplacementPhase(argv: readonly string[]): FinalReplacementPhase {
  const value = argv.find((entry) => entry.startsWith('--phase='))?.slice('--phase='.length);
  if (value === undefined || value === 'final-immediate') return 'FINAL_IMMEDIATE';
  if (value === 'final-10') return 'FINAL_10';
  if (value === 'final-60') return 'FINAL_60';
  throw new Error('--phase, if supplied, must be one of final-immediate|final-10|final-60.');
}

function parseMode(value: string | undefined): RepairMode {
  if (value === 'append-only') return 'APPEND_ONLY';
  if (value === 'structural-relink') return 'STRUCTURAL_RELINK';
  if (value === 'rebuild-after-cutoff') return 'REBUILD_AFTER_CUTOFF';
  throw new Error(
    '--mode=append-only|structural-relink|rebuild-after-cutoff is required with --apply.',
  );
}

function parseManualLinks(value: string): readonly ManualPlayLink[] {
  return value.split(',').map((entry) => {
    const [existingPlayId, sequenceText] = entry.split(':');
    const parsedSequence = z.coerce.number().int().min(1).safeParse(sequenceText);
    if (existingPlayId === undefined || existingPlayId.length === 0 || !parsedSequence.success) {
      throw new Error(
        `Invalid --relink entry "${entry}"; expected <existingPlayId>:<desiredSequence>.`,
      );
    }
    return { existingPlayId, desiredSequence: parsedSequence.data };
  });
}

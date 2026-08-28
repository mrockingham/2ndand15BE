import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import type { createPrismaClient } from '../../common/database/prisma.js';
import type { CurrentGameSyncConfig } from '../../config/env.js';
import { PrismaGameHighlightsRepository } from '../game-highlights/game-highlights.repository.js';
import { GameHighlightsService } from '../game-highlights/game-highlights.service.js';
import { PrismaCurrentGameDetailsRepository } from './current-game-details.repository.js';
import { FinalPlaySnapshotService } from './current-game-play-final-replacement.js';
import { PrismaCurrentGamePlayRepository } from './current-game-play.repository.js';
import { PrismaCurrentGamePollStateRepository } from './current-game-poll-state.repository.js';
import { CurrentGamePoller } from './current-game-poller.js';
import { HighlightlyCurrentGamePlayProvider } from './providers/highlightly/highlightly-current-game-play-provider.js';
import { PrismaCurrentGameSyncRepository } from './current-game-sync.repository.js';
import { HighlightlyEvaluationHttpClient } from './evaluation/highlightly/highlightly-http-client.js';
import { createHighlightlyMatchDetailFetcher } from './highlightly-match-detail-fetcher.js';
import { createHighlightlyBoxScoreFetcher } from './highlightly-box-score-fetcher.js';
import { createHighlightlyHighlightFetcher } from './highlightly-highlight-fetcher.js';
import { createHighlightlyGeoRestrictionFetcher } from './highlightly-geo-restriction-fetcher.js';
import { HighlightlyCurrentGameProvider } from './providers/highlightly/highlightly-current-game-provider.js';
import { CurrentGameSyncService } from './sync-current-games.js';

export interface BuiltCurrentGamePoller {
  readonly poller: CurrentGamePoller;
  readonly client: HighlightlyEvaluationHttpClient;
  readonly workerId: string;
}

/**
 * Wires one CurrentGamePoller instance (and its Highlightly HTTP client) from
 * a validated CurrentGameSyncConfig. Shared by the bounded CLI
 * (src/commands/current-game-poller.ts) and the long-running worker
 * (src/workers/current-game-worker.ts) so both stay identical in how they
 * build the poller and its DB claim/lease-backed dependencies.
 */
export function buildCurrentGamePoller(
  config: CurrentGameSyncConfig,
  logger: Logger,
  prisma: ReturnType<typeof createPrismaClient>,
): BuiltCurrentGamePoller {
  const client = new HighlightlyEvaluationHttpClient({
    baseUrl: config.currentGame.highlightly.baseUrl,
    apiKey: config.currentGame.highlightly.apiKey,
    requestTimeoutMs: config.currentGame.highlightly.requestTimeoutMs,
    maxRetries: config.currentGame.highlightly.maxRetries,
    logger,
  });

  const playRepository = new PrismaCurrentGamePlayRepository(prisma);
  const workerId = `${String(process.pid)}-${randomUUID().slice(0, 8)}`;

  const poller = new CurrentGamePoller({
    gameSyncService: new CurrentGameSyncService(
      new HighlightlyCurrentGameProvider(client),
      new PrismaCurrentGameSyncRepository(prisma),
    ),
    detailsRepository: new PrismaCurrentGameDetailsRepository(prisma),
    playRepository,
    finalPlaySnapshotService: new FinalPlaySnapshotService(
      new HighlightlyCurrentGamePlayProvider(client),
      playRepository,
    ),
    matchDetailFetcher: createHighlightlyMatchDetailFetcher(client),
    boxScoreFetcher: createHighlightlyBoxScoreFetcher(client),
    highlightsService: new GameHighlightsService(new PrismaGameHighlightsRepository(prisma), {
      fetcher: createHighlightlyHighlightFetcher(client),
      client,
      geoFetcher: createHighlightlyGeoRestrictionFetcher(client),
      embedAllowedHosts: config.currentGame.embedAllowedHosts,
    }),
    pollStateRepository: new PrismaCurrentGamePollStateRepository(prisma),
    requestCounter: client,
    rateLimitObservation: () => client.getRateLimitObservation(),
    now: () => new Date(),
    workerId,
  });

  return { poller, client, workerId };
}

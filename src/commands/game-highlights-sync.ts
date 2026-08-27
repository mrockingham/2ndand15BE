import 'dotenv/config';

import { z } from 'zod';

import { createPrismaClient } from '../common/database/prisma.js';
import { loadCurrentGameSyncConfig } from '../config/env.js';
import { HighlightlyEvaluationHttpClient } from '../modules/sports/evaluation/highlightly/highlightly-http-client.js';
import { createHighlightlyHighlightFetcher } from '../modules/sports/highlightly-highlight-fetcher.js';
import { createHighlightlyGeoRestrictionFetcher } from '../modules/sports/highlightly-geo-restriction-fetcher.js';
import { PrismaGameHighlightsRepository } from '../modules/game-highlights/game-highlights.repository.js';
import { GameHighlightsService } from '../modules/game-highlights/game-highlights.service.js';

// M31: a bounded, explicit CLI for syncing game highlights -- mirrors
// `current-game-coverage.ts`'s read/report style, but this one writes (via the
// normal, audited-by-design upsert path; there is no separate admin actor/audit
// trail for this feature, matching the rest of the current-game sync surface).
const MAXIMUM_BATCH_GAMES = 20;

const singleGameArguments = z.object({ gameId: z.uuid() }).strict();
const windowArguments = z
  .object({
    season: z.coerce.number().int().min(2020).max(2100),
    seasonType: z.enum(['PRE', 'REG', 'POST']),
    week: z.coerce.number().int().min(1).max(25).optional(),
  })
  .strict();

async function main(): Promise<void> {
  const raw = Object.fromEntries(process.argv.slice(2).map(toArgumentPair));
  const config = loadCurrentGameSyncConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    const client = new HighlightlyEvaluationHttpClient({
      baseUrl: config.currentGame.highlightly.baseUrl,
      apiKey: config.currentGame.highlightly.apiKey,
      requestTimeoutMs: config.currentGame.highlightly.requestTimeoutMs,
      maxRetries: config.currentGame.highlightly.maxRetries,
    });
    const repository = new PrismaGameHighlightsRepository(prisma);
    const service = new GameHighlightsService(repository, {
      fetcher: createHighlightlyHighlightFetcher(client),
      client,
      geoFetcher: createHighlightlyGeoRestrictionFetcher(client),
      embedAllowedHosts: config.currentGame.embedAllowedHosts,
    });

    const gameIds = await resolveGameIds(prisma, raw);
    const results = [];
    for (const gameId of gameIds) {
      results.push(await service.syncGame(gameId));
    }
    const summary = {
      gamesChecked: results.length,
      available: results.filter((r) => r.coverage === 'AVAILABLE').length,
      unavailable: results.filter((r) => r.coverage === 'UNAVAILABLE').length,
      pending: results.filter((r) => r.coverage === 'PENDING').length,
      providerError: results.filter((r) => r.coverage === 'PROVIDER_ERROR').length,
      totalDbHighlights: results.reduce((sum, r) => sum + r.dbHighlightCount, 0),
      totalRequests: results.reduce((sum, r) => sum + (r.requestCount ?? 0), 0),
    };
    process.stdout.write(`${JSON.stringify({ summary, results }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

async function resolveGameIds(
  prisma: ReturnType<typeof createPrismaClient>,
  raw: Record<string, string>,
): Promise<readonly string[]> {
  const single = singleGameArguments.safeParse(raw);
  if (single.success) return [single.data.gameId];
  const window = windowArguments.safeParse(raw);
  if (!window.success) {
    throw new Error(
      'Usage: --gameId=<uuid> OR --season=<year> --seasonType=<PRE|REG|POST> [--week=<number>]',
    );
  }
  const games = await prisma.game.findMany({
    where: {
      season: window.data.season,
      seasonType: window.data.seasonType,
      ...(window.data.week === undefined ? {} : { week: window.data.week }),
    },
    orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    select: { id: true },
    take: MAXIMUM_BATCH_GAMES + 1,
  });
  if (games.length > MAXIMUM_BATCH_GAMES) {
    throw new Error(
      `This scope matches more than ${String(MAXIMUM_BATCH_GAMES)} games; narrow it with --week=<number>.`,
    );
  }
  return games.map((game) => game.id);
}

function toArgumentPair(value: string): readonly [string, string] {
  const match = /^--([^=]+)=(.+)$/.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(
      'Usage: --gameId=<uuid> OR --season=<year> --seasonType=<PRE|REG|POST> [--week=<number>]',
    );
  }
  return [match[1], match[2]];
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Highlight sync failed.'}\n`);
  process.exitCode = 1;
});

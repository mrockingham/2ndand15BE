import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/common/database/prisma.js';
import { loadDatabaseConfig } from '../../src/config/env.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaGameHighlightsRepository } from '../../src/modules/game-highlights/game-highlights.repository.js';
import { GameHighlightsService } from '../../src/modules/game-highlights/game-highlights.service.js';
import type { HighlightFetcher } from '../../src/modules/sports/highlightly-highlight-fetcher.js';
import type { GeoRestrictionFetcher } from '../../src/modules/sports/highlightly-geo-restriction-fetcher.js';
import type { HighlightlyHighlight } from '../../src/modules/sports/evaluation/highlightly/highlightly-schemas.js';
import type { HighlightlyEvaluationHttpClient } from '../../src/modules/sports/evaluation/highlightly/highlightly-http-client.js';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

function requirePrisma(client: PrismaClient | undefined): PrismaClient {
  if (client === undefined) throw new Error('Expected a connected Prisma client.');
  return client;
}

function fictionalHighlight(id: number, title: string): HighlightlyHighlight {
  return {
    id,
    type: 'VERIFIED',
    imgUrl: 'https://i.ytimg.com/vi/fictional/hqdefault.jpg',
    title,
    description: null,
    url: 'https://www.youtube.com/watch?v=fictional',
    embedUrl: 'https://www.youtube.com/embed/fictional',
    channel: 'NFL',
    source: 'youtube',
    category: 'other',
    match: { id: 999888, league: 'NFL', season: 2026, date: null, round: 'preseason' },
  };
}

/** A test double standing in for the live Highlightly `/highlights` call so this
 * suite never makes a real network request -- the real endpoint is verified
 * separately (docs/current-season-games/highlightly-highlights-2026-08-25.md). */
class ScriptedFetcher implements HighlightFetcher {
  private index = 0;
  constructor(private readonly responses: readonly (readonly HighlightlyHighlight[])[]) {}

  fetch(): ReturnType<HighlightFetcher['fetch']> {
    const highlights = this.responses[Math.min(this.index, this.responses.length - 1)] ?? [];
    this.index += 1;
    return Promise.resolve({ highlights, failureReason: null });
  }
}

function fakeClient(): HighlightlyEvaluationHttpClient {
  return { getRequestCount: () => 0 } as unknown as HighlightlyEvaluationHttpClient;
}

/** Never performs a real geo-restrictions lookup -- eligibility state is
 * covered by unit tests; this suite only verifies highlight persistence. */
const noopGeoFetcher: GeoRestrictionFetcher = {
  fetch: () => Promise.resolve({ restriction: null, failureReason: null }),
};

describe.skipIf(!databaseTestsEnabled)('game highlights database integration (M31)', () => {
  let prisma: PrismaClient | undefined;
  let gameId: string | undefined;

  beforeAll(async () => {
    prisma = createPrismaClient(loadDatabaseConfig().databaseUrl);
    const teams = await prisma.team.findMany({ take: 2, orderBy: { id: 'asc' } });
    const homeTeam = teams.at(0);
    const awayTeam = teams.at(1);
    if (homeTeam === undefined || awayTeam === undefined) {
      throw new Error('Expected at least two seeded teams for this integration test.');
    }
    const game = await prisma.game.create({
      data: {
        league: 'NFL',
        season: 2026,
        seasonType: 'PRE',
        startTime: new Date('2026-08-22T23:00:00.000Z'),
        status: 'FINAL',
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
      },
    });
    gameId = game.id;
    await prisma.gameProviderMapping.create({
      data: { gameId: game.id, provider: 'highlightly', providerGameId: '999888' },
    });
  });

  afterAll(async () => {
    const client = requirePrisma(prisma);
    if (gameId !== undefined) {
      // Cascades GameHighlight, GameHighlightSyncState, and GameProviderMapping.
      await client.game.delete({ where: { id: gameId } }).catch(() => undefined);
    }
    await client.$disconnect();
  });

  it('persists, dedupes within one response, re-syncs idempotently, and never destructively shrinks', async () => {
    const client = requirePrisma(prisma);
    const id = gameId;
    if (id === undefined) throw new Error('Expected a fictional game.');
    const repository = new PrismaGameHighlightsRepository(client);

    // First sync: two highlights, one of them duplicated within the same response
    // (same provider ID twice) -- must persist exactly one row for it.
    const first = new GameHighlightsService(repository, {
      fetcher: new ScriptedFetcher([
        [
          fictionalHighlight(900001, 'Fictional Team vs. Fictional Team | Preseason'),
          fictionalHighlight(900002, 'Fictional Team Mic’d Up'),
          fictionalHighlight(900001, 'Fictional Team vs. Fictional Team | Preseason'),
        ],
      ]),
      client: fakeClient(),
      geoFetcher: noopGeoFetcher,
      embedAllowedHosts: null,
    });
    const firstResult = await first.syncGame(id);
    expect(firstResult.coverage).toBe('AVAILABLE');
    expect(firstResult.dbHighlightCount).toBe(2);
    const rowsAfterFirst = await client.gameHighlight.findMany({ where: { gameId: id } });
    expect(rowsAfterFirst).toHaveLength(2);
    expect(new Set(rowsAfterFirst.map((r) => r.providerHighlightKey)).size).toBe(2);

    // Public/admin reads never leak the provider name or the provider highlight key.
    const publicDto = await first.getPublicHighlights(id);
    expect(publicDto.coverage).toBe('AVAILABLE');
    expect(publicDto.highlights).toHaveLength(2);
    const publicSerialized = JSON.stringify(publicDto);
    expect(publicSerialized).not.toContain('highlightly');
    expect(publicSerialized).not.toContain('900001');
    expect(publicSerialized).not.toContain('999888');
    const diagnostic = await first.getDiagnostic(id);
    expect(JSON.stringify(diagnostic)).not.toContain('900001');

    // Second sync: the provider's snapshot shrinks to a single item -- the
    // previously-seen second item must NOT be deleted (non-destructive).
    const second = new GameHighlightsService(repository, {
      fetcher: new ScriptedFetcher([[fictionalHighlight(900001, 'Updated Fictional Title')]]),
      client: fakeClient(),
      geoFetcher: noopGeoFetcher,
      embedAllowedHosts: null,
    });
    const secondResult = await second.syncGame(id);
    expect(secondResult.dbHighlightCount).toBe(2); // still 2, nothing deleted
    const rowsAfterSecond = await client.gameHighlight.findMany({
      where: { gameId: id },
      orderBy: { providerHighlightKey: 'asc' },
    });
    expect(rowsAfterSecond).toHaveLength(2);
    const updated = rowsAfterSecond.find((r) => r.providerHighlightKey === '900001');
    expect(updated?.title).toBe('Updated Fictional Title');
    const preserved = rowsAfterSecond.find((r) => r.providerHighlightKey === '900002');
    expect(preserved?.title).toBe('Fictional Team Mic’d Up');

    // Third sync against the exact same single-item snapshot: fully idempotent.
    const third = new GameHighlightsService(repository, {
      fetcher: new ScriptedFetcher([[fictionalHighlight(900001, 'Updated Fictional Title')]]),
      client: fakeClient(),
      geoFetcher: noopGeoFetcher,
      embedAllowedHosts: null,
    });
    const thirdResult = await third.syncGame(id);
    expect(thirdResult.dbHighlightCount).toBe(2);
    const rowsAfterThird = await client.gameHighlight.count({ where: { gameId: id } });
    expect(rowsAfterThird).toBe(2);
  });

  it('M31C: persists embed eligibility once per highlight and supports idempotent recheck', async () => {
    const client = requirePrisma(prisma);
    const id = gameId;
    if (id === undefined) throw new Error('Expected a fictional game.');
    const repository = new PrismaGameHighlightsRepository(client);

    let embeddable = true;
    const scriptedGeoFetcher: GeoRestrictionFetcher = {
      fetch: () =>
        Promise.resolve({
          restriction: { state: 'test', embeddable, allowedCountries: [], blockedCountries: [] },
          failureReason: null,
        }),
    };
    const service = new GameHighlightsService(repository, {
      fetcher: new ScriptedFetcher([[fictionalHighlight(900001, 'Eligibility Fixture')]]),
      client: fakeClient(),
      geoFetcher: scriptedGeoFetcher,
      embedAllowedHosts: null,
    });

    await service.syncGame(id);
    const row = await client.gameHighlight.findFirstOrThrow({
      where: { gameId: id, providerHighlightKey: '900001' },
    });
    expect(row.embedStatus).toBe('ALLOWED');
    expect(row.canEmbed).toBe(true);
    expect(row.embedCheckedAt).not.toBeNull();
    const publicDto = await service.getPublicHighlights(id);
    expect(publicDto.highlights.find((h) => h.title === 'Eligibility Fixture')?.canEmbed).toBe(
      true,
    );

    // A regular sync never rechecks an already-decided highlight.
    embeddable = false;
    await service.syncGame(id);
    const unchanged = await client.gameHighlight.findFirstOrThrow({
      where: { gameId: id, providerHighlightKey: '900001' },
    });
    expect(unchanged.embedStatus).toBe('ALLOWED');

    // The bounded repair/backfill path forces a recheck and picks up the change.
    await service.refreshEmbedEligibility(id);
    const rechecked = await client.gameHighlight.findFirstOrThrow({
      where: { gameId: id, providerHighlightKey: '900001' },
    });
    expect(rechecked.embedStatus).toBe('NOT_ALLOWED');
    expect(rechecked.canEmbed).toBe(false);
  });

  it('reports PENDING, not an error, for a game with no provider mapping yet', async () => {
    const client = requirePrisma(prisma);
    const teams = await client.team.findMany({ take: 2, orderBy: { id: 'asc' } });
    const homeTeam = teams.at(0);
    const awayTeam = teams.at(1);
    if (homeTeam === undefined || awayTeam === undefined) throw new Error('Expected seeded teams.');
    const unmappedGame = await client.game.create({
      data: {
        league: 'NFL',
        season: 2026,
        seasonType: 'PRE',
        startTime: new Date('2026-09-01T00:00:00.000Z'),
        status: 'SCHEDULED',
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
      },
    });
    try {
      const repository = new PrismaGameHighlightsRepository(client);
      const service = new GameHighlightsService(repository, {
        fetcher: new ScriptedFetcher([[]]),
        client: fakeClient(),
        geoFetcher: noopGeoFetcher,
        embedAllowedHosts: null,
      });
      const result = await service.syncGame(unmappedGame.id);
      expect(result.coverage).toBe('PENDING');
      expect(result.errorCode).toBe('MISSING_PROVIDER_MAPPING');

      const diagnostic = await service.getDiagnostic(unmappedGame.id);
      expect(diagnostic.coverage).toBe('PENDING');
    } finally {
      await client.game.delete({ where: { id: unmappedGame.id } }).catch(() => undefined);
    }
  });
});

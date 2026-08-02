import { describe, expect, it, vi } from 'vitest';

import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { PrismaGameRepository, resolvePublicGameDataSource } from './game.repository.js';
import { createGameRecord } from './game.test-fixtures.js';

describe('public game source isolation', () => {
  it('disables fixture reads unless mock data is explicitly enabled', () => {
    expect(resolvePublicGameDataSource({ provider: 'mock', fixtureDataEnabled: false })).toBe(
      'none',
    );
    expect(resolvePublicGameDataSource({ provider: 'mock', fixtureDataEnabled: true })).toBe(
      'mock',
    );
    expect(resolvePublicGameDataSource({ provider: 'api-sports', fixtureDataEnabled: false })).toBe(
      'api-sports',
    );
  });

  it.each(['none', 'mock', 'api-sports'] as const)(
    'applies deterministic source and manual-record filter %s',
    async (source) => {
      const findMany = vi
        .fn<(args: Prisma.GameFindManyArgs) => Promise<[]>>()
        .mockResolvedValue([]);
      const prisma = { game: { findMany } } as unknown as PrismaClient;
      await new PrismaGameRepository(prisma, source).findGames({ limit: 20 });
      const where = findMany.mock.calls[0]?.[0].where;
      expect(JSON.stringify(where)).toContain('MANUAL_IMPORT');
      if (source !== 'none') expect(JSON.stringify(where)).toContain(source);
      else expect(JSON.stringify(where)).not.toContain('__disabled_public_game_source__');
    },
  );

  it('filters and orders by resolved editorial status and kickoff time', async () => {
    const laterBase = createGameRecord({
      id: '00000000-0000-4000-8000-000000000110',
      startTime: new Date('2026-09-12T00:00:00Z'),
      status: 'SCHEDULED',
    });
    const overridden = {
      ...createGameRecord({
        id: '00000000-0000-4000-8000-000000000111',
        startTime: new Date('2026-09-13T00:00:00Z'),
      }),
      editorialOverride: {
        id: '00000000-0000-4000-8000-000000000301',
        gameId: '00000000-0000-4000-8000-000000000111',
        startTime: new Date('2026-09-11T00:00:00Z'),
        status: 'POSTPONED',
        week: null,
        venueName: null,
        venueCity: null,
        broadcastNetwork: null,
        isNeutralSite: null,
        publicCorrectionNote: null,
        internalNote: null,
        createdById: null,
        updatedById: null,
        createdBySnapshot: 'editor@example.com',
        updatedBySnapshot: 'editor@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
    const findMany = vi.fn().mockResolvedValue([laterBase, overridden]);
    const prisma = { game: { findMany } } as unknown as PrismaClient;
    const page = await new PrismaGameRepository(prisma).findGames({
      status: 'POSTPONED',
      limit: 20,
    });
    expect(page.games.map((game) => game.id)).toEqual([overridden.id]);
  });

  it('combines source isolation and team direction filters without overwriting either OR clause', async () => {
    const findMany = vi.fn<(args: Prisma.GameFindManyArgs) => Promise<[]>>().mockResolvedValue([]);
    const prisma = { game: { findMany } } as unknown as PrismaClient;
    await new PrismaGameRepository(prisma, 'mock').findGames({
      teamId: '00000000-0000-4000-8000-000000000001',
      limit: 20,
    });
    const serialized = JSON.stringify(findMany.mock.calls[0]?.[0].where);
    expect(serialized).toContain('providerMaps');
    expect(serialized).toContain('homeTeamId');
    expect(serialized).toContain('awayTeamId');
  });
});

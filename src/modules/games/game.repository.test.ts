import { describe, expect, it, vi } from 'vitest';

import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { PrismaGameRepository, resolvePublicGameDataSource } from './game.repository.js';

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

  it.each([
    ['none', '__disabled_public_game_source__'],
    ['mock', 'mock'],
    ['api-sports', 'api-sports'],
  ] as const)('applies deterministic private mapping filter %s', async (source, provider) => {
    const findMany = vi.fn<(args: Prisma.GameFindManyArgs) => Promise<[]>>().mockResolvedValue([]);
    const prisma = { game: { findMany } } as unknown as PrismaClient;
    await new PrismaGameRepository(prisma, source).findGames({ limit: 20 });
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      providerMaps: { some: { provider } },
    });
  });
});

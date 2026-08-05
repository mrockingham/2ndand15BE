import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaPlayerRepository } from './player.repository.js';

describe('player repository filters', () => {
  it('combines team and season constraints without replacing either OR clause', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaPlayerRepository({
      player: { findMany },
    } as unknown as PrismaClient);
    await repository.findPlayers({
      teamId: '00000000-0000-4000-8000-000000000001',
      season: 2022,
      limit: 20,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              weeklyRosters: {
                some: {
                  teamId: '00000000-0000-4000-8000-000000000001',
                  season: 2022,
                },
              },
            },
            {
              OR: [
                { weeklyRosters: { some: { season: 2022 } } },
                { gameStats: { some: { season: 2022 } } },
              ],
            },
          ],
        },
      }),
    );
  });
});

import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaGamePlayRepository } from './game-plays.repository.js';

describe('PrismaGamePlayRepository.findPlays', () => {
  it('excludes superseded rows so a repair rebuild never leaks stale/duplicate plays publicly', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { gamePlay: { findMany } } as unknown as PrismaClient;
    const repository = new PrismaGamePlayRepository(prisma);
    await repository.findPlays('game-1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { gameId: 'game-1', supersededAt: null } }),
    );
  });
});

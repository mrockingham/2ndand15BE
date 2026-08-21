import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../generated/prisma/client.js';
import type { ApplyCurrentGameInput } from './current-game-sync.repository.js';
import { PrismaCurrentGameSyncRepository } from './current-game-sync.repository.js';

const input: ApplyCurrentGameInput = {
  game: {
    id: '0768c441-16a6-457c-b50f-e7273d750d77',
    season: 2026,
    seasonType: 'PRE',
    week: null,
    startTime: new Date('2026-08-07T00:00:00.000Z'),
    status: 'SCHEDULED',
    homeScore: null,
    awayScore: null,
    quarter: null,
    clock: null,
    venueName: 'Tom Benson Hall of Fame Stadium',
    venueCity: 'Canton, OH',
    broadcastNetwork: 'NBC',
    homeTeam: { abbreviation: 'ARI', providerTeamId: null },
    awayTeam: { abbreviation: 'CAR', providerTeamId: null },
    providerMapping: null,
  },
  provider: 'highlightly',
  providerGameId: '565788',
  state: {
    status: 'FINAL',
    homeScore: 30,
    awayScore: 33,
    quarter: 4,
    clock: '0',
    venueName: 'Tom Benson Hall of Fame Stadium',
    venueCity: 'Canton, OH',
    broadcastNetwork: 'NBC',
  },
  createMapping: true,
  usageMode: 'evaluation',
  updatedAt: new Date('2026-08-08T12:00:00.000Z'),
};

function harness(mappingError?: Error) {
  const gameUpdate = vi.fn().mockResolvedValue({});
  const mappingCreate = mappingError
    ? vi.fn().mockRejectedValue(mappingError)
    : vi.fn().mockResolvedValue({});
  const auditCreate = vi.fn().mockResolvedValue({});
  const transaction = {
    game: { update: gameUpdate },
    gameProviderMapping: { create: mappingCreate },
    adminAuditEvent: { create: auditCreate },
  };
  const runTransaction = vi.fn((callback: (value: typeof transaction) => Promise<void>) =>
    callback(transaction),
  );
  const prisma = { $transaction: runTransaction } as unknown as PrismaClient;
  return {
    repository: new PrismaCurrentGameSyncRepository(prisma),
    gameUpdate,
    mappingCreate,
    auditCreate,
    runTransaction,
  };
}

describe('PrismaCurrentGameSyncRepository', () => {
  it('selects only reviewed internal games inside the bounded week scope', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        ...input.game,
        homeTeam: { abbreviation: 'ARI', providerMaps: [{ providerTeamId: '7' }] },
        awayTeam: { abbreviation: 'CAR', providerMaps: [{ providerTeamId: '29' }] },
        providerMaps: [],
      },
    ]);
    const repository = new PrismaCurrentGameSyncRepository({
      game: { findMany },
    } as unknown as PrismaClient);
    await expect(
      repository.findReviewedGames({ season: 2026, seasonType: 'PRE', week: 1 }, 'highlightly'),
    ).resolves.toMatchObject([{ week: null, providerMapping: null }]);
    const query = findMany.mock.calls[0]?.[0] as { readonly where: unknown } | undefined;
    expect(query?.where).toMatchObject({
      season: 2026,
      seasonType: 'PRE',
      week: 1,
      provenance: {
        is: { sourceType: { in: ['OFFICIAL_WEB', 'MANUAL_IMPORT', 'MANUAL_ENTRY'] } },
      },
    });
  });

  it('updates only the existing game, creates its mapping, and writes a private audit atomically', async () => {
    const test = harness();
    await expect(test.repository.applyCurrentGame(input)).resolves.toBeUndefined();
    expect(test.runTransaction).toHaveBeenCalledOnce();
    const updateArgument = test.gameUpdate.mock.calls[0]?.[0] as
      { where: { id: string }; data: ApplyCurrentGameInput['state'] } | undefined;
    expect(updateArgument?.where).toEqual({ id: input.game.id });
    expect(updateArgument?.data).toMatchObject({ status: 'FINAL', homeScore: 30, awayScore: 33 });
    expect(test.mappingCreate).toHaveBeenCalledWith({
      data: { gameId: input.game.id, provider: 'highlightly', providerGameId: '565788' },
    });
    const auditArgument = test.auditCreate.mock.calls[0]?.[0] as
      | { data: { action: string; entityId: string; afterSnapshot: Record<string, unknown> } }
      | undefined;
    expect(auditArgument?.data.action).toBe('CURRENT_GAME_PROVIDER_SYNC');
    expect(auditArgument?.data.entityId).toBe(input.game.id);
    expect(auditArgument?.data.afterSnapshot).toMatchObject({
      provider: 'highlightly',
      usageMode: 'evaluation',
    });
  });

  it('propagates a mapping failure so the surrounding transaction rolls back and no audit follows', async () => {
    const test = harness(new Error('mapping conflict'));
    await expect(test.repository.applyCurrentGame(input)).rejects.toThrow('mapping conflict');
    expect(test.runTransaction).toHaveBeenCalledOnce();
    expect(test.auditCreate).not.toHaveBeenCalled();
  });
});

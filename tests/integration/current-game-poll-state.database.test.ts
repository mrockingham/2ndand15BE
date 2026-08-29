import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/common/database/prisma.js';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaCurrentGamePollStateRepository } from '../../src/modules/sports/current-game-poll-state.repository.js';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

function requirePrisma(client: PrismaClient | undefined): PrismaClient {
  if (client === undefined) throw new Error('Expected a connected Prisma client.');
  return client;
}

/**
 * Regression coverage for the 2026-08-27 production incident: a worker
 * started after kickoff could never discover a still-SCHEDULED game (the
 * discovery window only ever looked forward from `now`), and `--gameId`
 * couldn't rescue it either, since that flag only filtered an
 * already-discovered list. See docs/current-season-games/active-game-poller.md
 * "Explicit --gameId recovery/debug polling".
 */
describe.skipIf(!databaseTestsEnabled)('current-game poll-state database integration', () => {
  let prisma: PrismaClient | undefined;
  let homeTeamId: string | undefined;
  let awayTeamId: string | undefined;
  const createdGameIds: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(resolveTestDatabaseUrl());
    const teams = await prisma.team.findMany({ take: 2 });
    if (teams.length < 2) throw new Error('Expected at least two seeded teams for this test.');
    homeTeamId = teams[0]?.id;
    awayTeamId = teams[1]?.id;
  });

  afterAll(async () => {
    const client = requirePrisma(prisma);
    for (const gameId of createdGameIds) {
      // CurrentGamePollState and GameProviderMapping both cascade-delete with the game.
      await client.game.delete({ where: { id: gameId } }).catch(() => undefined);
    }
    await client.$disconnect();
  });

  function requireTeams(): { readonly homeTeamId: string; readonly awayTeamId: string } {
    if (homeTeamId === undefined || awayTeamId === undefined) {
      throw new Error('Expected seeded team ids for this test.');
    }
    return { homeTeamId, awayTeamId };
  }

  async function createGame(overrides: {
    readonly status: 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL';
    readonly startTime: Date | null;
  }): Promise<string> {
    const client = requirePrisma(prisma);
    const { homeTeamId: home, awayTeamId: away } = requireTeams();
    const game = await client.game.create({
      data: {
        league: 'NFL',
        season: 2026,
        seasonType: 'PRE',
        week: 2,
        status: overrides.status,
        startTime: overrides.startTime,
        homeTeamId: home,
        awayTeamId: away,
      },
    });
    createdGameIds.push(game.id);
    return game.id;
  }

  describe('discoverCandidates -- SCHEDULED/PREGAME recovery window', () => {
    it('recovers an overdue SCHEDULED game whose kickoff already passed, within the bounded recovery window', async () => {
      const client = requirePrisma(prisma);
      const repository = new PrismaCurrentGamePollStateRepository(client);
      const now = new Date();
      const gameId = await createGame({
        status: 'SCHEDULED',
        startTime: new Date(now.getTime() - 25 * 60_000), // 25 minutes ago
      });

      const candidates = await repository.discoverCandidates(now);

      expect(candidates.some((candidate) => candidate.gameId === gameId)).toBe(true);
    });

    it('excludes a too-old SCHEDULED game outside the bounded recovery window', async () => {
      const client = requirePrisma(prisma);
      const repository = new PrismaCurrentGamePollStateRepository(client);
      const now = new Date();
      const gameId = await createGame({
        status: 'SCHEDULED',
        startTime: new Date(now.getTime() - 6 * 60 * 60_000), // 6 hours ago
      });

      const candidates = await repository.discoverCandidates(now);

      expect(candidates.some((candidate) => candidate.gameId === gameId)).toBe(false);
    });

    it('still discovers a normal upcoming pregame game within the forward window (regression)', async () => {
      const client = requirePrisma(prisma);
      const repository = new PrismaCurrentGamePollStateRepository(client);
      const now = new Date();
      const gameId = await createGame({
        status: 'SCHEDULED',
        startTime: new Date(now.getTime() + 5 * 60_000), // 5 minutes from now
      });

      const candidates = await repository.discoverCandidates(now);

      expect(candidates.some((candidate) => candidate.gameId === gameId)).toBe(true);
    });
  });

  describe('findCandidateGameById -- unwindowed recovery lookup', () => {
    it('finds a game discovery would never surface (fully bypasses the scheduling window)', async () => {
      const client = requirePrisma(prisma);
      const repository = new PrismaCurrentGamePollStateRepository(client);
      const now = new Date();
      const gameId = await createGame({
        status: 'SCHEDULED',
        startTime: new Date(now.getTime() - 6 * 60 * 60_000), // 6 hours ago -- excluded by discovery
      });

      const discovered = await repository.discoverCandidates(now);
      expect(discovered.some((candidate) => candidate.gameId === gameId)).toBe(false);

      const found = await repository.findCandidateGameById(gameId);
      expect(found?.gameId).toBe(gameId);
    });

    it('returns null for a game that does not exist', async () => {
      const client = requirePrisma(prisma);
      const repository = new PrismaCurrentGamePollStateRepository(client);
      const found = await repository.findCandidateGameById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });

    it('reports providerMapping non-null for a mapped game and null for an unmapped game', async () => {
      const client = requirePrisma(prisma);
      const repository = new PrismaCurrentGamePollStateRepository(client);
      const mappedGameId = await createGame({ status: 'SCHEDULED', startTime: new Date() });
      const unmappedGameId = await createGame({ status: 'SCHEDULED', startTime: new Date() });
      await client.gameProviderMapping.create({
        data: {
          gameId: mappedGameId,
          provider: 'highlightly',
          providerGameId: `test-recovery-${mappedGameId}`,
        },
      });

      const mapped = await repository.findCandidateGameById(mappedGameId);
      const unmapped = await repository.findCandidateGameById(unmappedGameId);

      expect(mapped?.providerMapping).not.toBeNull();
      expect(unmapped?.providerMapping).toBeNull();
    });
  });

  describe('claimForRecovery -- lock/claim safety', () => {
    it('claims an unlocked poll state, then refuses a second immediate claim (no duplicate claim)', async () => {
      const client = requirePrisma(prisma);
      const repository = new PrismaCurrentGamePollStateRepository(client);
      const now = new Date();
      const gameId = await createGame({ status: 'SCHEDULED', startTime: now });
      await repository.ensurePollStates([gameId], now);

      const first = await repository.claimForRecovery(gameId, now, 'worker-a', 120_000);
      expect(first?.game.gameId).toBe(gameId);

      const second = await repository.claimForRecovery(gameId, now, 'worker-b', 120_000);
      expect(second).toBeNull();
    });

    it('claims a game whose lock has gone stale past the lease window', async () => {
      const client = requirePrisma(prisma);
      const repository = new PrismaCurrentGamePollStateRepository(client);
      const now = new Date();
      const gameId = await createGame({ status: 'SCHEDULED', startTime: now });
      await repository.ensurePollStates([gameId], now);
      await client.currentGamePollState.updateMany({
        where: { gameId },
        data: { lockedAt: new Date(now.getTime() - 10 * 60_000), lockedBy: 'worker-a' },
      });

      // Lease is 2 minutes; the lock is 10 minutes old, so it's stale.
      const claim = await repository.claimForRecovery(gameId, now, 'worker-b', 2 * 60_000);
      expect(claim?.game.gameId).toBe(gameId);
    });

    it('does not require nextPollAt <= now, unlike claimDue -- bypasses ordinary scheduling cadence', async () => {
      const client = requirePrisma(prisma);
      const repository = new PrismaCurrentGamePollStateRepository(client);
      const now = new Date();
      const gameId = await createGame({ status: 'SCHEDULED', startTime: now });
      await repository.ensurePollStates([gameId], now);
      await client.currentGamePollState.updateMany({
        where: { gameId },
        data: { nextPollAt: new Date(now.getTime() + 60 * 60_000) }, // due an hour from now
      });

      const dueClaims = await repository.claimDue(now, 'worker-a', 120_000, 10);
      expect(dueClaims.some((claim) => claim.game.gameId === gameId)).toBe(false);

      const recoveryClaim = await repository.claimForRecovery(gameId, now, 'worker-a', 120_000);
      expect(recoveryClaim?.game.gameId).toBe(gameId);
    });
  });
});

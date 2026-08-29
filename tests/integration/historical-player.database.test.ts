import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/common/database/prisma.js';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaPlayerRepository } from '../../src/modules/players/player.repository.js';
import { PlayerService } from '../../src/modules/players/player.service.js';

const enabled = process.env.RUN_HISTORICAL_DATABASE_TESTS === 'true';

describe.skipIf(!enabled)('historical player database', () => {
  let prisma: PrismaClient | undefined;

  beforeAll(() => {
    prisma = createPrismaClient(resolveTestDatabaseUrl());
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('contains the reviewed weekly and summary row counts for every imported season', async () => {
    const client = requirePrisma(prisma);
    const expected = new Map([
      [2020, { rosters: 44130, stats: 17581, summaries: 4487 }],
      [2021, { rosters: 46693, stats: 18947, summaries: 4688 }],
      [2022, { rosters: 46162, stats: 18809, summaries: 4533 }],
      [2023, { rosters: 45654, stats: 18621, summaries: 4387 }],
      [2024, { rosters: 46579, stats: 18959, summaries: 4493 }],
      [2025, { rosters: 46845, stats: 19399, summaries: 4571 }],
    ]);
    for (const [season, counts] of expected) {
      await expect(client.playerWeekRoster.count({ where: { season } })).resolves.toBe(
        counts.rosters,
      );
      await expect(client.playerGameStat.count({ where: { season } })).resolves.toBe(counts.stats);
      await expect(client.playerSeasonStat.count({ where: { season } })).resolves.toBe(
        counts.summaries,
      );
    }
  });

  it('serves internal IDs and attribution without provider or import metadata', async () => {
    const service = new PlayerService(new PrismaPlayerRepository(requirePrisma(prisma)));
    const page = await service.listPlayers({ search: 'Patrick Mahomes', season: 2025, limit: 5 });
    const serialized = JSON.stringify(page);
    expect(page.data).toHaveLength(1);
    expect(serialized).toContain('CC BY 4.0');
    expect(serialized).not.toMatch(/externalId|providerIds|checksum|initiatedBy|expectedFilename/);
  });

  it('has no duplicate external IDs or player-game-team identities', async () => {
    const client = requirePrisma(prisma);
    const duplicateExternalIds = await client.$queryRaw<readonly { count: bigint }[]>`
      SELECT count(*) AS count FROM (
        SELECT provider, external_id FROM player_external_identifiers
        GROUP BY provider, external_id HAVING count(*) > 1
      ) duplicates`;
    const duplicateStats = await client.$queryRaw<readonly { count: bigint }[]>`
      SELECT count(*) AS count FROM (
        SELECT player_id, game_id, team_id FROM player_game_stats
        GROUP BY player_id, game_id, team_id HAVING count(*) > 1
      ) duplicates`;
    expect(duplicateExternalIds[0]?.count).toBe(0n);
    expect(duplicateStats[0]?.count).toBe(0n);
  });
});

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (prisma === undefined) throw new Error('Historical integration client was not initialized.');
  return prisma;
}

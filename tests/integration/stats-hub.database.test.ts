import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/common/database/prisma.js';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaStatsHubRepository } from '../../src/modules/stats-hub/stats.repository.js';
import { StatsHubService } from '../../src/modules/stats-hub/stats.service.js';

const enabled = process.env.RUN_STATS_HUB_DATABASE_TESTS === 'true';

describe.skipIf(!enabled)('Stats Hub database', () => {
  let prisma: PrismaClient | undefined;
  let service: StatsHubService | undefined;

  beforeAll(() => {
    prisma = createPrismaClient(resolveTestDatabaseUrl());
    service = new StatsHubService(new PrismaStatsHubRepository(prisma));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('reports exact imported coverage and the conservative public registry', async () => {
    const result = await requireService(service).getMetadata();
    expect(result.data.availableSeasons).toEqual([2020, 2021, 2022, 2023, 2024, 2025]);
    expect(result.data.metrics).toHaveLength(20);
    expect(result.data.positionGroups).toEqual([
      'DB',
      'DL',
      'LB',
      'OL',
      'QB',
      'RB',
      'SPEC',
      'TE',
      'WR',
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /sourceField|seasonFields|externalId|checksum|sourceRowHash|filePath|initiatedBy/,
    );
  });

  it('returns deterministic season leaders across every supported category', async () => {
    for (const metric of [
      'passing_yards',
      'rushing_yards',
      'receiving_yards',
      'sacks',
      'field_goals_made',
    ]) {
      const result = await requireService(service).getSeasonLeaders({
        season: 2025,
        seasonType: 'REG',
        metric,
        limit: 25,
      });
      expect(result.data).toHaveLength(25);
      expect(result.data[0]?.rank).toBe(1);
      expect(result.meta.metric.id).toBe(metric);
      expectNonIncreasing(result.data.map(({ metricValue }) => metricValue));
    }
  });

  it('preserves rank continuity and stable identities across cursor pages', async () => {
    const first = await requireService(service).getSeasonLeaders({
      season: 2025,
      seasonType: 'REG',
      metric: 'passing_yards',
      limit: 5,
    });
    expect(first.meta.nextCursor).not.toBeNull();
    const second = await requireService(service).getSeasonLeaders({
      season: 2025,
      seasonType: 'REG',
      metric: 'passing_yards',
      limit: 5,
      cursor: first.meta.nextCursor ?? undefined,
    });
    const firstIds = new Set(first.data.map(({ player }) => player.id));
    expect(second.data.every(({ player }) => !firstIds.has(player.id))).toBe(true);
    expect(second.data[0]?.rank).toBeGreaterThanOrEqual(first.data.at(-1)?.rank ?? 0);
  });

  it('supports explicit season types, position filters, team splits, zeroes, and ties', async () => {
    const postseason = await requireService(service).getSeasonLeaders({
      season: 2025,
      seasonType: 'POST',
      metric: 'passing_yards',
      limit: 5,
    });
    const combined = await requireService(service).getSeasonLeaders({
      season: 2025,
      seasonType: 'REG_POST',
      metric: 'passing_yards',
      limit: 5,
    });
    expect(postseason.data.every(({ seasonType }) => seasonType === 'POST')).toBe(true);
    expect(combined.data.every(({ seasonType }) => seasonType === 'REG_POST')).toBe(true);

    const team = await requirePrisma(prisma).team.findFirstOrThrow({
      where: { abbreviation: 'KC', league: 'NFL' },
      select: { id: true },
    });
    const teamSplit = await requireService(service).getSeasonLeaders({
      season: 2025,
      seasonType: 'REG',
      metric: 'receiving_yards',
      teamId: team.id,
      positionGroup: 'WR',
      limit: 10,
    });
    expect(teamSplit.data.every(({ player }) => player.positionGroup === 'WR')).toBe(true);
    expect(
      teamSplit.data.every(
        ({ teamContext }) => teamContext.type === 'SINGLE' && teamContext.teams[0]?.id === team.id,
      ),
    ).toBe(true);

    const recordedZeroes = await requireService(service).getSeasonLeaders({
      season: 2025,
      seasonType: 'REG',
      metric: 'passing_yards',
      positionGroup: 'OL',
      limit: 10,
    });
    expect(recordedZeroes.data).toHaveLength(10);
    expect(
      recordedZeroes.data.every(
        ({ metricValue, rank, tied }) => metricValue === 0 && rank === 1 && tied,
      ),
    ).toBe(true);
  });

  it('returns weekly game context and chronological recent appearances', async () => {
    const weekly = await requireService(service).getWeeklyLeaders({
      season: 2025,
      week: 10,
      seasonType: 'REG',
      metric: 'passing_yards',
      limit: 25,
    });
    expect(weekly.data).not.toHaveLength(0);
    const weeklyLeader = weekly.data[0];
    if (weeklyLeader === undefined) throw new Error('Expected a weekly leader.');
    expect(weeklyLeader).toMatchObject({
      rank: 1,
      season: 2025,
      week: 10,
    });
    expect(weeklyLeader.team.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(weeklyLeader.opponent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(weeklyLeader.gameId).toMatch(/^[0-9a-f-]{36}$/);

    const player = await requirePrisma(prisma).player.findFirstOrThrow({
      where: { displayName: 'Patrick Mahomes' },
      select: { id: true },
    });
    const recent = await requireService(service).getRecentPerformance({
      playerId: player.id,
      metric: 'passing_yards',
      games: 5,
    });
    expect(recent.data.performances).toHaveLength(5);
    const chronology = recent.data.performances.map(
      ({ season, seasonType, week }) => season * 100 + (seasonType === 'POST' ? 50 : 0) + week,
    );
    expect(chronology).toEqual([...chronology].sort((left, right) => left - right));
    expect(recent.data.summary.gamesRepresented).toBe(5);
  });
});

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (prisma === undefined) throw new Error('Stats Hub database client was not initialized.');
  return prisma;
}

function requireService(service: StatsHubService | undefined): StatsHubService {
  if (service === undefined) throw new Error('Stats Hub service was not initialized.');
  return service;
}

function expectNonIncreasing(values: readonly number[]): void {
  for (let index = 1; index < values.length; index += 1)
    expect(values[index]).toBeLessThanOrEqual(values[index - 1] ?? Number.POSITIVE_INFINITY);
}

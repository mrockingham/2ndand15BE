import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient, TeamProviderMapping } from '../../generated/prisma/client.js';
import { createTeamRecord } from '../teams/team.test-fixtures.js';
import { mockNflTeamsFixture } from './providers/mock/nfl-teams.fixture.js';
import type { SportsDataProvider } from './sports-data-provider.js';
import { syncTeams } from './sync-teams.js';

const buffalo = mockNflTeamsFixture[3];
const normalized = { ...buffalo, provider: 'api-sports', providerTeamId: '20' };

describe('syncTeams', () => {
  it('matches an existing team without duplication and creates its API-Sports mapping', async () => {
    const harness = createPrisma([]);
    const result = await syncTeams(createProvider(), harness.prisma, {
      allowCreate: false,
      updateDisplayFields: false,
    });

    expect(result).toMatchObject({
      providerRecordsReceived: 1,
      teamsMatched: 1,
      teamsCreated: 0,
      mappingsCreated: 1,
      failed: 0,
    });
    expect(harness.createTeam).not.toHaveBeenCalled();
    expect(harness.createMapping).toHaveBeenCalledWith({
      data: {
        teamId: '00000000-0000-4000-8000-000000000001',
        provider: 'api-sports',
        providerTeamId: '20',
      },
    });
  });

  it('is idempotent when the provider mapping already exists', async () => {
    const harness = createPrisma([mapping()]);
    const result = await syncTeams(createProvider(), harness.prisma, {
      allowCreate: false,
      updateDisplayFields: false,
    });
    expect(result).toMatchObject({
      teamsMatched: 1,
      teamsCreated: 0,
      teamsUpdated: 0,
      mappingsCreated: 0,
      mappingsUpdated: 0,
      skipped: 1,
    });
    expect(harness.createMapping).not.toHaveBeenCalled();
    expect(harness.updateMapping).not.toHaveBeenCalled();
  });

  it('reports an unresolved API-Sports team instead of creating a duplicate', async () => {
    const provider: SportsDataProvider = {
      ...createProvider(),
      getTeams: () =>
        Promise.resolve({
          provider: 'api-sports',
          received: 1,
          records: [{ ...normalized, abbreviation: 'ZZZ', fullName: 'Unknown Team' }],
          failures: [],
        }),
    };
    const harness = createPrisma([]);
    const result = await syncTeams(provider, harness.prisma, { allowCreate: false });
    expect(result).toMatchObject({ teamsMatched: 0, teamsCreated: 0, failed: 1 });
    expect(harness.createTeam).not.toHaveBeenCalled();
  });
});

function createProvider(): SportsDataProvider {
  return {
    getTeams: () =>
      Promise.resolve({
        provider: 'api-sports',
        received: 1,
        records: [normalized],
        failures: [],
      }),
    getGames: () =>
      Promise.resolve({ provider: 'api-sports', received: 0, records: [], failures: [] }),
    getGameByProviderId: () => Promise.resolve(null),
  };
}

function mapping(): TeamProviderMapping {
  return {
    id: '00000000-0000-4000-8000-000000000020',
    teamId: '00000000-0000-4000-8000-000000000001',
    provider: 'api-sports',
    providerTeamId: '20',
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
  };
}

function createPrisma(providerMaps: readonly TeamProviderMapping[]) {
  const createTeam = vi.fn();
  const updateTeam = vi.fn();
  const createMapping = vi.fn().mockResolvedValue({});
  const updateMapping = vi.fn().mockResolvedValue({});
  const transaction = {
    team: { create: createTeam, update: updateTeam },
    teamProviderMapping: { create: createMapping, update: updateMapping },
  };
  const prisma = {
    team: {
      findMany: vi.fn().mockResolvedValue([{ ...createTeamRecord(), providerMaps }]),
    },
    $transaction: (callback: (value: typeof transaction) => Promise<void>) => callback(transaction),
  } as unknown as PrismaClient;
  return { prisma, createTeam, updateTeam, createMapping, updateMapping };
}

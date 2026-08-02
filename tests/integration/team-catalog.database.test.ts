import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/common/database/prisma.js';
import { loadDatabaseConfig } from '../../src/config/env.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaTeamRepository } from '../../src/modules/teams/team.repository.js';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!databaseTestsEnabled)('seeded team catalog database', () => {
  let prisma: PrismaClient | undefined;

  beforeAll(() => {
    prisma = createPrismaClient(loadDatabaseConfig().databaseUrl);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('contains exactly 32 active NFL teams and 32 unique mock mappings', async () => {
    const client = requirePrisma(prisma);

    await expect(client.team.count({ where: { league: 'NFL', isActive: true } })).resolves.toBe(32);
    await expect(client.teamProviderMapping.count({ where: { provider: 'mock' } })).resolves.toBe(
      32,
    );

    const mappings = await client.teamProviderMapping.findMany({
      where: { provider: 'mock' },
      select: { teamId: true, providerTeamId: true },
    });
    expect(new Set(mappings.map((mapping) => mapping.teamId)).size).toBe(32);
    expect(new Set(mappings.map((mapping) => mapping.providerTeamId)).size).toBe(32);
  });

  it('returns the complete catalog in stable order', async () => {
    const teams = await new PrismaTeamRepository(requirePrisma(prisma)).findActiveTeams();
    const orderingKeys = teams.map(
      (team) => `${team.conference}:${team.division}:${team.fullName}`,
    );

    expect(teams).toHaveLength(32);
    expect(orderingKeys).toEqual([...orderingKeys].sort());
  });
});

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (prisma === undefined) {
    throw new Error('Database integration test client was not initialized.');
  }
  return prisma;
}

import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/common/database/prisma.js';
import { loadDatabaseConfig } from '../../src/config/env.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaAdminRepository } from '../../src/modules/admin/admin.repository.js';
import { AdminService } from '../../src/modules/admin/admin.service.js';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!databaseTestsEnabled)('administrative schedule database integration', () => {
  let prisma: PrismaClient | undefined;
  const gameIds = new Set<string>();
  const userIds = new Set<string>();
  const auditRequestPrefix = `admin-db-${randomUUID()}`;

  beforeAll(async () => {
    prisma = createPrismaClient(loadDatabaseConfig().databaseUrl);
    await prisma.game.deleteMany({
      where: {
        provenance: {
          is: {
            sourceName: { in: ['Database integration fixture', 'Database import fixture'] },
          },
        },
      },
    });
    await prisma.user.deleteMany({ where: { normalizedEmail: { startsWith: 'admin-db-' } } });
    await prisma.adminAuditEvent.deleteMany({
      where: { requestId: { startsWith: 'admin-db-' } },
    });
  });

  afterAll(async () => {
    const client = requirePrisma(prisma);
    if (gameIds.size > 0) await client.game.deleteMany({ where: { id: { in: [...gameIds] } } });
    if (userIds.size > 0) await client.user.deleteMany({ where: { id: { in: [...userIds] } } });
    await client.adminAuditEvent.deleteMany({
      where: { requestId: { startsWith: auditRequestPrefix } },
    });
    await client.$disconnect();
  });

  it('persists roles, imports, overrides, verification, constraints, and sanitized audit history', async () => {
    const client = requirePrisma(prisma);
    const repository = new PrismaAdminRepository(client);
    const service = new AdminService(repository, () => new Date('2026-08-02T12:00:00Z'));
    const email = `admin-db-${randomUUID()}@example.com`;
    const user = await client.user.create({
      data: {
        email,
        normalizedEmail: email,
        passwordHash: 'database-test-hash',
      },
    });
    userIds.add(user.id);
    expect(user.role).toBe('USER');
    const promoted = await service.setRole(user.email, 'EDITOR', {
      userId: null,
      emailSnapshot: 'admin:set-role-cli',
      requestId: `${auditRequestPrefix}-role`,
    });
    expect(promoted).toMatchObject({ previousRole: 'USER', role: 'EDITOR' });

    const teams = await client.team.findMany({
      where: { isActive: true },
      take: 2,
      orderBy: { id: 'asc' },
    });
    const home = requireValue(teams.at(0));
    const away = requireValue(teams.at(1));
    const principal = { userId: user.id, email: user.email, role: 'EDITOR' as const };
    const created = await service.createGame(
      {
        season: 2035,
        seasonType: 'REG',
        week: 1,
        startTime: '2035-09-01T20:00:00Z',
        status: 'SCHEDULED',
        homeTeamId: home.id,
        awayTeamId: away.id,
        venueName: 'Fictional Stadium',
        venueCity: 'Example City',
        broadcastNetwork: null,
        isNeutralSite: false,
        provenance: { sourceName: 'Database integration fixture', externalReference: randomUUID() },
      },
      principal,
      `${auditRequestPrefix}-create`,
    );
    gameIds.add(created.id);

    await service.upsertOverride(
      created.id,
      { venueName: 'Corrected Stadium' },
      principal,
      `${auditRequestPrefix}-override-1`,
    );
    const partial = await service.upsertOverride(
      created.id,
      { status: 'POSTPONED' },
      principal,
      `${auditRequestPrefix}-override-2`,
    );
    expect(partial.resolved).toMatchObject({
      status: 'POSTPONED',
      venue: { name: 'Corrected Stadium' },
    });
    const cleared = await service.upsertOverride(
      created.id,
      { venueName: null },
      principal,
      `${auditRequestPrefix}-override-clear`,
    );
    expect(cleared.resolved.venue.name).toBe('Fictional Stadium');

    const verified = await service.verifyGame(
      created.id,
      { sourceName: 'Verified fictional source', sourceUrl: 'https://example.com/schedule' },
      principal,
      `${auditRequestPrefix}-verify`,
    );
    expect(verified.provenance?.verifiedAt).not.toBeNull();
    await service.upsertOverride(
      created.id,
      { week: 2 },
      principal,
      `${auditRequestPrefix}-verification-clear`,
    );
    expect((await service.getGame(created.id)).provenance?.verifiedAt).toBeNull();

    await expect(
      client.gameEditorialOverride.create({
        data: {
          gameId: created.id,
          week: 3,
          createdBySnapshot: 'duplicate@example.com',
          updatedBySnapshot: 'duplicate@example.com',
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      client.gameEditorialOverride.update({ where: { gameId: created.id }, data: { week: 23 } }),
    ).rejects.toBeDefined();

    const row = {
      season: 2036,
      seasonType: 'PRE' as const,
      week: 1,
      startTime: '2036-08-01T20:00:00Z',
      awayTeam: away.abbreviation,
      homeTeam: home.abbreviation,
      status: 'SCHEDULED' as const,
      venueName: 'Import Fixture Stadium',
      venueCity: 'Example City',
      broadcastNetwork: null,
      isNeutralSite: false,
      sourceName: 'Database import fixture',
      sourceType: 'DEVELOPMENT_FIXTURE' as const,
      sourceUrl: null,
      externalReference: `fixture-${randomUUID()}`,
      notes: 'Fictional test data',
    };
    await expect(
      service.importSchedule({ rows: [row], dryRun: true }, principal, `${auditRequestPrefix}-dry`),
    ).resolves.toMatchObject({ created: 1, dryRun: true });
    const written = await service.importSchedule(
      { rows: [row], dryRun: false },
      principal,
      `${auditRequestPrefix}-import`,
    );
    expect(written).toMatchObject({ created: 1, failed: 0 });
    const imported = await client.gameProvenance.findFirstOrThrow({
      where: { sourceName: row.sourceName, externalReference: row.externalReference },
    });
    gameIds.add(imported.gameId);
    await expect(
      service.importSchedule(
        { rows: [row], dryRun: false },
        principal,
        `${auditRequestPrefix}-repeat`,
      ),
    ).resolves.toMatchObject({ created: 0, updated: 0, skipped: 1 });

    const audit = await client.adminAuditEvent.findMany({
      where: { requestId: { startsWith: auditRequestPrefix } },
    });
    expect(audit.length).toBeGreaterThanOrEqual(8);
    expect(JSON.stringify(audit)).not.toMatch(/database-test-hash|authorization|refreshToken/i);
  }, 15_000);
});

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (prisma === undefined)
    throw new Error('Database integration test client was not initialized.');
  return prisma;
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected two active teams in the database.');
  return value;
}

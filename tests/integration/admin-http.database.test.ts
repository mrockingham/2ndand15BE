import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createPrismaClient } from '../../src/common/database/prisma.js';
import { JwtAccessTokenService } from '../../src/common/security/access-token.js';
import { loadConfig } from '../../src/config/env.js';
import type { PrismaClient, UserRole } from '../../src/generated/prisma/client.js';
import { PrismaAdminRepository } from '../../src/modules/admin/admin.repository.js';
import { AdminService } from '../../src/modules/admin/admin.service.js';
import { PrismaGameRepository } from '../../src/modules/games/game.repository.js';
import { GameService } from '../../src/modules/games/game.service.js';
import { PrismaTeamRepository } from '../../src/modules/teams/team.repository.js';
import { TeamService } from '../../src/modules/teams/team.service.js';
import { createTestAuthService, createTestUserService } from '../helpers/test-config.js';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!databaseTestsEnabled)('administrative HTTP database smoke', () => {
  let prisma: PrismaClient | undefined;
  const userIds = new Set<string>();
  const gameIds = new Set<string>();

  beforeAll(() => {
    prisma = createPrismaClient(resolveTestDatabaseUrl());
  });

  afterAll(async () => {
    const client = requirePrisma(prisma);
    if (gameIds.size > 0) await client.game.deleteMany({ where: { id: { in: [...gameIds] } } });
    await client.adminAuditEvent.deleteMany({
      where: {
        OR: [{ actorUserId: { in: [...userIds] } }, { entityId: { in: [...gameIds, ...userIds] } }],
      },
    });
    if (userIds.size > 0) await client.user.deleteMany({ where: { id: { in: [...userIds] } } });
    await client.$disconnect();
  });

  it('enforces roles and exposes only resolved public values through the full HTTP stack', async () => {
    const client = requirePrisma(prisma);
    const config = loadConfig();
    const accessTokens = new JwtAccessTokenService({
      secret: config.auth.accessTokenSecret,
      expiresInSeconds: config.auth.accessTokenTtlSeconds,
    });
    const repository = new PrismaAdminRepository(client);
    const adminService = new AdminService(repository);
    const gameReader = new GameService(new PrismaGameRepository(client, 'none'), () => new Date(), {
      currentNflSeason: 2098,
      allowHistoricalDefaultGameResults: false,
    });
    const app = createApp({
      config,
      logger: pino({ level: 'silent' }),
      teamReader: new TeamService(new PrismaTeamRepository(client)),
      gameReader,
      authService: createTestAuthService(),
      userService: createTestUserService(),
      accessTokens,
      adminService,
      adminIdentities: repository,
    });
    const normal = await createUser(client, 'USER');
    const editor = await createUser(client, 'EDITOR');
    const admin = await createUser(client, 'ADMIN');
    const normalToken = await accessTokens.sign({ userId: normal.id, sessionId: randomUUID() });
    const editorToken = await accessTokens.sign({ userId: editor.id, sessionId: randomUUID() });
    const adminToken = await accessTokens.sign({ userId: admin.id, sessionId: randomUUID() });

    await request(app).get('/api/v1/admin/games').expect(401);
    await request(app)
      .get('/api/v1/admin/games')
      .set('authorization', `Bearer ${normalToken}`)
      .expect(403);
    await request(app)
      .get('/api/v1/admin/audit-events')
      .set('authorization', `Bearer ${editorToken}`)
      .expect(403);

    const teams = await client.team.findMany({
      where: { isActive: true },
      take: 2,
      orderBy: { id: 'asc' },
    });
    const home = requireValue(teams.at(0));
    const away = requireValue(teams.at(1));
    const created = await request(app)
      .post('/api/v1/admin/games')
      .set('authorization', `Bearer ${editorToken}`)
      .set('x-request-id', 'admin-http-create')
      .send({
        season: 2098,
        seasonType: 'REG',
        week: 1,
        startTime: '2098-09-01T20:00:00Z',
        status: 'SCHEDULED',
        homeTeamId: home.id,
        awayTeamId: away.id,
        venueName: 'Base Development Stadium',
        venueCity: 'Example City',
        broadcastNetwork: null,
        isNeutralSite: false,
        provenance: { sourceName: 'HTTP development fixture', externalReference: randomUUID() },
      })
      .expect(201);
    const createdBody = created.body as { data: { id: string } };
    gameIds.add(createdBody.data.id);

    await request(app)
      .put(`/api/v1/admin/games/${createdBody.data.id}/override`)
      .set('authorization', `Bearer ${editorToken}`)
      .send({ venueName: 'Corrected Development Stadium', status: 'POSTPONED' })
      .expect(200);
    const publicGame = await request(app).get(`/api/v1/games/${createdBody.data.id}`).expect(200);
    expect(publicGame.body as unknown).toMatchObject({
      data: {
        status: 'POSTPONED',
        venue: { name: 'Corrected Development Stadium' },
      },
    });
    expect(JSON.stringify(publicGame.body)).not.toMatch(/internalNote|providerMaps|provenance/i);

    await request(app)
      .delete(`/api/v1/admin/games/${createdBody.data.id}/override`)
      .set('authorization', `Bearer ${editorToken}`)
      .expect(403);
    await request(app)
      .get('/api/v1/admin/audit-events')
      .set('authorization', `Bearer ${editorToken}`)
      .expect(403);
    await request(app)
      .get('/api/v1/admin/audit-events?entityType=GAME')
      .set('authorization', `Bearer ${editorToken}`)
      .expect(200);
    await request(app)
      .delete(`/api/v1/admin/games/${createdBody.data.id}/override`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    const audit = await request(app)
      .get('/api/v1/admin/audit-events?entityType=GAME')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    const auditBody = audit.body as { data?: unknown };
    expect(Array.isArray(auditBody.data)).toBe(true);
  }, 30_000);

  async function createUser(client: PrismaClient, role: UserRole) {
    const email = `admin-http-${role.toLowerCase()}-${randomUUID()}@example.com`;
    const user = await client.user.create({
      data: { email, normalizedEmail: email, passwordHash: 'http-smoke-hash', role },
    });
    userIds.add(user.id);
    return user;
  }
});

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (prisma === undefined)
    throw new Error('Database integration test client was not initialized.');
  return prisma;
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected active team data.');
  return value;
}

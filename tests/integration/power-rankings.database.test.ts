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
import { PrismaPowerRankingRepository } from '../../src/modules/power-rankings/power-ranking.repository.js';
import { PowerRankingService } from '../../src/modules/power-rankings/power-ranking.service.js';
import { PrismaTeamRepository } from '../../src/modules/teams/team.repository.js';
import { TeamService } from '../../src/modules/teams/team.service.js';
import { PrismaGameRepository } from '../../src/modules/games/game.repository.js';
import { GameService } from '../../src/modules/games/game.service.js';
import { createTestAuthService, createTestUserService } from '../helpers/test-config.js';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!databaseTestsEnabled)(
  'power rankings database and HTTP integration (M43A)',
  () => {
    let prisma: PrismaClient | undefined;
    const userIds = new Set<string>();
    const editionIds = new Set<string>();
    const auditPrefix = `power-rankings-${randomUUID()}`;

    beforeAll(() => {
      prisma = createPrismaClient(resolveTestDatabaseUrl());
    });

    afterAll(async () => {
      const client = requirePrisma(prisma);
      if (editionIds.size > 0) {
        await client.powerRankingEntry.deleteMany({
          where: { editionId: { in: [...editionIds] } },
        });
        await client.powerRankingEdition.deleteMany({ where: { id: { in: [...editionIds] } } });
      }
      await client.adminAuditEvent.deleteMany({
        where: {
          OR: [
            { requestId: { startsWith: auditPrefix } },
            { entityId: { in: [...editionIds] } },
            { actorUserId: { in: [...userIds] } },
          ],
        },
      });
      if (userIds.size > 0) await client.user.deleteMany({ where: { id: { in: [...userIds] } } });
      await client.$disconnect();
    });

    function buildApp(client: PrismaClient) {
      const config = loadConfig();
      const accessTokens = new JwtAccessTokenService({
        secret: config.auth.accessTokenSecret,
        expiresInSeconds: config.auth.accessTokenTtlSeconds,
      });
      const repository = new PrismaPowerRankingRepository(client);
      const service = new PowerRankingService(repository);
      const identities = new PrismaAdminRepository(client);
      const app = createApp({
        config,
        logger: pino({ level: 'silent' }),
        teamReader: new TeamService(new PrismaTeamRepository(client)),
        gameReader: new GameService(new PrismaGameRepository(client, 'none'), () => new Date(), {
          currentNflSeason: 2099,
          allowHistoricalDefaultGameResults: false,
        }),
        authService: createTestAuthService(),
        userService: createTestUserService(),
        accessTokens,
        adminIdentities: identities,
        powerRankingsService: service,
      });
      return { app, service, accessTokens };
    }

    it('rejects unauthorized roles, previews imports read-only, imports/publishes/reorders/updates a full edition, preserves history, and audits every step', async () => {
      const client = requirePrisma(prisma);
      const { app, service, accessTokens } = buildApp(client);

      const user = await createUser(client, 'USER', userIds);
      const editor = await createUser(client, 'EDITOR', userIds);
      const userToken = await accessTokens.sign({ userId: user.id, sessionId: randomUUID() });
      const editorToken = await accessTokens.sign({ userId: editor.id, sessionId: randomUUID() });
      const editorPrincipal = { userId: editor.id, email: editor.email, role: editor.role };

      const activeTeams = await client.team.findMany({
        where: { league: 'NFL', isActive: true },
        orderBy: { fullName: 'asc' },
      });
      expect(activeTeams.length).toBe(32);

      const season = 2100 + Math.floor(Math.random() * 1000); // unique per test run, never a real season
      const editionSlug = `fictional-preseason-${randomUUID()}`;
      const document = {
        title: 'Fictional Power Rankings',
        season,
        edition: editionSlug,
        asOf: '2026-08-30T00:00:00.000Z',
        methodology: 'A fictional methodology for integration coverage.',
        sources: ['DAZN', 'PFT / NBC Sports', 'Kalshi'],
        subtitle: 'Fictional Edition',
        rankings: activeTeams.map((team, index) => ({
          rank: index + 1,
          teamId: slugify(team.fullName),
          team: team.fullName,
          abbreviation: team.abbreviation,
          conference: team.conference,
          division: team.division,
          tier: index < 8 ? 'Contender' : 'Rebuilding',
          headline: `A fictional headline for ${team.fullName}`,
          summary: `A fictional forty-plus character summary for ${team.fullName} used for testing.`,
          strengths: ['A fictional strength'],
          concerns: ['A fictional concern'],
        })),
      };

      // Unauthorized: a plain USER cannot even preview.
      await request(app)
        .post('/api/v1/admin/power-rankings/import')
        .set('authorization', `Bearer ${userToken}`)
        .send({ data: document, mode: 'PREVIEW' })
        .expect(403);

      // PREVIEW makes zero writes.
      const beforeCount = await client.powerRankingEdition.count({ where: { season } });
      const preview = await request(app)
        .post('/api/v1/admin/power-rankings/import')
        .set('authorization', `Bearer ${editorToken}`)
        .send({ data: document, mode: 'PREVIEW' })
        .expect(200);
      expect(
        (preview.body as { data: { valid: boolean; teamMatches: unknown[] } }).data,
      ).toMatchObject({ valid: true });
      expect((preview.body as { data: { teamMatches: unknown[] } }).data.teamMatches).toHaveLength(
        32,
      );
      expect(await client.powerRankingEdition.count({ where: { season } })).toBe(beforeCount);

      // UPSERT + publish=true in one call.
      const imported = await request(app)
        .post('/api/v1/admin/power-rankings/import')
        .set('authorization', `Bearer ${editorToken}`)
        .set('x-request-id', `${auditPrefix}-import`)
        .send({ data: document, mode: 'UPSERT', publish: true })
        .expect(200);
      const editionId = (imported.body as { data: { edition: { id: string; status: string } } })
        .data.edition.id;
      editionIds.add(editionId);
      expect((imported.body as { data: { edition: { status: string } } }).data.edition.status).toBe(
        'PUBLISHED',
      );

      // Draft is excluded from the public API, but this one is now published.
      const publicGet = await request(app)
        .get(`/api/v1/power-rankings?season=${String(season)}&edition=${editionSlug}`)
        .expect(200);
      expect((publicGet.body as { data: { rankings: unknown[] } }).data.rankings).toHaveLength(32);
      const firstPublic = (
        publicGet.body as { data: { rankings: { rank: number; team: { abbreviation: string } }[] } }
      ).data.rankings[0];
      expect(firstPublic).toMatchObject({
        rank: 1,
        team: { abbreviation: activeTeams[0]?.abbreviation },
      });

      const editionRecord = await client.powerRankingEdition.findUniqueOrThrow({
        where: { id: editionId },
        include: { entries: { orderBy: { rank: 'asc' } } },
      });
      expect(editionRecord.entries).toHaveLength(32);
      expect(new Set(editionRecord.entries.map((entry) => entry.rank)).size).toBe(32);

      // Safe rank reordering: move the last-ranked entry to rank 1.
      const orderedIds = editionRecord.entries.map((entry) => entry.id);
      const moved = orderedIds.pop();
      if (moved === undefined) throw new Error('expected at least one entry');
      orderedIds.unshift(moved);
      await request(app)
        .post(`/api/v1/admin/power-rankings/${editionId}/entries/reorder`)
        .set('authorization', `Bearer ${editorToken}`)
        .set('x-request-id', `${auditPrefix}-reorder`)
        .send({ orderedEntryIds: orderedIds })
        .expect(200);
      const reordered = await client.powerRankingEntry.findMany({ where: { editionId } });
      expect(new Set(reordered.map((entry) => entry.rank))).toEqual(
        new Set(Array.from({ length: 32 }, (_, i) => i + 1)),
      );
      const movedEntry = await client.powerRankingEntry.findUniqueOrThrow({ where: { id: moved } });
      expect(movedEntry.rank).toBe(1);

      // Single-entry admin update with a rank change: movement is derived, not
      // trusted from client input.
      const target = reordered.find((entry) => entry.id !== moved);
      if (target === undefined) throw new Error('expected a second entry');
      await client.powerRankingEntry.update({
        where: { id: target.id },
        data: { previousRank: 8 },
      });
      const updated = await request(app)
        .patch(`/api/v1/admin/power-rankings/${editionId}/entries/${target.id}`)
        .set('authorization', `Bearer ${editorToken}`)
        .set('x-request-id', `${auditPrefix}-entry-update`)
        .send({ rank: 5, headline: 'An updated fictional headline' })
        .expect(200);
      const updatedEntry = (
        updated.body as {
          data: {
            entries: { id: string; rank: number; movement: number | null; headline: string }[];
          };
        }
      ).data.entries.find((entry) => entry.id === target.id);
      expect(updatedEntry).toMatchObject({
        rank: 5,
        movement: 3,
        headline: 'An updated fictional headline',
      });

      // A second, historical edition (a later week) must never overwrite this one.
      const secondEditionSlug = 'week-1';
      const secondResult = await service.upsertImport(
        { ...document, edition: secondEditionSlug, title: 'Fictional Week 1 Power Rankings' },
        false,
        editorPrincipal,
        `${auditPrefix}-second-edition`,
      );
      editionIds.add(secondResult.edition.id);
      const firstStillThere = await client.powerRankingEdition.findUniqueOrThrow({
        where: { id: editionId },
      });
      expect(firstStillThere.status).toBe('PUBLISHED');
      expect(firstStillThere.edition).toBe(editionSlug);
      const secondStillDraft = await client.powerRankingEdition.findUniqueOrThrow({
        where: { id: secondResult.edition.id },
      });
      expect(secondStillDraft.status).toBe('DRAFT');
      // The historical (first) edition is unaffected by the second import.
      const firstEntries = await client.powerRankingEntry.count({ where: { editionId } });
      expect(firstEntries).toBe(32);

      // Audit rows exist for every step above.
      const auditActions = await client.adminAuditEvent.findMany({
        where: { entityType: 'POWER_RANKING', entityId: { in: [editionId] } },
        select: { action: true },
      });
      const actionSet = new Set(auditActions.map((event) => event.action));
      expect(actionSet.has('POWER_RANKING_BATCH_IMPORTED')).toBe(true);
      expect(actionSet.has('POWER_RANKING_PUBLISHED')).toBe(true);
      expect(actionSet.has('POWER_RANKING_REORDERED')).toBe(true);
      expect(actionSet.has('POWER_RANKING_ENTRY_UPDATED')).toBe(true);
    }, 60_000);

    it('rejects a batch import containing one invalid entry without writing anything', async () => {
      const client = requirePrisma(prisma);
      const { app } = buildApp(client);
      const editor = await createUser(client, 'EDITOR', userIds);
      const accessTokens = new JwtAccessTokenService({
        secret: loadConfig().auth.accessTokenSecret,
        expiresInSeconds: loadConfig().auth.accessTokenTtlSeconds,
      });
      const editorToken = await accessTokens.sign({ userId: editor.id, sessionId: randomUUID() });

      const activeTeams = await client.team.findMany({
        where: { league: 'NFL', isActive: true },
        orderBy: { fullName: 'asc' },
        take: 3,
      });
      const season = 3000 + Math.floor(Math.random() * 1000);
      const editionSlug = `fictional-invalid-${randomUUID()}`;
      const document = {
        title: 'Fictional Invalid Import',
        season,
        edition: editionSlug,
        asOf: '2026-08-30T00:00:00.000Z',
        methodology: 'A fictional methodology.',
        sources: ['DAZN'],
        rankings: activeTeams.map((team, index) => ({
          rank: index + 1,
          teamId: slugify(team.fullName),
          team: team.fullName,
          // The second entry's abbreviation deliberately disagrees with the
          // matched canonical Team -- the whole import must be rejected, not
          // partially applied.
          abbreviation: index === 1 ? 'ZZZ' : team.abbreviation,
          conference: team.conference,
          division: team.division,
          tier: 'Contender',
          headline: `A fictional headline for ${team.fullName}`,
          summary: `A fictional forty-plus character summary for ${team.fullName} used for testing.`,
          strengths: ['A fictional strength'],
          concerns: ['A fictional concern'],
        })),
      };

      const response = await request(app)
        .post('/api/v1/admin/power-rankings/import')
        .set('authorization', `Bearer ${editorToken}`)
        .send({ data: document, mode: 'UPSERT' })
        .expect(422);
      expect((response.body as { error: { code: string } }).error.code).toBe(
        'POWER_RANKING_IMPORT_INVALID',
      );
      expect(await client.powerRankingEdition.count({ where: { season } })).toBe(0);
    }, 30_000);
  },
);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function createUser(client: PrismaClient, role: UserRole, ids: Set<string>) {
  const email = `power-rankings-${role.toLowerCase()}-${randomUUID()}@example.com`;
  const user = await client.user.create({
    data: { email, normalizedEmail: email, passwordHash: 'power-rankings-test-hash', role },
  });
  ids.add(user.id);
  return user;
}

function requirePrisma(value: PrismaClient | undefined): PrismaClient {
  if (value === undefined) throw new Error('Database integration test client was not initialized.');
  return value;
}

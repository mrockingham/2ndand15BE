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
import { PrismaArticleRepository } from '../../src/modules/articles/article.repository.js';
import { ArticleService } from '../../src/modules/articles/article.service.js';
import { PrismaGameRepository } from '../../src/modules/games/game.repository.js';
import { GameService } from '../../src/modules/games/game.service.js';
import { PrismaTeamRepository } from '../../src/modules/teams/team.repository.js';
import { TeamService } from '../../src/modules/teams/team.service.js';
import { createTestAuthService, createTestUserService } from '../helpers/test-config.js';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!databaseTestsEnabled)('editorial CMS database and HTTP integration', () => {
  let prisma: PrismaClient | undefined;
  const userIds = new Set<string>();
  const articleIds = new Set<string>();
  const candidateIds = new Set<string>();
  const auditPrefix = `article-cms-${randomUUID()}`;

  beforeAll(() => {
    prisma = createPrismaClient(resolveTestDatabaseUrl());
  });

  afterAll(async () => {
    const client = requirePrisma(prisma);
    if (candidateIds.size > 0) {
      // In case a test failed before it could release these itself: null out
      // the FK/status pair together to satisfy news_candidates_conversion_check
      // before deleting, same as the delete path under test does.
      await client.newsCandidate.updateMany({
        where: { id: { in: [...candidateIds] } },
        data: { status: 'NEW', convertedArticleId: null },
      });
      await client.newsCandidate.deleteMany({ where: { id: { in: [...candidateIds] } } });
    }
    if (articleIds.size > 0) {
      await client.article.deleteMany({ where: { id: { in: [...articleIds] } } });
    }
    await client.adminAuditEvent.deleteMany({
      where: {
        OR: [
          { requestId: { startsWith: auditPrefix } },
          { entityId: { in: [...articleIds] } },
          { actorUserId: { in: [...userIds] } },
        ],
      },
    });
    if (userIds.size > 0) await client.user.deleteMany({ where: { id: { in: [...userIds] } } });
    await client.$disconnect();
  });

  it('enforces roles, lifecycle, visibility, revisions, tags, concurrency, and compact audit data', async () => {
    const client = requirePrisma(prisma);
    const config = loadConfig();
    const accessTokens = new JwtAccessTokenService({
      secret: config.auth.accessTokenSecret,
      expiresInSeconds: config.auth.accessTokenTtlSeconds,
    });
    const repository = new PrismaArticleRepository(client);
    const service = new ArticleService(repository);
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
      articleReader: service,
      editorialArticleService: service,
    });
    const normal = await createUser(client, 'USER', userIds);
    const editor = await createUser(client, 'EDITOR', userIds);
    const admin = await createUser(client, 'ADMIN', userIds);
    const normalToken = await accessTokens.sign({ userId: normal.id, sessionId: randomUUID() });
    const editorToken = await accessTokens.sign({ userId: editor.id, sessionId: randomUUID() });
    const adminToken = await accessTokens.sign({ userId: admin.id, sessionId: randomUUID() });
    const team = await client.team.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    const slug = `fictional-cms-${randomUUID()}`;

    await request(app).get('/api/v1/admin/articles').expect(401);
    await request(app)
      .post('/api/v1/admin/articles')
      .set('authorization', `Bearer ${normalToken}`)
      .send(createBody(slug, team.id))
      .expect(403);
    const created = await request(app)
      .post('/api/v1/admin/articles')
      .set('authorization', `Bearer ${editorToken}`)
      .set('x-request-id', `${auditPrefix}-create`)
      .send(createBody(slug, team.id))
      .expect(201);
    const createdBody = created.body as { data: { id: string; version: number; status: string } };
    articleIds.add(createdBody.data.id);
    expect(createdBody.data).toMatchObject({ version: 1, status: 'DRAFT' });
    await request(app).get(`/api/v1/articles/${slug}`).expect(404);
    const draftList = await request(app).get('/api/v1/articles').expect(200);
    expect(JSON.stringify(draftList.body)).not.toContain(slug);

    const edited = await request(app)
      .patch(`/api/v1/admin/articles/${createdBody.data.id}`)
      .set('authorization', `Bearer ${editorToken}`)
      .set('x-request-id', `${auditPrefix}-edit`)
      .send({ expectedVersion: 1, title: 'Updated fictional CMS article' })
      .expect(200);
    expect((edited.body as { data: { version: number } }).data.version).toBe(2);
    await request(app)
      .patch(`/api/v1/admin/articles/${createdBody.data.id}`)
      .set('authorization', `Bearer ${editorToken}`)
      .send({ expectedVersion: 1, title: 'Stale overwrite' })
      .expect(409);

    const published = await request(app)
      .post(`/api/v1/admin/articles/${createdBody.data.id}/publish`)
      .set('authorization', `Bearer ${editorToken}`)
      .set('x-request-id', `${auditPrefix}-publish`)
      .send({ expectedVersion: 2 })
      .expect(200);
    expect((published.body as { data: { status: string; version: number } }).data).toMatchObject({
      status: 'PUBLISHED',
      version: 3,
    });
    const publicDetail = await request(app).get(`/api/v1/articles/${slug}`).expect(200);
    expect((publicDetail.body as { data: { body: string; teams: unknown[] } }).data).toMatchObject({
      body: '# Fictional CMS article\n\nThis is original development-only content.',
    });
    expect((publicDetail.body as { data: { teams: unknown[] } }).data.teams).toHaveLength(1);
    const publicList = await request(app)
      .get(`/api/v1/articles?team=${team.abbreviation}`)
      .expect(200);
    expect(JSON.stringify(publicList.body)).not.toContain(
      'This is original development-only content',
    );

    const revisions = await request(app)
      .get(`/api/v1/admin/articles/${createdBody.data.id}/revisions`)
      .set('authorization', `Bearer ${editorToken}`)
      .expect(200);
    expect((revisions.body as { data: unknown[] }).data).toHaveLength(3);

    await request(app)
      .post(`/api/v1/admin/articles/${createdBody.data.id}/unpublish`)
      .set('authorization', `Bearer ${editorToken}`)
      .set('x-request-id', `${auditPrefix}-unpublish`)
      .send({ expectedVersion: 3 })
      .expect(200);
    await request(app).get(`/api/v1/articles/${slug}`).expect(404);
    await request(app)
      .post(`/api/v1/admin/articles/${createdBody.data.id}/archive`)
      .set('authorization', `Bearer ${editorToken}`)
      .send({ expectedVersion: 4 })
      .expect(403);
    await request(app)
      .post(`/api/v1/admin/articles/${createdBody.data.id}/archive`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('x-request-id', `${auditPrefix}-archive`)
      .send({ expectedVersion: 4 })
      .expect(200);
    await request(app).get(`/api/v1/articles/${slug}`).expect(404);
    await request(app)
      .post(`/api/v1/admin/articles/${createdBody.data.id}/restore`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('x-request-id', `${auditPrefix}-restore`)
      .send({ expectedVersion: 5 })
      .expect(200);

    const scheduledFor = new Date(Date.now() + 86_400_000);
    await request(app)
      .post(`/api/v1/admin/articles/${createdBody.data.id}/schedule`)
      .set('authorization', `Bearer ${editorToken}`)
      .set('x-request-id', `${auditPrefix}-schedule`)
      .send({ expectedVersion: 6, scheduledFor: scheduledFor.toISOString() })
      .expect(200);
    await request(app).get(`/api/v1/articles/${slug}`).expect(404);
    const afterSchedule = new ArticleService(
      repository,
      () => new Date(scheduledFor.getTime() + 1),
    );
    await expect(afterSchedule.getBySlug(slug)).resolves.toMatchObject({ slug });

    const stored = await client.article.findUniqueOrThrow({
      where: { id: createdBody.data.id },
      include: { teams: true, revisions: true },
    });
    expect(stored.teams).toHaveLength(1);
    expect(
      stored.revisions.map(({ revisionNumber }) => revisionNumber).sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const audits = await client.adminAuditEvent.findMany({
      where: { entityType: 'ARTICLE', entityId: stored.id },
    });
    expect(audits).toHaveLength(7);
    const serializedAudit = JSON.stringify(audits);
    expect(serializedAudit).not.toContain('This is original development-only content');
    expect(serializedAudit).not.toMatch(/authorization|refreshToken|passwordHash/i);
    expect(serializedAudit).toContain('bodySha256');

    await expect(
      client.article.create({
        data: {
          slug: `invalid-curated-${randomUUID()}`,
          type: 'CURATED',
          title: 'Invalid curated fixture',
          summary: 'Missing source fields',
          createdBySnapshot: 'database-fixture',
          updatedBySnapshot: 'database-fixture',
        },
      }),
    ).rejects.toBeDefined();
  }, 30_000);

  it('permanently deletes an article: ADMIN-only, 404 on unknown id, revisions gone, unrelated article untouched, candidate relation safely released, public API no longer serves it', async () => {
    const client = requirePrisma(prisma);
    const config = loadConfig();
    const accessTokens = new JwtAccessTokenService({
      secret: config.auth.accessTokenSecret,
      expiresInSeconds: config.auth.accessTokenTtlSeconds,
    });
    const repository = new PrismaArticleRepository(client);
    const service = new ArticleService(repository);
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
      articleReader: service,
      editorialArticleService: service,
    });
    const editor = await createUser(client, 'EDITOR', userIds);
    const admin = await createUser(client, 'ADMIN', userIds);
    const editorToken = await accessTokens.sign({ userId: editor.id, sessionId: randomUUID() });
    const adminToken = await accessTokens.sign({ userId: admin.id, sessionId: randomUUID() });
    const team = await client.team.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });

    // The article to be deleted: published, with a NewsCandidate that has
    // been fully converted onto it (nullable, optional relation -- exactly
    // the shape that blocks deletion at the DB level via
    // NewsCandidate.convertedArticleId's onDelete: Restrict and the
    // news_candidates_conversion_check CHECK constraint unless the delete
    // path handles it).
    const targetSlug = `fictional-delete-target-${randomUUID()}`;
    const target = await request(app)
      .post('/api/v1/admin/articles')
      .set('authorization', `Bearer ${editorToken}`)
      .set('x-request-id', `${auditPrefix}-delete-target-create`)
      .send(createBody(targetSlug, team.id))
      .expect(201);
    const targetId = (target.body as { data: { id: string } }).data.id;
    articleIds.add(targetId);
    await request(app)
      .post(`/api/v1/admin/articles/${targetId}/publish`)
      .set('authorization', `Bearer ${editorToken}`)
      .send({ expectedVersion: 1 })
      .expect(200);

    const candidate = await client.newsCandidate.create({
      data: {
        sourceId: null,
        sourceNameSnapshot: 'M42B Fictional Publisher',
        canonicalUrl: `https://news.example.com/story/${randomUUID()}`,
        canonicalUrlHash: randomUUID(),
        headline: 'A fictional headline already converted onto the delete target',
        discoveredAt: new Date(),
        status: 'CONVERTED',
        convertedArticleId: targetId,
      },
    });
    candidateIds.add(candidate.id);

    // An unrelated article + its own revisions must be untouched by deleting
    // the target.
    const unrelatedSlug = `fictional-delete-unrelated-${randomUUID()}`;
    const unrelated = await request(app)
      .post('/api/v1/admin/articles')
      .set('authorization', `Bearer ${editorToken}`)
      .set('x-request-id', `${auditPrefix}-delete-unrelated-create`)
      .send(createBody(unrelatedSlug, team.id))
      .expect(201);
    const unrelatedId = (unrelated.body as { data: { id: string } }).data.id;
    articleIds.add(unrelatedId);

    // EDITOR is forbidden from permanent delete -- ADMIN only.
    await request(app)
      .delete(`/api/v1/admin/articles/${targetId}`)
      .set('authorization', `Bearer ${editorToken}`)
      .expect(403);

    // Unknown id 404s cleanly.
    await request(app)
      .delete('/api/v1/admin/articles/00000000-0000-4000-8000-000000000999')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(404);

    await request(app)
      .delete(`/api/v1/admin/articles/${targetId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('x-request-id', `${auditPrefix}-delete`)
      .expect(204);

    // Idempotent-safe from the UI's perspective: deleting again 404s rather
    // than erroring.
    await request(app)
      .delete(`/api/v1/admin/articles/${targetId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(404);

    expect(await client.article.findUnique({ where: { id: targetId } })).toBeNull();
    expect(await client.articleRevision.count({ where: { articleId: targetId } })).toBe(0);
    await request(app).get(`/api/v1/articles/${targetSlug}`).expect(404);

    const releasedCandidate = await client.newsCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    expect(releasedCandidate.status).toBe('NEW');
    expect(releasedCandidate.convertedArticleId).toBeNull();

    const audit = await client.adminAuditEvent.findFirst({
      where: { entityType: 'ARTICLE', entityId: targetId, action: 'ARTICLE_DELETED' },
    });
    expect(audit).toMatchObject({ actorUserId: admin.id, actorEmailSnapshot: admin.email });
    expect(JSON.stringify(audit?.beforeSnapshot)).toContain('bodySha256');

    const stillThere = await client.article.findUniqueOrThrow({ where: { id: unrelatedId } });
    expect(stillThere.status).toBe('DRAFT');
    await request(app)
      .get(`/api/v1/admin/articles/${unrelatedId}`)
      .set('authorization', `Bearer ${editorToken}`)
      .expect(200);
  }, 30_000);
});

function createBody(slug: string, teamId: string) {
  return {
    type: 'ORIGINAL',
    title: 'Fictional CMS article',
    slug,
    summary: 'A fictional summary for CMS integration coverage.',
    body: '# Fictional CMS article\n\nThis is original development-only content.',
    sourceName: null,
    sourceUrl: null,
    sourcePublishedAt: null,
    heroImageUrl: null,
    heroImageAlt: null,
    heroImageAttribution: null,
    heroImageAttributionUrl: null,
    seoTitle: null,
    seoDescription: null,
    isFeatured: true,
    featuredPriority: 1,
    featuredStartsAt: null,
    featuredEndsAt: null,
    teamIds: [teamId],
  };
}

async function createUser(client: PrismaClient, role: UserRole, userIds: Set<string>) {
  const email = `article-cms-${role.toLowerCase()}-${randomUUID()}@example.com`;
  const user = await client.user.create({
    data: { email, normalizedEmail: email, passwordHash: 'article-cms-test-hash', role },
  });
  userIds.add(user.id);
  return user;
}

function requirePrisma(value: PrismaClient | undefined): PrismaClient {
  if (value === undefined) throw new Error('Database integration test client was not initialized.');
  return value;
}

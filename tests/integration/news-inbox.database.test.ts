import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { createPrismaClient } from '../../src/common/database/prisma.js';
import { JwtAccessTokenService } from '../../src/common/security/access-token.js';
import { loadConfig } from '../../src/config/env.js';
import type { PrismaClient, UserRole } from '../../src/generated/prisma/client.js';
import { PrismaAdminRepository } from '../../src/modules/admin/admin.repository.js';
import { PrismaArticleRepository } from '../../src/modules/articles/article.repository.js';
import { ArticleService } from '../../src/modules/articles/article.service.js';
import { SafeFeedClient, type FeedFetch } from '../../src/modules/news-inbox/feed-client.js';
import { normalizeNewsUrl } from '../../src/modules/news-inbox/news-url.js';
import { PrismaNewsInboxRepository } from '../../src/modules/news-inbox/news.repository.js';
import {
  DEFAULT_NEWS_INGESTION_POLICY,
  NewsInboxService,
  type NewsIngestionPolicyConfig,
} from '../../src/modules/news-inbox/news.service.js';
import { PrismaGameRepository } from '../../src/modules/games/game.repository.js';
import { GameService } from '../../src/modules/games/game.service.js';
import { PrismaTeamRepository } from '../../src/modules/teams/team.repository.js';
import { TeamService } from '../../src/modules/teams/team.service.js';
import { createTestAuthService, createTestUserService } from '../helpers/test-config.js';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

describe.skipIf(!databaseTestsEnabled)('news inbox database and HTTP integration', () => {
  let prisma: PrismaClient | undefined;
  const userIds = new Set<string>();
  const sourceIds = new Set<string>();
  const candidateIds = new Set<string>();
  const articleIds = new Set<string>();
  const auditPrefix = `news-inbox-${randomUUID()}`;

  beforeAll(() => {
    prisma = createPrismaClient(loadConfig().databaseUrl);
  });

  afterAll(async () => {
    const client = requirePrisma(prisma);
    if (candidateIds.size > 0) {
      await client.newsCandidate.deleteMany({ where: { id: { in: [...candidateIds] } } });
    }
    if (articleIds.size > 0) {
      await client.article.deleteMany({ where: { id: { in: [...articleIds] } } });
    }
    if (sourceIds.size > 0) {
      await client.newsIngestionRun.deleteMany({ where: { sourceId: { in: [...sourceIds] } } });
      await client.newsSource.deleteMany({ where: { id: { in: [...sourceIds] } } });
    }
    await client.adminAuditEvent.deleteMany({
      where: {
        OR: [
          { requestId: { startsWith: auditPrefix } },
          { actorUserId: { in: [...userIds] } },
          { entityId: { in: [...sourceIds, ...candidateIds, ...articleIds] } },
        ],
      },
    });
    if (userIds.size > 0) await client.user.deleteMany({ where: { id: { in: [...userIds] } } });
    await client.$disconnect();
  });

  it('enforces permissions, ingests idempotently, preserves review state, and converts transactionally', async () => {
    const client = requirePrisma(prisma);
    const config = loadConfig();
    const accessTokens = new JwtAccessTokenService({
      secret: config.auth.accessTokenSecret,
      expiresInSeconds: config.auth.accessTokenTtlSeconds,
    });
    let fetchNumber = 0;
    const fetch = vi.fn<FeedFetch>().mockImplementation(() => {
      fetchNumber += 1;
      if (fetchNumber === 3) return Promise.resolve(new Response(null, { status: 304 }));
      return Promise.resolve(
        new Response(fetchNumber === 2 ? updatedRss() : initialRss(), {
          status: 200,
          headers: {
            'content-type': 'application/rss+xml; charset=utf-8',
            etag: '"fixture-v1"',
            'last-modified': 'Sat, 01 Aug 2026 00:00:00 GMT',
          },
        }),
      );
    });
    const repository = new PrismaNewsInboxRepository(client);
    const newsService = new NewsInboxService(
      repository,
      new SafeFeedClient(fetch, () => Promise.resolve(['93.184.216.34'])),
      DEFAULT_NEWS_INGESTION_POLICY,
      () => new Date('2026-08-02T12:00:00.000Z'),
    );
    const articleService = new ArticleService(new PrismaArticleRepository(client));
    const app = createApp({
      config: { ...config, auth: { ...config.auth, rateLimit: { windowMs: 60_000, max: 100 } } },
      logger: pino({ level: 'silent' }),
      teamReader: new TeamService(new PrismaTeamRepository(client)),
      gameReader: new GameService(new PrismaGameRepository(client, 'none'), () => new Date(), {
        currentNflSeason: 2099,
        allowHistoricalDefaultGameResults: false,
      }),
      authService: createTestAuthService(),
      userService: createTestUserService(),
      accessTokens,
      adminIdentities: new PrismaAdminRepository(client),
      articleReader: articleService,
      editorialArticleService: articleService,
      newsInboxService: newsService,
    });
    const editor = await createUser(client, 'EDITOR', userIds);
    const admin = await createUser(client, 'ADMIN', userIds);
    const normal = await createUser(client, 'USER', userIds);
    const editorToken = await accessTokens.sign({ userId: editor.id, sessionId: randomUUID() });
    const adminToken = await accessTokens.sign({ userId: admin.id, sessionId: randomUUID() });
    const normalToken = await accessTokens.sign({ userId: normal.id, sessionId: randomUUID() });
    const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
    const buffalo = await client.team.findUniqueOrThrow({
      where: { league_abbreviation: { league: 'NFL', abbreviation: 'BUF' } },
    });

    await request(app).get('/api/v1/admin/news-sources').expect(401);
    await request(app).get('/api/v1/admin/news-sources').set(bearer(normalToken)).expect(403);
    await request(app)
      .post('/api/v1/admin/news-sources')
      .set(bearer(editorToken))
      .send(sourceBody(`editor-forbidden-${randomUUID()}`))
      .expect(403);
    await request(app)
      .post('/api/v1/admin/news-sources')
      .set(bearer(adminToken))
      .send({ ...sourceBody(`private-${randomUUID()}`), feedUrl: 'http://127.0.0.1/feed' })
      .expect(400);

    const createdSource = await request(app)
      .post('/api/v1/admin/news-sources')
      .set(bearer(adminToken))
      .set('x-request-id', `${auditPrefix}-source-create`)
      .send(sourceBody(`fictional-${randomUUID()}`))
      .expect(201);
    const sourceId = (createdSource.body as { data: { id: string } }).data.id;
    sourceIds.add(sourceId);

    const firstRun = await request(app)
      .post(`/api/v1/admin/news-sources/${sourceId}/ingest`)
      .set(bearer(editorToken))
      .set('x-request-id', `${auditPrefix}-ingest-1`)
      .send({})
      .expect(200);
    expect(
      (firstRun.body as { data: { run: { fetchedCount: number; createdCount: number } } }).data.run,
    ).toMatchObject({ fetchedCount: 2, createdCount: 2 });
    const firstCandidates = await client.newsCandidate.findMany({
      where: { sourceId },
      include: { suggestedTeams: true },
      orderBy: { sourceExternalId: 'asc' },
    });
    expect(firstCandidates).toHaveLength(2);
    firstCandidates.forEach(({ id }) => candidateIds.add(id));
    const billsCandidate = firstCandidates.find(
      ({ sourceExternalId }) => sourceExternalId === 'fixture-guid-1',
    );
    const cityOnlyCandidate = firstCandidates.find(
      ({ sourceExternalId }) => sourceExternalId === 'fixture-guid-2',
    );
    expect(billsCandidate?.suggestedTeams).toEqual([
      expect.objectContaining({ teamId: buffalo.id, rule: 'EXACT_FULL_NAME' }),
    ]);
    expect(cityOnlyCandidate?.suggestedTeams).toHaveLength(0);
    // M30A: contentType is copied from the source configuration (never per-item
    // classified), and a feed-provided media:content thumbnail is persisted verbatim.
    expect(billsCandidate).toMatchObject({
      contentType: 'VIDEO',
      mediaThumbnailUrl: 'https://static.example.com/thumb-one.jpg',
    });
    expect(cityOnlyCandidate).toMatchObject({ contentType: 'VIDEO', mediaThumbnailUrl: null });

    await request(app)
      .post(`/api/v1/admin/news-candidates/${requireId(billsCandidate?.id)}/dismiss`)
      .set(bearer(editorToken))
      .set('x-request-id', `${auditPrefix}-dismiss`)
      .send({ reason: 'Fictional duplicate retained for audit.' })
      .expect(200);

    const secondRun = await request(app)
      .post(`/api/v1/admin/news-sources/${sourceId}/ingest`)
      .set(bearer(editorToken))
      .set('x-request-id', `${auditPrefix}-ingest-2`)
      .send({})
      .expect(200);
    expect(
      (
        secondRun.body as {
          data: { run: { createdCount: number; updatedCount: number; skippedCount: number } };
        }
      ).data.run,
    ).toMatchObject({ createdCount: 0, updatedCount: 1, skippedCount: 1 });
    const dismissedAfterRefresh = await client.newsCandidate.findUniqueOrThrow({
      where: { id: requireId(billsCandidate?.id) },
    });
    expect(dismissedAfterRefresh).toMatchObject({
      status: 'DISMISSED',
      headline: 'Buffalo Bills update the fictional training session',
    });

    const thirdRun = await request(app)
      .post(`/api/v1/admin/news-sources/${sourceId}/ingest`)
      .set(bearer(editorToken))
      .set('x-request-id', `${auditPrefix}-ingest-304`)
      .send({})
      .expect(200);
    expect(
      (thirdRun.body as { data: { notModified: boolean; run: { status: string } } }).data,
    ).toMatchObject({ notModified: true, run: { status: 'SUCCEEDED' } });

    const fetchesBeforeManual = fetch.mock.calls.length;
    const manual = await request(app)
      .post('/api/v1/admin/news-candidates/manual')
      .set(bearer(editorToken))
      .set('x-request-id', `${auditPrefix}-manual`)
      .send(manualBody(buffalo.id))
      .expect(201);
    const manualId = (manual.body as { data: { id: string } }).data.id;
    candidateIds.add(manualId);
    expect(fetch).toHaveBeenCalledTimes(fetchesBeforeManual);
    await request(app)
      .post('/api/v1/admin/news-candidates/manual')
      .set(bearer(editorToken))
      .send(manualBody(buffalo.id))
      .expect(409);
    await request(app)
      .post(`/api/v1/admin/news-candidates/${manualId}/review`)
      .set(bearer(editorToken))
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/news-candidates/${manualId}/save`)
      .set(bearer(editorToken))
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/news-candidates/${manualId}/convert`)
      .set(bearer(editorToken))
      .send({ ...conversionBody(buffalo.id), originalSummary: 'Manual source metadata only.' })
      .expect(400);

    const conversion = await request(app)
      .post(`/api/v1/admin/news-candidates/${manualId}/convert`)
      .set(bearer(editorToken))
      .set('x-request-id', `${auditPrefix}-convert`)
      .send(conversionBody(buffalo.id))
      .expect(201);
    const converted = (
      conversion.body as {
        data: {
          candidate: { status: string; convertedArticleId: string };
          article: { id: string; status: string; type: string; body: string | null };
        };
      }
    ).data;
    articleIds.add(converted.article.id);
    expect(converted.candidate).toMatchObject({
      status: 'CONVERTED',
      convertedArticleId: converted.article.id,
    });
    expect(converted.article).toMatchObject({
      status: 'DRAFT',
      type: 'CURATED',
      body: 'Original 2nd & 15 commentary.',
    });
    await request(app)
      .post(`/api/v1/admin/news-candidates/${manualId}/convert`)
      .set(bearer(editorToken))
      .send(conversionBody(buffalo.id))
      .expect(409);
    await request(app).get(`/api/v1/articles/${conversionSlug()}`).expect(404);

    const article = await client.article.findUniqueOrThrow({
      where: { id: converted.article.id },
      include: { revisions: true, teams: true },
    });
    expect(article).toMatchObject({
      type: 'CURATED',
      status: 'DRAFT',
      sourceName: 'Fictional Publisher',
      sourceUrl: 'https://manual.example.com/story?id=42',
      // A manual candidate never sets contentType, so the converted article keeps
      // the Article model's ARTICLE default rather than inheriting anything.
      contentType: 'ARTICLE',
      mediaThumbnailUrl: null,
      // Manual candidates have no source record at all, so provenance is false.
      sourceIsOfficialTeam: false,
    });
    expect(article.revisions).toHaveLength(1);
    expect(article.teams.map(({ teamId }) => teamId)).toEqual([buffalo.id]);
    expect(JSON.stringify(article)).not.toContain('full source body');
    expect(article.heroImageUrl).toBeNull();

    // M30C: converting a VIDEO/HIGHLIGHT candidate must carry its contentType,
    // mediaThumbnailUrl, and source official-team provenance onto the resulting
    // article, not silently drop them.
    const videoConversion = await request(app)
      .post(`/api/v1/admin/news-candidates/${requireId(cityOnlyCandidate?.id)}/convert`)
      .set(bearer(editorToken))
      .set('x-request-id', `${auditPrefix}-convert-video`)
      .send({
        ...conversionBody(buffalo.id),
        slug: `${conversionSlug()}-video`,
        confirmedTeamIds: [],
      })
      .expect(201);
    const videoConverted = (videoConversion.body as { data: { article: { id: string } } }).data;
    articleIds.add(videoConverted.article.id);
    const videoArticle = await client.article.findUniqueOrThrow({
      where: { id: videoConverted.article.id },
    });
    expect(videoArticle).toMatchObject({
      contentType: cityOnlyCandidate?.contentType,
      mediaThumbnailUrl: cityOnlyCandidate?.mediaThumbnailUrl ?? null,
      sourceIsOfficialTeam: true,
    });

    await request(app)
      .post(`/api/v1/admin/news-sources/${sourceId}/test`)
      .set(bearer(editorToken))
      .set('x-request-id', `${auditPrefix}-test`)
      .send({})
      .expect(200);
    expect(await client.newsCandidate.count({ where: { sourceId } })).toBe(2);
    expect(await client.newsIngestionRun.count({ where: { sourceId } })).toBe(4);

    const leaseId = randomUUID();
    await client.newsSource.update({
      where: { id: sourceId },
      data: {
        ingestionLeaseId: leaseId,
        ingestionLeaseStartedAt: new Date('2026-08-02T11:59:00.000Z'),
      },
    });
    await request(app)
      .post(`/api/v1/admin/news-sources/${sourceId}/ingest`)
      .set(bearer(editorToken))
      .send({})
      .expect(409);
    await client.newsSource.update({
      where: { id: sourceId },
      data: { ingestionLeaseId: null, ingestionLeaseStartedAt: null },
    });

    await request(app)
      .post(`/api/v1/admin/news-sources/${sourceId}/pause`)
      .set(bearer(editorToken))
      .send({})
      .expect(403);
    await request(app)
      .post(`/api/v1/admin/news-sources/${sourceId}/pause`)
      .set(bearer(adminToken))
      .set('x-request-id', `${auditPrefix}-pause`)
      .send({})
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/news-sources/${sourceId}/resume`)
      .set(bearer(adminToken))
      .set('x-request-id', `${auditPrefix}-resume`)
      .send({})
      .expect(200);

    const audits = await client.adminAuditEvent.findMany({
      where: { requestId: { startsWith: auditPrefix } },
    });
    expect(audits.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        'NEWS_SOURCE_CREATED',
        'NEWS_INGESTION_INITIATED',
        'NEWS_CANDIDATE_DISMISSED',
        'NEWS_CANDIDATE_MANUALLY_SUBMITTED',
        'NEWS_CANDIDATE_CONVERTED',
        'NEWS_SOURCE_TESTED',
        'NEWS_SOURCE_PAUSED',
        'NEWS_SOURCE_RESUMED',
        'ARTICLE_CREATED',
      ]),
    );
    const auditJson = JSON.stringify(audits);
    expect(auditJson).not.toContain('full source body');
    expect(auditJson).not.toContain('Manual source metadata only.');
    expect(auditJson).not.toContain('Original 2nd & 15 commentary.');
  }, 30_000);

  it('deduplicates a candidate across two different sources via the canonical URL fallback (M30A)', async () => {
    const client = requirePrisma(prisma);
    const admin = await createUser(client, 'ADMIN', userIds);
    const repository = new PrismaNewsInboxRepository(client);
    const sharedUrl = 'https://video.example.com/video/fictional-shared-highlight';
    const normalized = normalizeNewsUrl(sharedUrl);

    const createSourceRow = async (slug: string) => {
      const created = await client.newsSource.create({
        data: {
          name: `Fictional Dedupe Source ${slug}`,
          slug,
          kind: 'RSS',
          contentType: 'HIGHLIGHT',
          status: 'ACTIVE',
          feedUrl: `https://${slug}.example.com/feed.xml`,
          siteUrl: `https://${slug}.example.com/`,
          publisherName: 'Fictional Dedupe Publisher',
          createdById: admin.id,
          updatedById: admin.id,
          createdBySnapshot: admin.email,
          updatedBySnapshot: admin.email,
        },
      });
      sourceIds.add(created.id);
      const record = await repository.findSource(created.id);
      if (record === null) throw new Error('Expected the created source to be readable.');
      return record;
    };

    const sourceA = await createSourceRow(`dedupe-a-${randomUUID()}`);
    const sourceB = await createSourceRow(`dedupe-b-${randomUUID()}`);
    const now = new Date('2026-08-24T12:00:00.000Z');

    const first = await repository.upsertFeedCandidate(
      sourceA,
      {
        externalId: 'source-a-guid',
        canonicalUrl: normalized.url,
        canonicalUrlHash: normalized.hash,
        headline: 'A fictional shared highlight, as seen by source A',
        description: null,
        author: null,
        publishedAt: null,
        thumbnailUrl: 'https://static.example.com/dedupe-thumb.jpg',
      },
      [],
      now,
    );
    expect(first.action).toBe('created');
    candidateIds.add(first.candidate.id);

    const second = await repository.upsertFeedCandidate(
      sourceB,
      {
        externalId: 'source-b-guid',
        canonicalUrl: normalized.url,
        canonicalUrlHash: normalized.hash,
        headline: 'A fictional shared highlight, as seen by source B',
        description: null,
        author: null,
        publishedAt: null,
        thumbnailUrl: 'https://static.example.com/dedupe-thumb.jpg',
      },
      [],
      now,
    );
    // Same canonical URL from a *different* source must update the existing row, never
    // create a second one -- this is what stops one highlight from appearing 2-4x simply
    // because it was published into multiple category feeds.
    expect(second.action).toBe('updated');
    expect(second.candidate.id).toBe(first.candidate.id);
    expect(await client.newsCandidate.count({ where: { canonicalUrlHash: normalized.hash } })).toBe(
      1,
    );
  }, 30_000);

  it('bounds initial ingest to recent, capped, dated items, then behaves steady-state on later runs (M30D)', async () => {
    const client = requirePrisma(prisma);
    const admin = await createUser(client, 'ADMIN', userIds);
    const now = new Date('2026-08-25T12:00:00.000Z');
    const policy: NewsIngestionPolicyConfig = {
      initialLookbackHours: 72,
      initialMaxItemsPerSource: 2,
      lateItemToleranceHours: 48,
    };
    const slug = `m30d-initial-ingest-${randomUUID()}`;
    const source = await client.newsSource.create({
      data: {
        name: 'M30D Fictional Highlight Source',
        slug,
        kind: 'RSS',
        contentType: 'HIGHLIGHT',
        status: 'ACTIVE',
        feedUrl: `https://${slug}.example.com/feed.xml`,
        siteUrl: `https://${slug}.example.com/`,
        publisherName: 'M30D Fictional Publisher',
        createdById: admin.id,
        updatedById: admin.id,
        createdBySnapshot: admin.email,
        updatedBySnapshot: admin.email,
      },
    });
    sourceIds.add(source.id);

    const firstFeedItems = [
      m30dItem('recent-1', 'A fictional recent highlight one', '2026-08-25T10:00:00.000Z'),
      m30dItem('recent-2', 'A fictional recent highlight two', '2026-08-25T08:00:00.000Z'),
      m30dItem('recent-3', 'A fictional recent highlight three', '2026-08-25T06:00:00.000Z'),
      m30dItem('very-stale', 'A fictional very old highlight', '2026-06-01T12:00:00.000Z'),
      m30dItem('dateless', 'A fictional highlight with no publish date', null),
    ];
    const fetch = vi.fn<FeedFetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(m30dRss(firstFeedItems), {
          status: 200,
          headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
        }),
      ),
    );
    const repository = new PrismaNewsInboxRepository(client);
    const actor = { userId: admin.id, email: admin.email, role: admin.role };

    // First run: this source has never completed an ingest, so the bounded initial
    // policy applies -- only the 2 newest items within the 72h lookback are created;
    // the 3rd recent item is capped/truncated, the very old item is outside the
    // lookback, and the dateless item is skipped rather than imported blindly.
    const firstService = new NewsInboxService(
      repository,
      new SafeFeedClient(fetch, () => Promise.resolve(['93.184.216.34'])),
      policy,
      () => now,
    );
    const firstResult = await firstService.ingestSource(source.id, actor, `${auditPrefix}-m30d-1`);
    expect(firstResult.initialIngest).toBe(true);
    expect(firstResult.run).toMatchObject({ fetchedCount: 5, createdCount: 2, skippedCount: 3 });
    expect(firstResult.diagnostics).toEqual({
      outsideLookback: 1,
      missingPublishedAt: 1,
      truncated: 1,
      lateRejected: 0,
    });
    const afterFirst = await client.newsCandidate.findMany({
      where: { sourceId: source.id },
      select: { sourceExternalId: true },
    });
    expect(new Set(afterFirst.map((c) => c.sourceExternalId))).toEqual(
      new Set(['m30d-recent-1', 'm30d-recent-2']),
    );
    const sourceAfterFirst = await repository.findSource(source.id);
    expect(sourceAfterFirst?.lastSuccessfulAt).not.toBeNull();
    // Record actual candidate IDs (not external IDs) for cleanup.
    const created = await client.newsCandidate.findMany({ where: { sourceId: source.id } });
    created.forEach(({ id }) => candidateIds.add(id));

    // Second run: simulate a process restart with a brand-new service/repository
    // instance sharing only the database. The source is no longer "initial"
    // (lastSuccessfulAt is set), so: the 2 already-ingested items are deduped
    // (zero new writes), the previously-truncated-but-recent item is now accepted
    // as ordinary steady-state content, the dateless item is now accepted (existing
    // safe behavior -- a null publish time, never a guessed one), and the very old,
    // never-before-seen item is rejected as late/out-of-order rather than flooding
    // the inbox just because the feed still lists it.
    const restartedRepository = new PrismaNewsInboxRepository(client);
    const secondService = new NewsInboxService(
      restartedRepository,
      new SafeFeedClient(fetch, () => Promise.resolve(['93.184.216.34'])),
      policy,
      () => now,
    );
    const secondResult = await secondService.ingestSource(source.id, actor, `${auditPrefix}-m30d-2`);
    expect(secondResult.initialIngest).toBe(false);
    expect(secondResult.run).toMatchObject({ fetchedCount: 5, createdCount: 2, skippedCount: 3 });
    expect(secondResult.diagnostics).toEqual({
      outsideLookback: 0,
      missingPublishedAt: 0,
      truncated: 0,
      lateRejected: 1,
    });
    const afterSecond = await client.newsCandidate.findMany({
      where: { sourceId: source.id },
      select: { id: true, sourceExternalId: true, contentType: true },
    });
    afterSecond.forEach(({ id }) => candidateIds.add(id));
    expect(new Set(afterSecond.map((c) => c.sourceExternalId))).toEqual(
      new Set(['m30d-recent-1', 'm30d-recent-2', 'm30d-recent-3', 'm30d-dateless']),
    );
    expect(afterSecond.every((c) => c.contentType === 'HIGHLIGHT')).toBe(true);
    // The genuinely old, never-seen item never entered the inbox.
    expect(afterSecond.some((c) => c.sourceExternalId === 'm30d-very-stale')).toBe(false);

    // A third run against an unchanged feed writes nothing new -- pure idempotency,
    // independent of the initial-ingest policy entirely.
    const thirdResult = await secondService.ingestSource(source.id, actor, `${auditPrefix}-m30d-3`);
    expect(thirdResult.run).toMatchObject({ createdCount: 0, updatedCount: 0 });
  }, 30_000);

  it('still treats a source as initial after a prior testSource dry run -- the exact M30D incident, regression-guarded (M30E)', async () => {
    const client = requirePrisma(prisma);
    const admin = await createUser(client, 'ADMIN', userIds);
    const now = new Date('2026-08-26T12:00:00.000Z');
    const slug = `m30e-regression-${randomUUID()}`;
    const source = await client.newsSource.create({
      data: {
        name: 'M30E Regression Source',
        slug,
        kind: 'RSS',
        contentType: 'ARTICLE',
        status: 'ACTIVE',
        feedUrl: `https://${slug}.example.com/feed.xml`,
        siteUrl: `https://${slug}.example.com/`,
        publisherName: 'M30E Fictional Publisher',
        createdById: admin.id,
        updatedById: admin.id,
        createdBySnapshot: admin.email,
        updatedBySnapshot: admin.email,
      },
    });
    sourceIds.add(source.id);
    const feedItems = [
      m30dItem('regression-recent', 'A fictional recent article', '2026-08-26T10:00:00.000Z'),
      m30dItem('regression-stale', 'A fictional months-old article', '2026-05-01T12:00:00.000Z'),
    ];
    const fetch = vi.fn<FeedFetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(m30dRss(feedItems), {
          status: 200,
          headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
        }),
      ),
    );
    const repository = new PrismaNewsInboxRepository(client);
    const service = new NewsInboxService(
      repository,
      new SafeFeedClient(fetch, () => Promise.resolve(['93.184.216.34'])),
      DEFAULT_NEWS_INGESTION_POLICY,
      () => now,
    );
    const actor = { userId: admin.id, email: admin.email, role: admin.role };

    // Exactly the M30A/M30B evaluation pattern: a bounded dry-run test, no writes,
    // performed long before any real activation.
    const dryRun = await service.testSource(source.id, actor, `${auditPrefix}-m30e-dryrun`);
    expect(dryRun.testedOnly).toBe(true);
    expect(await client.newsCandidate.count({ where: { sourceId: source.id } })).toBe(0);
    const sourceAfterDryRun = await repository.findSource(source.id);
    // This is the exact field the M30D incident's buggy first implementation used,
    // and the exact reason it was wrong: a no-write dry run still completes
    // successfully and still sets it.
    expect(sourceAfterDryRun?.lastSuccessfulAt).not.toBeNull();

    // The real, first ingest must still see this as INITIAL_BOUNDED -- i.e. keyed
    // off actual candidate rows (none exist), not off `lastSuccessfulAt` (which is
    // already non-null purely from the dry run above).
    const realIngest = await service.ingestSource(source.id, actor, `${auditPrefix}-m30e-real`);
    expect(realIngest.initialIngest).toBe(true);
    expect(realIngest.run).toMatchObject({ fetchedCount: 2, createdCount: 1, skippedCount: 1 });
    expect(realIngest.diagnostics).toEqual({
      outsideLookback: 1,
      missingPublishedAt: 0,
      truncated: 0,
      lateRejected: 0,
    });
    const created = await client.newsCandidate.findMany({ where: { sourceId: source.id } });
    created.forEach(({ id }) => candidateIds.add(id));
    expect(created.map((c) => c.sourceExternalId)).toEqual(['m30d-regression-recent']);
  }, 30_000);
});

function m30dItem(id: string, title: string, publishedAtIso: string | null): {
  readonly id: string;
  readonly title: string;
  readonly publishedAtIso: string | null;
} {
  return { id: `m30d-${id}`, title, publishedAtIso };
}

function m30dRss(
  items: readonly { readonly id: string; readonly title: string; readonly publishedAtIso: string | null }[],
): string {
  const entries = items
    .map(
      (item) =>
        `<item><guid>${item.id}</guid><title>${item.title}</title><link>https://m30d.example.com/highlight/${item.id}</link><description>Fictional highlight metadata.</description>${
          item.publishedAtIso === null
            ? ''
            : `<pubDate>${new Date(item.publishedAtIso).toUTCString()}</pubDate>`
        }</item>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>M30D Fixture</title>${entries}</channel></rss>`;
}

function sourceBody(slug: string) {
  return {
    name: 'Fictional RSS Source',
    slug,
    kind: 'RSS',
    contentType: 'VIDEO',
    status: 'ACTIVE',
    feedUrl: 'https://news.example.com/feed.xml',
    siteUrl: 'https://news.example.com/',
    publisherName: 'Fictional Publisher',
    defaultTeamId: null,
    isOfficialLeague: false,
    isOfficialTeam: true,
    allowsDescriptionUse: false,
    notes: 'Integration-only source.',
  };
}

function initialRss(): string {
  // M30D: both items carry a `<pubDate>` within the default 72h initial-ingest
  // lookback of the fixed `now` (2026-08-02T12:00:00Z) used by this test, so the
  // source's first-ever ingest accepts both -- this test is about permissions,
  // idempotency, and conversion, not initial-ingest date filtering (which has its
  // own dedicated test below).
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Fixture</title><item><guid>fixture-guid-1</guid><title>Buffalo Bills open the fictional training session</title><link>https://news.example.com/story/one?utm_source=test</link><description>Short metadata one.</description><pubDate>Sat, 01 Aug 2026 12:00:00 GMT</pubDate><media:content url="https://static.example.com/thumb-one.jpg" /><content:encoded><![CDATA[full source body]]></content:encoded></item><item><guid>fixture-guid-2</guid><title>New York football operations update</title><link>https://news.example.com/story/two</link><description>Short metadata two.</description><pubDate>Sat, 01 Aug 2026 11:00:00 GMT</pubDate></item></channel></rss>`;
}

function updatedRss(): string {
  return initialRss().replace(
    'Buffalo Bills open the fictional training session',
    'Buffalo Bills update the fictional training session',
  );
}

function manualBody(teamId: string) {
  return {
    url: 'https://manual.example.com/story?id=42&utm_campaign=test#top',
    headline: 'Fictional editor-submitted story',
    sourceName: 'Fictional Publisher',
    sourceId: null,
    sourceDescription: 'Manual source metadata only.',
    sourceAuthor: 'Fixture Reporter',
    sourcePublishedAt: '2026-08-01T10:00:00.000Z',
    suggestedTeamIds: [teamId],
  };
}

const articleSlug = `fictional-curated-${randomUUID()}`;

function conversionSlug(): string {
  return articleSlug;
}

function conversionBody(teamId: string) {
  return {
    title: 'An original fictional curated headline',
    slug: conversionSlug(),
    originalSummary: 'An original 2nd & 15 summary written after reviewing the source metadata.',
    originalCommentary: 'Original 2nd & 15 commentary.',
    confirmedTeamIds: [teamId],
    heroImageUrl: null,
    heroImageAlt: null,
    heroImageAttribution: null,
    heroImageAttributionUrl: null,
    changeSummary: 'Converted from a fictional inbox candidate.',
  };
}

async function createUser(client: PrismaClient, role: UserRole, ids: Set<string>) {
  const email = `news-${role.toLowerCase()}-${randomUUID()}@example.com`;
  const user = await client.user.create({
    data: {
      email,
      normalizedEmail: email,
      passwordHash: 'integration-test-not-a-real-password-hash',
      role,
    },
  });
  ids.add(user.id);
  return user;
}

function requireId(value: string | undefined): string {
  if (value === undefined) throw new Error('Expected integration record was not created.');
  return value;
}

function requirePrisma(client: PrismaClient | undefined): PrismaClient {
  if (client === undefined) throw new Error('Prisma client was not initialized.');
  return client;
}

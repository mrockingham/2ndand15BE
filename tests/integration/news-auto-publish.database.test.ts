import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/common/database/prisma.js';
import type {
  NewsContentType,
  NewsSourceKind,
  NewsSourceStatus,
  PrismaClient,
  UserRole,
} from '../../src/generated/prisma/client.js';
import { SafeFeedClient } from '../../src/modules/news-inbox/feed-client.js';
import { PrismaNewsInboxRepository } from '../../src/modules/news-inbox/news.repository.js';
import {
  DEFAULT_NEWS_INGESTION_POLICY,
  NewsInboxService,
  type NewsAutoPublishPolicyConfig,
} from '../../src/modules/news-inbox/news.service.js';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

// maxPerRun is deliberately much larger than any real per-run default. Real
// sources are excluded from eligibility for the duration of this suite (see
// the module doc comment below), but they're still *structurally* eligible
// (ACTIVE/ARTICLE/non-MANUAL_ONLY) and so still occupy slots in the
// oldest-first candidate pool ahead of this suite's own, more recently
// dated fixtures -- a small maxPerRun (and the pool size derived from it)
// could be exhausted by that real backlog's SOURCE_AUTO_PUBLISH_DISABLED
// rejections before ever reaching this suite's candidates. The per-source
// cap test still uses a small, deliberate override scoped to its own
// uniquely-slugged sources.
const POLICY: NewsAutoPublishPolicyConfig = {
  enabled: true,
  maxAgeHours: 24,
  maxPerRun: 1_000,
  maxPerSourcePerRun: 10,
  minDescriptionLength: 40,
};

/**
 * This suite runs against the real, shared database (no isolated test DB),
 * and `autoPublishEligibleCandidates` deliberately scans across *every*
 * trusted source, not just ones a given test created -- so calling it for
 * real (`publish !== null`) while any real source has `autoPublishArticles:
 * true` risks writing real production articles. An earlier version of this
 * suite did exactly that (auto-published ~56 real ESPN/PFT/CBS candidates,
 * fully reverted afterward). To make that structurally impossible: every
 * real source currently flagged `autoPublishArticles: true` is turned off
 * for the duration of this suite and restored in `afterAll` (try/finally
 * equivalent via the `describe` lifecycle), so the pool this suite's real
 * runs see can only ever contain candidates from sources this suite itself
 * creates. Read-only calls (`previewAutoPublish`) were never at risk and
 * don't need this.
 */
describe.skipIf(!databaseTestsEnabled)('news auto-publish database integration (M42B)', () => {
  let prisma: PrismaClient | undefined;
  const userIds = new Set<string>();
  const sourceIds = new Set<string>();
  const candidateIds = new Set<string>();
  const articleIds = new Set<string>();
  const auditPrefix = `news-auto-publish-${randomUUID()}`;
  let realTrustedSourceIds: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(resolveTestDatabaseUrl());
    const realTrusted = await prisma.newsSource.findMany({
      where: { autoPublishArticles: true },
      select: { id: true },
    });
    realTrustedSourceIds = realTrusted.map((s) => s.id);
    if (realTrustedSourceIds.length > 0) {
      await prisma.newsSource.updateMany({
        where: { id: { in: realTrustedSourceIds } },
        data: { autoPublishArticles: false },
      });
    }
  });

  afterAll(async () => {
    const client = requirePrisma(prisma);
    if (candidateIds.size > 0) {
      // The DB's `news_candidates_conversion_check` constraint requires
      // status and convertedArticleId to agree (CONVERTED iff non-null) --
      // reset both together, not just the FK, before deleting the articles
      // they point at.
      await client.newsCandidate.updateMany({
        where: { id: { in: [...candidateIds] } },
        data: { status: 'NEW', convertedArticleId: null },
      });
    }
    if (articleIds.size > 0) {
      await client.articleRevision.deleteMany({ where: { articleId: { in: [...articleIds] } } });
      await client.article.deleteMany({ where: { id: { in: [...articleIds] } } });
    }
    if (candidateIds.size > 0) {
      await client.newsCandidate.deleteMany({ where: { id: { in: [...candidateIds] } } });
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
    // Restore real trust flags regardless of any test failure above.
    if (realTrustedSourceIds.length > 0) {
      await client.newsSource.updateMany({
        where: { id: { in: realTrustedSourceIds } },
        data: { autoPublishArticles: true },
      });
    }
    await client.$disconnect();
  });

  it('publishes an eligible candidate atomically: PUBLISHED article, CONVERTED candidate, system-actor audit, idempotent retry', async () => {
    const client = requirePrisma(prisma);
    const editor = await createUser(client, 'EDITOR', userIds);
    const systemActor = await createUser(client, 'ADMIN', userIds);
    const now = new Date('2026-08-29T12:00:00.000Z');
    const team = await client.team.findFirstOrThrow({ where: { league: 'NFL', isActive: true } });

    const source = await createTrustedSource(client, editor, sourceIds);
    const candidate = await client.newsCandidate.create({
      data: {
        sourceId: source.id,
        sourceNameSnapshot: source.publisherName,
        sourceExternalId: `auto-publish-${randomUUID()}`,
        canonicalUrl: `https://news.example.com/story/${randomUUID()}`,
        canonicalUrlHash: randomUUID(),
        headline: 'A fictional headline about a real NFL story',
        sourceDescription:
          'A fictional forty-plus character description used to satisfy the minimum quality threshold in this test.',
        contentType: 'ARTICLE',
        mediaThumbnailUrl: 'https://static.example.com/thumb.jpg',
        sourcePublishedAt: new Date('2026-08-29T06:00:00.000Z'),
        discoveredAt: new Date('2026-08-29T06:05:00.000Z'),
        status: 'NEW',
        suggestedTeams: { create: [{ teamId: team.id, rule: 'EXACT_FULL_NAME' }] },
      },
    });
    candidateIds.add(candidate.id);

    const repository = new PrismaNewsInboxRepository(client);
    const service = new NewsInboxService(
      repository,
      new SafeFeedClient(),
      DEFAULT_NEWS_INGESTION_POLICY,
      () => now,
      POLICY,
    );
    const systemPrincipal = {
      userId: systemActor.id,
      email: systemActor.email,
      role: systemActor.role,
    };

    const preview = await service.previewAutoPublish();
    const previewItem = preview.items.find((item) => item.candidateId === candidate.id);
    expect(previewItem).toMatchObject({ outcome: 'ELIGIBLE', reason: null });

    const result = await service.autoPublishEligibleCandidates(
      systemPrincipal,
      `${auditPrefix}-run-1`,
    );
    const item = result.items.find((entry) => entry.candidateId === candidate.id);
    expect(item?.outcome).toBe('PUBLISHED');
    if (item?.articleId === undefined || item.articleId === null) {
      throw new Error('Expected the candidate to have been published with an article ID.');
    }
    const articleId = item.articleId;
    articleIds.add(articleId);

    const article = await client.article.findUniqueOrThrow({
      where: { id: articleId },
      include: { teams: true },
    });
    expect(article.status).toBe('PUBLISHED');
    expect(article.publishedAt).not.toBeNull();
    expect(article.type).toBe('CURATED');
    expect(article.body).toBeNull();
    expect(article.summary).toBe(candidate.sourceDescription);
    expect(article.sourceName).toBe(source.publisherName);
    expect(article.sourceUrl).toBe(candidate.canonicalUrl);
    expect(article.mediaThumbnailUrl).toBe(candidate.mediaThumbnailUrl);
    expect(article.createdBySnapshot).toBe(systemActor.email);
    expect(article.createdBySnapshot).not.toBe(editor.email);
    expect(article.teams.map((t) => t.teamId)).toEqual([team.id]);

    const updatedCandidate = await client.newsCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    expect(updatedCandidate.status).toBe('CONVERTED');
    expect(updatedCandidate.convertedArticleId).toBe(articleId);

    const audit = await client.adminAuditEvent.findFirst({
      where: { entityId: candidate.id, action: 'NEWS_CANDIDATE_AUTO_PUBLISHED' },
    });
    expect(audit).toMatchObject({
      actorUserId: systemActor.id,
      actorEmailSnapshot: systemActor.email,
      reason: 'AUTO_PUBLISH',
    });
    expect(audit?.actorEmailSnapshot).not.toBe(editor.email);

    // Idempotency: a second run must not create a second article.
    const secondRun = await service.autoPublishEligibleCandidates(
      systemPrincipal,
      `${auditPrefix}-run-2`,
    );
    const secondItem = secondRun.items.find((entry) => entry.candidateId === candidate.id);
    expect(secondItem).toBeUndefined();
    const articleCount = await client.article.count({ where: { id: articleId } });
    expect(articleCount).toBe(1);
    const candidateArticleLinks = await client.newsCandidate.count({
      where: { convertedArticleId: articleId },
    });
    expect(candidateArticleLinks).toBe(1);
  }, 30_000);

  it('the global kill switch blocks real publication before it ever queries the candidate pool', async () => {
    const client = requirePrisma(prisma);
    const editor = await createUser(client, 'EDITOR', userIds);
    const systemActor = await createUser(client, 'ADMIN', userIds);
    const now = new Date('2026-08-29T12:00:00.000Z');

    const source = await createTrustedSource(client, editor, sourceIds);
    const candidate = await client.newsCandidate.create({
      data: {
        sourceId: source.id,
        sourceNameSnapshot: source.publisherName,
        sourceExternalId: `kill-switch-${randomUUID()}`,
        canonicalUrl: `https://news.example.com/story/${randomUUID()}`,
        canonicalUrlHash: randomUUID(),
        headline: 'A fictional headline that would otherwise be eligible',
        sourceDescription:
          'A fictional forty-plus character description used to satisfy the minimum quality threshold in this test.',
        contentType: 'ARTICLE',
        sourcePublishedAt: new Date('2026-08-29T06:00:00.000Z'),
        discoveredAt: new Date('2026-08-29T06:05:00.000Z'),
        status: 'NEW',
      },
    });
    candidateIds.add(candidate.id);

    const repository = new PrismaNewsInboxRepository(client);
    const disabledService = new NewsInboxService(
      repository,
      new SafeFeedClient(),
      DEFAULT_NEWS_INGESTION_POLICY,
      () => now,
      { ...POLICY, enabled: false },
    );
    const systemPrincipal = {
      userId: systemActor.id,
      email: systemActor.email,
      role: systemActor.role,
    };

    const result = await disabledService.autoPublishEligibleCandidates(
      systemPrincipal,
      `${auditPrefix}-killswitch`,
    );
    expect(result).toEqual({
      dryRun: false,
      evaluated: 0,
      eligible: 0,
      published: 0,
      skipped: 0,
      failed: 0,
      items: [],
    });

    const untouched = await client.newsCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(untouched.status).toBe('NEW');
    expect(untouched.convertedArticleId).toBeNull();

    // Preview still works with the kill switch off -- it must, to support
    // deciding whether to enable it. Read-only: no risk regardless of what
    // real sources are currently trusted.
    const previewService = new NewsInboxService(
      repository,
      new SafeFeedClient(),
      DEFAULT_NEWS_INGESTION_POLICY,
      () => now,
      { ...POLICY, enabled: false },
    );
    const preview = await previewService.previewAutoPublish();
    const previewItem = preview.items.find((item) => item.candidateId === candidate.id);
    expect(previewItem?.outcome).toBe('ELIGIBLE');
  }, 30_000);

  it('a source without allowsDescriptionUse can never auto-publish (the rights-model conflict this milestone found)', async () => {
    const client = requirePrisma(prisma);
    const editor = await createUser(client, 'EDITOR', userIds);
    const systemActor = await createUser(client, 'ADMIN', userIds);
    const now = new Date('2026-08-29T12:00:00.000Z');

    const source = await createTrustedSource(client, editor, sourceIds, {
      allowsDescriptionUse: false,
    });
    const candidate = await client.newsCandidate.create({
      data: {
        sourceId: source.id,
        sourceNameSnapshot: source.publisherName,
        sourceExternalId: `no-rights-${randomUUID()}`,
        canonicalUrl: `https://news.example.com/story/${randomUUID()}`,
        canonicalUrlHash: randomUUID(),
        headline: 'A fictional headline from a source without description rights',
        sourceDescription:
          'A fictional forty-plus character description used to satisfy the minimum quality threshold in this test.',
        contentType: 'ARTICLE',
        sourcePublishedAt: new Date('2026-08-29T06:00:00.000Z'),
        discoveredAt: new Date('2026-08-29T06:05:00.000Z'),
        status: 'NEW',
      },
    });
    candidateIds.add(candidate.id);

    const repository = new PrismaNewsInboxRepository(client);
    const service = new NewsInboxService(
      repository,
      new SafeFeedClient(),
      DEFAULT_NEWS_INGESTION_POLICY,
      () => now,
      POLICY,
    );
    const systemPrincipal = {
      userId: systemActor.id,
      email: systemActor.email,
      role: systemActor.role,
    };

    const result = await service.autoPublishEligibleCandidates(
      systemPrincipal,
      `${auditPrefix}-no-rights`,
    );
    // M42B starvation fix: `listAutoPublishCandidatePool` now excludes
    // sources without `allowsDescriptionUse` at the query level (the same
    // source-level flags `evaluateAutoPublishEligibility` checks), so this
    // candidate never enters the real run's pool at all -- it no longer
    // appears in `items` as a SKIPPED entry. `previewAutoPublish` reads the
    // same pool, so it stays invisible there too.
    const item = result.items.find((entry) => entry.candidateId === candidate.id);
    expect(item).toBeUndefined();

    const untouched = await client.newsCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(untouched.status).toBe('NEW');

    const preview = await service.previewAutoPublish();
    expect(preview.items.find((entry) => entry.candidateId === candidate.id)).toBeUndefined();
  }, 30_000);

  it('respects the per-source cap across two trusted sources without starving either', async () => {
    const client = requirePrisma(prisma);
    const editor = await createUser(client, 'EDITOR', userIds);
    const systemActor = await createUser(client, 'ADMIN', userIds);
    const now = new Date('2026-08-29T12:00:00.000Z');

    const sourceA = await createTrustedSource(client, editor, sourceIds);
    const sourceB = await createTrustedSource(client, editor, sourceIds);
    const created: string[] = [];
    for (const [source, count] of [
      [sourceA, 3],
      [sourceB, 3],
    ] as const) {
      for (let i = 0; i < count; i += 1) {
        const candidate = await client.newsCandidate.create({
          data: {
            sourceId: source.id,
            sourceNameSnapshot: source.publisherName,
            sourceExternalId: `cap-${source.slug}-${String(i)}-${randomUUID()}`,
            canonicalUrl: `https://news.example.com/story/${randomUUID()}`,
            canonicalUrlHash: randomUUID(),
            headline: `A fictional headline ${String(i)} from ${source.slug}`,
            sourceDescription:
              'A fictional forty-plus character description used to satisfy the minimum quality threshold in this test.',
            contentType: 'ARTICLE',
            sourcePublishedAt: new Date(now.getTime() - i * 60_000),
            discoveredAt: now,
            status: 'NEW',
          },
        });
        candidateIds.add(candidate.id);
        created.push(candidate.id);
      }
    }

    const repository = new PrismaNewsInboxRepository(client);
    const service = new NewsInboxService(
      repository,
      new SafeFeedClient(),
      DEFAULT_NEWS_INGESTION_POLICY,
      () => now,
      { ...POLICY, maxPerSourcePerRun: 2 },
    );
    const systemPrincipal = {
      userId: systemActor.id,
      email: systemActor.email,
      role: systemActor.role,
    };

    const result = await service.autoPublishEligibleCandidates(
      systemPrincipal,
      `${auditPrefix}-per-source-cap`,
    );
    const relevant = result.items.filter((item) => created.includes(item.candidateId));
    const publishedFromA = relevant.filter(
      (item) => item.sourceSlug === sourceA.slug && item.outcome === 'PUBLISHED',
    );
    const publishedFromB = relevant.filter(
      (item) => item.sourceSlug === sourceB.slug && item.outcome === 'PUBLISHED',
    );
    expect(publishedFromA).toHaveLength(2);
    expect(publishedFromB).toHaveLength(2);
    for (const item of relevant.filter((entry) => entry.outcome === 'PUBLISHED')) {
      if (item.articleId !== null) articleIds.add(item.articleId);
    }
    const capped = relevant.filter((item) => item.reason === 'PER_SOURCE_CAP_REACHED');
    expect(capped).toHaveLength(2);
  }, 30_000);

  it('listAutoPublishCandidatePool only ever returns candidates from sources eligible at the source level', async () => {
    const client = requirePrisma(prisma);
    const editor = await createUser(client, 'EDITOR', userIds);
    const now = new Date('2026-08-29T12:00:00.000Z');
    const repository = new PrismaNewsInboxRepository(client);

    type SourceOverrides = NonNullable<Parameters<typeof createTrustedSource>[3]>;
    const cases: readonly {
      readonly name: string;
      readonly overrides: SourceOverrides;
      readonly shouldAppear: boolean;
    }[] = [
      { name: 'inactive', overrides: { status: 'PAUSED' }, shouldAppear: false },
      { name: 'manualOnly', overrides: { kind: 'MANUAL_ONLY' }, shouldAppear: false },
      { name: 'nonArticle', overrides: { contentType: 'VIDEO' }, shouldAppear: false },
      {
        name: 'autoPublishDisabled',
        overrides: { autoPublishArticles: false },
        shouldAppear: false,
      },
      {
        name: 'descriptionUseDisallowed',
        overrides: { allowsDescriptionUse: false },
        shouldAppear: false,
      },
      { name: 'trusted', overrides: {}, shouldAppear: true },
    ];

    const candidateIdByCase = new Map<string, string>();
    for (const { name, overrides } of cases) {
      const source = await createTrustedSource(client, editor, sourceIds, overrides);
      const candidate = await client.newsCandidate.create({
        data: {
          sourceId: source.id,
          sourceNameSnapshot: source.publisherName,
          sourceExternalId: `pool-filter-${name}-${randomUUID()}`,
          canonicalUrl: `https://news.example.com/story/${randomUUID()}`,
          canonicalUrlHash: randomUUID(),
          headline: `A fictional headline for the ${name} pool-filter case`,
          sourceDescription:
            'A fictional forty-plus character description used to satisfy the minimum quality threshold in this test.',
          contentType: source.contentType,
          sourcePublishedAt: now,
          discoveredAt: now,
          status: 'NEW',
        },
      });
      candidateIds.add(candidate.id);
      candidateIdByCase.set(name, candidate.id);
    }

    const pool = await repository.listAutoPublishCandidatePool(500);
    const poolIds = new Set(pool.map((c) => c.id));
    for (const { name, shouldAppear } of cases) {
      const candidateId = candidateIdByCase.get(name);
      if (candidateId === undefined) throw new Error(`missing candidate for case ${name}`);
      expect(poolIds.has(candidateId)).toBe(shouldAppear);
    }
  }, 30_000);

  it('a large permanent backlog from sources that can never auto-publish does not starve genuinely eligible trusted-source candidates out of the bounded real-run pool', async () => {
    const client = requirePrisma(prisma);
    const editor = await createUser(client, 'EDITOR', userIds);
    const systemActor = await createUser(client, 'ADMIN', userIds);
    const now = new Date('2026-08-29T12:00:00.000Z');
    const old = new Date('2026-01-01T00:00:00.000Z');

    // A source that structurally passes status/kind/contentType but can
    // never auto-publish -- exactly the official-team-feed shape that
    // starved the real Render cron.
    const neverEligibleSource = await createTrustedSource(client, editor, sourceIds, {
      autoPublishArticles: false,
    });

    const BACKLOG_SIZE = 105; // > the real production pool size (maxPerRun=20 -> 100)
    const backlogRows = Array.from({ length: BACKLOG_SIZE }, (_, i) => ({
      sourceId: neverEligibleSource.id,
      sourceNameSnapshot: neverEligibleSource.publisherName,
      sourceExternalId: `starvation-backlog-${String(i)}-${randomUUID()}`,
      canonicalUrl: `https://news.example.com/story/${randomUUID()}`,
      canonicalUrlHash: randomUUID(),
      headline: `A fictional backlog headline ${String(i)}`,
      sourceDescription:
        'A fictional forty-plus character description used to satisfy the minimum quality threshold in this test.',
      contentType: 'ARTICLE' as const,
      sourcePublishedAt: new Date(old.getTime() + i * 1000),
      discoveredAt: old,
      status: 'NEW' as const,
    }));
    await client.newsCandidate.createMany({ data: backlogRows });
    const backlog = await client.newsCandidate.findMany({
      where: { sourceId: neverEligibleSource.id },
      select: { id: true },
    });
    for (const row of backlog) candidateIds.add(row.id);
    expect(backlog.length).toBe(BACKLOG_SIZE);

    const trustedSource = await createTrustedSource(client, editor, sourceIds);
    const eligibleCandidate = await client.newsCandidate.create({
      data: {
        sourceId: trustedSource.id,
        sourceNameSnapshot: trustedSource.publisherName,
        sourceExternalId: `starvation-eligible-${randomUUID()}`,
        canonicalUrl: `https://news.example.com/story/${randomUUID()}`,
        canonicalUrlHash: randomUUID(),
        headline: 'A fictional headline that is genuinely eligible right now',
        sourceDescription:
          'A fictional forty-plus character description used to satisfy the minimum quality threshold in this test.',
        contentType: 'ARTICLE',
        sourcePublishedAt: now,
        discoveredAt: now,
        status: 'NEW',
      },
    });
    candidateIds.add(eligibleCandidate.id);

    const repository = new PrismaNewsInboxRepository(client);
    const service = new NewsInboxService(
      repository,
      new SafeFeedClient(),
      DEFAULT_NEWS_INGESTION_POLICY,
      () => now,
      // Matches the real Render cron's production defaults, not this
      // suite's usual maxPerRun: 1_000 -- the whole point of this test is
      // to reproduce the bounded real-run pool (maxPerRun * 5 = 100) the
      // starvation bug depended on.
      {
        enabled: true,
        maxAgeHours: 24,
        maxPerRun: 20,
        maxPerSourcePerRun: 10,
        minDescriptionLength: 40,
      },
    );
    const systemPrincipal = {
      userId: systemActor.id,
      email: systemActor.email,
      role: systemActor.role,
    };

    const result = await service.autoPublishEligibleCandidates(
      systemPrincipal,
      `${auditPrefix}-starvation`,
    );
    const eligibleItem = result.items.find((item) => item.candidateId === eligibleCandidate.id);
    expect(eligibleItem?.outcome).toBe('PUBLISHED');
    if (eligibleItem?.articleId !== undefined && eligibleItem.articleId !== null) {
      articleIds.add(eligibleItem.articleId);
    }

    const backlogItems = result.items.filter((item) =>
      backlog.some((row) => row.id === item.candidateId),
    );
    expect(backlogItems).toHaveLength(0);
    const stillNewBacklogCount = await client.newsCandidate.count({
      where: { sourceId: neverEligibleSource.id, status: 'NEW' },
    });
    expect(stillNewBacklogCount).toBe(BACKLOG_SIZE);
  }, 30_000);
});

async function createTrustedSource(
  client: PrismaClient,
  actor: { id: string; email: string },
  ids: Set<string>,
  overrides: {
    readonly allowsDescriptionUse?: boolean;
    readonly status?: NewsSourceStatus;
    readonly kind?: NewsSourceKind;
    readonly contentType?: NewsContentType;
    readonly autoPublishArticles?: boolean;
  } = {},
) {
  const slug = `m42b-trusted-${randomUUID()}`;
  const source = await client.newsSource.create({
    data: {
      name: 'M42B Fictional Trusted Source',
      slug,
      kind: overrides.kind ?? 'RSS',
      contentType: overrides.contentType ?? 'ARTICLE',
      status: overrides.status ?? 'ACTIVE',
      feedUrl: `https://${slug}.example.com/feed.xml`,
      siteUrl: `https://${slug}.example.com/`,
      publisherName: 'M42B Fictional Publisher',
      allowsDescriptionUse: overrides.allowsDescriptionUse ?? true,
      autoPublishArticles: overrides.autoPublishArticles ?? true,
      createdById: actor.id,
      updatedById: actor.id,
      createdBySnapshot: actor.email,
      updatedBySnapshot: actor.email,
    },
  });
  ids.add(source.id);
  return source;
}

async function createUser(client: PrismaClient, role: UserRole, ids: Set<string>) {
  const email = `news-auto-publish-${role.toLowerCase()}-${randomUUID()}@example.com`;
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

function requirePrisma(client: PrismaClient | undefined): PrismaClient {
  if (client === undefined) throw new Error('Prisma client not initialized');
  return client;
}

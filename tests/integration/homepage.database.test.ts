import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/common/database/prisma.js';
import { loadDatabaseConfig } from '../../src/config/env.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { AdministrativePrincipal } from '../../src/modules/admin/admin-authorization.js';
import { PrismaGameHighlightsRepository } from '../../src/modules/game-highlights/game-highlights.repository.js';
import { GameHighlightsService } from '../../src/modules/game-highlights/game-highlights.service.js';
import { PrismaGameMediaCurationRepository } from '../../src/modules/game-media-curation/game-media-curation.repository.js';
import { GameMediaCurationService } from '../../src/modules/game-media-curation/game-media-curation.service.js';
import { PrismaGlobalGameMediaRepository } from '../../src/modules/game-media-curation/global-game-media.repository.js';
import { PrismaHomepageRepository } from '../../src/modules/homepage/homepage.repository.js';
import { HomepageService } from '../../src/modules/homepage/homepage.service.js';
import type { HomepageGameMediaReader } from '../../src/modules/homepage/homepage.service.js';
import { PrismaStatsHubRepository } from '../../src/modules/stats-hub/stats.repository.js';
import { StatsHubService } from '../../src/modules/stats-hub/stats.service.js';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

function requirePrisma(client: PrismaClient | undefined): PrismaClient {
  if (client === undefined) throw new Error('Expected a connected Prisma client.');
  return client;
}

/** Real `GameMediaCurationService`, wired exactly like `server.ts` (minus the
 * live Highlightly client -- highlight sync itself is out of scope here; only
 * DB-backed reads are exercised). This dev DB already has real curated/
 * automatic media from earlier milestones' verification, so the Highlights
 * section is exercised against real data rather than a stub. */
function realGameMedia(client: PrismaClient): HomepageGameMediaReader {
  const highlightsService = new GameHighlightsService(new PrismaGameHighlightsRepository(client));
  return new GameMediaCurationService(
    new PrismaGameMediaCurationRepository(client),
    highlightsService,
    null,
    new PrismaGlobalGameMediaRepository(client),
  );
}

describe.skipIf(!databaseTestsEnabled)('homepage database integration (M35A)', () => {
  let prisma: PrismaClient | undefined;
  let principal: AdministrativePrincipal | undefined;
  let createdSlideIds: string[] = [];
  let createdArticleId: string | undefined;

  beforeAll(async () => {
    prisma = createPrismaClient(loadDatabaseConfig().databaseUrl);
    const adminUser = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    principal = { userId: adminUser.id, email: adminUser.email, role: 'ADMIN' };
  });

  function requirePrincipal(): AdministrativePrincipal {
    if (principal === undefined) throw new Error('Expected a seeded ADMIN user for this test.');
    return principal;
  }

  afterAll(async () => {
    const client = requirePrisma(prisma);
    for (const slideId of createdSlideIds) {
      await client.homepageHeroSlide.delete({ where: { id: slideId } }).catch(() => undefined);
    }
    if (createdArticleId !== undefined) {
      await client.article.delete({ where: { id: createdArticleId } }).catch(() => undefined);
    }
    await client.$disconnect();
  });

  it('creates three real Hero slides, verifies order/content-blocks/image settings, then cleans up', async () => {
    const client = requirePrisma(prisma);
    const principal = requirePrincipal();
    const repository = new PrismaHomepageRepository(client);
    const service = new HomepageService({
      repository,
      gameMedia: realGameMedia(client),
      stats: new StatsHubService(new PrismaStatsHubRepository(client)),
      fallbackSeason: 2026,
    });

    const slide0 = await service.createHeroSlide(
      {
        isActive: true,
        imageUrl: 'https://example.test/m35a-fixture-0.jpg',
        imageAlt: 'Fixture 0',
        imageBrightness: 110,
        imageContrast: 95,
        imageSaturation: 100,
        overlayOpacity: 20,
        focalPointX: 30,
        focalPointY: 70,
        imageScale: 120,
        contentBlocks: [
          {
            slot: 'MIDDLE_CENTER',
            content: {
              type: 'doc',
              children: [
                { type: 'heading', level: 1, children: [{ type: 'text', text: 'M35A Fixture' }] },
              ],
            },
          },
        ],
        ctas: [{ label: 'Read more', url: '/articles/m35a-fixture', variant: 'PRIMARY' }],
      },
      principal,
      null,
    );
    const slide1 = await service.createHeroSlide(
      {
        isActive: true,
        imageUrl: 'https://example.test/m35a-fixture-1.jpg',
        imageAlt: null,
        imageBrightness: 100,
        imageContrast: 100,
        imageSaturation: 100,
        overlayOpacity: 0,
        focalPointX: 50,
        focalPointY: 50,
        imageScale: 100,
        contentBlocks: [],
        ctas: [],
      },
      principal,
      null,
    );
    const slide2 = await service.createHeroSlide(
      {
        isActive: true,
        imageUrl: 'https://example.test/m35a-fixture-2.jpg',
        imageAlt: null,
        imageBrightness: 100,
        imageContrast: 100,
        imageSaturation: 100,
        overlayOpacity: 0,
        focalPointX: 50,
        focalPointY: 50,
        imageScale: 100,
        contentBlocks: [],
        ctas: [],
      },
      principal,
      null,
    );
    createdSlideIds = [slide0.id, slide1.id, slide2.id];

    const list = await service.listHeroSlides();
    const fixtureSlides = list.slides.filter((s) => createdSlideIds.includes(s.id));
    expect(fixtureSlides.map((s) => s.id)).toEqual([slide0.id, slide1.id, slide2.id]);
    expect(list.meta.activeCount).toBeGreaterThanOrEqual(3);
    expect(list.meta.readyForPublish).toBe(true);

    const detail = await service.getHeroSlide(slide0.id);
    expect(detail.imageBrightness).toBe(110);
    expect(detail.overlayOpacity).toBe(20);
    expect(detail.focalPointX).toBe(30);
    expect(detail.contentBlocks).toEqual([
      {
        slot: 'MIDDLE_CENTER',
        content: {
          type: 'doc',
          children: [
            { type: 'heading', level: 1, children: [{ type: 'text', text: 'M35A Fixture' }] },
          ],
        },
      },
    ]);
    expect(detail.ctas).toEqual([
      {
        id: detail.ctas[0]?.id,
        position: 0,
        label: 'Read more',
        url: '/articles/m35a-fixture',
        variant: 'PRIMARY',
      },
    ]);

    // Reorder: reverse the three fixture slides among themselves, leaving any
    // other pre-existing slides' relative slots untouched. This stays a valid
    // permutation of the *whole* current set (required by
    // `reorderHeroSlides`), it just relabels which ID sits in each
    // fixture-occupied slot.
    const wholeOrder = list.slides.map((s) => s.id);
    const reversedFixtures = [...createdSlideIds].reverse();
    const reorderedWhole = wholeOrder.map((id) => {
      const fixtureIndex = createdSlideIds.indexOf(id);
      return fixtureIndex === -1 ? id : (reversedFixtures[fixtureIndex] ?? id);
    });
    const reordered = await service.reorderHeroSlides(
      { slideIds: reorderedWhole },
      principal,
      null,
    );
    const reorderedFixtures = reordered.slides.filter((s) => createdSlideIds.includes(s.id));
    expect(reorderedFixtures.map((s) => s.id)).toEqual(reversedFixtures);

    // Public homepage includes these active fixture slides.
    const homepage = await service.getPublicHomepage();
    const publicFixtureIds = homepage.heroSlides
      .map((s) => s.id)
      .filter((id) => createdSlideIds.includes(id));
    expect(publicFixtureIds).toHaveLength(3);

    // Delete one and confirm compaction + audit trail.
    await service.deleteHeroSlide(slide1.id, principal, null);
    createdSlideIds = createdSlideIds.filter((id) => id !== slide1.id);
    const afterDelete = await service.listHeroSlides();
    const positions = afterDelete.slides.map((s) => s.position);
    expect(new Set(positions).size).toBe(positions.length); // still contiguous/unique

    const auditEvents = await client.adminAuditEvent.findMany({
      where: { entityType: 'HOMEPAGE_HERO_SLIDE' },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditEvents.some((e) => e.action === 'HOMEPAGE_HERO_SLIDE_CREATED')).toBe(true);
    expect(auditEvents.some((e) => e.action === 'HOMEPAGE_HERO_SLIDE_REORDERED')).toBe(true);
    expect(auditEvents.some((e) => e.action === 'HOMEPAGE_HERO_SLIDE_DELETED')).toBe(true);
  });

  it('curates a real Article as a Top Story, verifies the public payload, then verifies unpublish safely excludes it', async () => {
    const client = requirePrisma(prisma);
    const principal = requirePrincipal();
    const article = await client.article.create({
      data: {
        slug: `m35a-fixture-top-story-${String(Date.now())}`,
        type: 'ORIGINAL',
        status: 'PUBLISHED',
        title: 'M35A Fixture Top Story',
        summary: 'A fixture article summary for the M35A homepage integration test.',
        body: 'A fixture article body for the M35A homepage integration test.',
        publishedAt: new Date(),
        createdBySnapshot: principal.email,
        updatedBySnapshot: principal.email,
      },
    });
    createdArticleId = article.id;

    const repository = new PrismaHomepageRepository(client);
    const service = new HomepageService({
      repository,
      gameMedia: realGameMedia(client),
      stats: new StatsHubService(new PrismaStatsHubRepository(client)),
      fallbackSeason: 2026,
    });

    const marked = await service.markTopStory(article.id, principal, null);
    expect(marked.article.id).toBe(article.id);

    const homepageBefore = await service.getPublicHomepage();
    expect(homepageBefore.topStories.some((t) => t.article.id === article.id)).toBe(true);

    // Unpublish -- the public homepage must safely exclude it, without
    // deleting the Article or the curation row (Article preservation).
    await client.article.update({ where: { id: article.id }, data: { status: 'UNPUBLISHED' } });
    const homepageAfter = await service.getPublicHomepage();
    expect(homepageAfter.topStories.some((t) => t.article.id === article.id)).toBe(false);

    const stillCurated = await service.listTopStories();
    expect(stillCurated.some((t) => t.article.id === article.id)).toBe(true);
    const articleStillExists = await client.article.findUnique({ where: { id: article.id } });
    expect(articleStillExists).not.toBeNull();

    await service.unmarkTopStory(article.id, principal, null);
    const auditEvents = await client.adminAuditEvent.findMany({
      where: { entityType: 'HOMEPAGE_TOP_STORY' },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditEvents.some((e) => e.action === 'HOMEPAGE_TOP_STORY_MARKED')).toBe(true);
    expect(auditEvents.some((e) => e.action === 'HOMEPAGE_TOP_STORY_UNMARKED')).toBe(true);
  });

  it('verifies leaders against real stored historical data, with an explicit non-fabricated season', async () => {
    const client = requirePrisma(prisma);
    const repository = new PrismaHomepageRepository(client);
    const service = new HomepageService({
      repository,
      gameMedia: realGameMedia(client),
      stats: new StatsHubService(new PrismaStatsHubRepository(client)),
      fallbackSeason: 2026,
    });

    const homepage = await service.getPublicHomepage();
    expect(homepage.leaders.seasonType).toBe('REG');
    expect(homepage.leaders.season).toBeGreaterThan(2000);
    expect(homepage.leaders.season).toBeLessThan(2026); // never the live/un-imported current season
    for (const category of [
      homepage.leaders.passing,
      homepage.leaders.rushing,
      homepage.leaders.receiving,
    ]) {
      expect(category.length).toBeLessThanOrEqual(3);
      category.forEach((row) => {
        expect(row.rank).toBeGreaterThanOrEqual(1);
        expect(typeof row.value).toBe('number');
        expect(row.player.id).toBeTruthy();
      });
    }
  });
});

import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/common/database/prisma.js';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PrismaGameMediaCurationRepository } from '../../src/modules/game-media-curation/game-media-curation.repository.js';
import { GameMediaCurationService } from '../../src/modules/game-media-curation/game-media-curation.service.js';
import type { GameMediaHighlightsReader } from '../../src/modules/game-media-curation/game-media-curation.service.js';
import { MAX_CURATED_VIDEOS_PER_GAME } from '../../src/modules/game-media-curation/game-media-curation.repository.js';
import { PrismaGlobalGameMediaRepository } from '../../src/modules/game-media-curation/global-game-media.repository.js';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';

function requirePrisma(client: PrismaClient | undefined): PrismaClient {
  if (client === undefined) throw new Error('Expected a connected Prisma client.');
  return client;
}

const principal = {
  userId: '00000000-0000-4000-8000-000000000900',
  email: 'operator@example.test',
  role: 'ADMIN' as const,
};

const noHighlights: GameMediaHighlightsReader = {
  getPublicHighlights: (gameId) => Promise.resolve({ gameId, coverage: 'UNKNOWN', highlights: [] }),
};

describe.skipIf(!databaseTestsEnabled)('game media curation database integration (M32)', () => {
  let prisma: PrismaClient | undefined;
  let gameId: string | undefined;

  beforeAll(async () => {
    prisma = createPrismaClient(resolveTestDatabaseUrl());
    const teams = await prisma.team.findMany({ take: 2, orderBy: { id: 'asc' } });
    const homeTeam = teams.at(0);
    const awayTeam = teams.at(1);
    if (homeTeam === undefined || awayTeam === undefined) {
      throw new Error('Expected at least two seeded teams for this integration test.');
    }
    const game = await prisma.game.create({
      data: {
        league: 'NFL',
        season: 2026,
        seasonType: 'PRE',
        week: 2,
        startTime: new Date('2026-08-22T23:00:00.000Z'),
        status: 'FINAL',
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
      },
    });
    gameId = game.id;
  });

  afterAll(async () => {
    const client = requirePrisma(prisma);
    if (gameId !== undefined) {
      await client.game.delete({ where: { id: gameId } }).catch(() => undefined);
    }
    // The global video table is a real cross-suite singleton -- never leave a
    // fixture row behind in the shared dev database.
    await client.globalGameCenterVideo.deleteMany({ where: { sourceLabel: 'Test Fixture' } });
    await client.$disconnect();
  });

  it('adds, reorders, and deletes curated videos without ever touching GameHighlight, and enforces the max/duplicate/reorder invariants', async () => {
    const client = requirePrisma(prisma);
    const id = gameId;
    if (id === undefined) throw new Error('Expected a fictional game.');

    // A pre-existing automatic highlight row for the same game -- untouched
    // by every curated-video operation below.
    await client.gameHighlight.create({
      data: {
        gameId: id,
        provider: 'highlightly',
        providerHighlightKey: 'fictional-900001',
        title: 'Fictional Automatic Highlight',
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

    const repository = new PrismaGameMediaCurationRepository(client);
    const globalRepository = new PrismaGlobalGameMediaRepository(client);
    const service = new GameMediaCurationService(repository, noHighlights, null, globalRepository);

    // Before any curated video: AUTOMATIC (the pre-existing highlight).
    const beforeCuration = await service.getGameMediaDetail(id);
    expect(beforeCuration.displayMode).toBe('AUTOMATIC');

    for (let i = 0; i < MAX_CURATED_VIDEOS_PER_GAME; i += 1) {
      await service.addVideo(
        id,
        {
          title: `Fictional Curated Video ${String(i)}`,
          embedUrl: `https://www.youtube.com/embed/fictional-${String(i)}`,
          canonicalUrl: null,
          thumbnailUrl: null,
          sourceLabel: 'Test Fixture',
        },
        principal,
        null,
      );
    }
    const full = await service.getGameMediaDetail(id);
    expect(full.curatedVideos).toHaveLength(MAX_CURATED_VIDEOS_PER_GAME);
    expect(full.curatedVideos[0]?.isPrimary).toBe(true);
    expect(full.displayMode).toBe('CURATED');

    // The pre-existing GameHighlight row must still exist, unmodified.
    const highlightRow = await client.gameHighlight.findFirst({
      where: { gameId: id, providerHighlightKey: 'fictional-900001' },
    });
    expect(highlightRow?.title).toBe('Fictional Automatic Highlight');

    // A fifth video is rejected server-side.
    await expect(
      service.addVideo(
        id,
        {
          title: 'One Too Many',
          embedUrl: 'https://www.youtube.com/embed/fictional-one-too-many',
          canonicalUrl: null,
          thumbnailUrl: null,
          sourceLabel: null,
        },
        principal,
        null,
      ),
    ).rejects.toMatchObject({ code: 'GAME_CURATED_VIDEO_LIMIT_REACHED' });

    // A duplicate embed URL for the same game is rejected.
    await expect(
      service.addVideo(
        id,
        {
          title: 'Duplicate',
          embedUrl: 'https://www.youtube.com/embed/fictional-0',
          canonicalUrl: null,
          thumbnailUrl: null,
          sourceLabel: null,
        },
        principal,
        null,
      ),
    ).rejects.toMatchObject({ code: 'GAME_CURATED_VIDEO_DUPLICATE_EMBED_URL' });

    // Reorder: reverse the order -- the last video becomes primary.
    const videoIds = full.curatedVideos.map((video) => video.id);
    const reordered = await service.reorderVideos(id, [...videoIds].reverse(), principal, null);
    expect(reordered.curatedVideos.map((video) => video.id)).toEqual([...videoIds].reverse());
    expect(reordered.curatedVideos[0]?.id).toBe(videoIds.at(-1));
    expect(reordered.curatedVideos[0]?.isPrimary).toBe(true);

    // A reorder missing one ID is rejected.
    await expect(
      service.reorderVideos(id, videoIds.slice(0, -1), principal, null),
    ).rejects.toMatchObject({ code: 'GAME_CURATED_VIDEO_REORDER_MISMATCH' });

    // Delete the current primary -- compaction promotes the next one.
    const currentPrimary = reordered.curatedVideos[0];
    if (currentPrimary === undefined) throw new Error('Expected a primary curated video.');
    const currentPrimaryId = currentPrimary.id;
    const afterDelete = await service.deleteVideo(currentPrimaryId, principal, null);
    expect(afterDelete.curatedVideos).toHaveLength(MAX_CURATED_VIDEOS_PER_GAME - 1);
    expect(afterDelete.curatedVideos[0]?.isPrimary).toBe(true);
    expect(afterDelete.curatedVideos.some((video) => video.id === currentPrimaryId)).toBe(false);

    // Delete the remaining videos -- once none are left, display falls back
    // to AUTOMATIC because the highlight row is still there, untouched.
    for (const video of afterDelete.curatedVideos) {
      await service.deleteVideo(video.id, principal, null);
    }
    const afterAllDeleted = await service.getGameMediaDetail(id);
    expect(afterAllDeleted.curatedVideos).toHaveLength(0);
    expect(afterAllDeleted.displayMode).toBe('AUTOMATIC');
    const highlightStillThere = await client.gameHighlight.findFirst({
      where: { gameId: id, providerHighlightKey: 'fictional-900001' },
    });
    expect(highlightStillThere).not.toBeNull();

    // The public API never leaks admin-only fields.
    const publicMedia = await service.getPublicGameMedia(id);
    const serialized = JSON.stringify(publicMedia);
    expect(serialized).not.toContain('createdById');
    expect(serialized).not.toContain('createdBySnapshot');
    expect(serialized).not.toContain('highlightly');

    // Every mutation above produced an audit trail.
    const auditEvents = await client.adminAuditEvent.findMany({
      where: { entityType: { in: ['GAME_CURATED_VIDEO', 'GAME'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditEvents.some((e) => e.action === 'GAME_CURATED_VIDEO_CREATED')).toBe(true);
    expect(auditEvents.some((e) => e.action === 'GAME_CURATED_VIDEO_REORDERED')).toBe(true);
    expect(auditEvents.some((e) => e.action === 'GAME_CURATED_VIDEO_DELETED')).toBe(true);
  });

  it('reports GAME_NOT_FOUND for an unknown game', async () => {
    const client = requirePrisma(prisma);
    const repository = new PrismaGameMediaCurationRepository(client);
    const globalRepository = new PrismaGlobalGameMediaRepository(client);
    const service = new GameMediaCurationService(repository, noHighlights, null, globalRepository);
    await expect(
      service.getGameMediaDetail('00000000-0000-4000-8000-000000000999'),
    ).rejects.toMatchObject({ code: 'GAME_NOT_FOUND' });
  });

  it('M32B: composes a real global video into an AUTOMATIC game (no game rows touched), then reverts cleanly on removal', async () => {
    const client = requirePrisma(prisma);
    const id = gameId;
    if (id === undefined) throw new Error('Expected a fictional game.');

    await client.gameHighlight.create({
      data: {
        gameId: id,
        provider: 'highlightly',
        providerHighlightKey: 'fictional-global-900002',
        title: 'Fictional Automatic Highlight For Global Test',
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

    const repository = new PrismaGameMediaCurationRepository(client);
    const globalRepository = new PrismaGlobalGameMediaRepository(client);
    const highlightsReader: GameMediaHighlightsReader = {
      getPublicHighlights: (gameId2) =>
        Promise.resolve({
          gameId: gameId2,
          coverage: 'AVAILABLE',
          highlights: [
            {
              id: 'fictional-global-900002',
              title: 'Fictional Automatic Highlight For Global Test',
              description: null,
              highlightType: 'GAME',
              thumbnailUrl: null,
              canonicalUrl: null,
              embedUrl: 'https://www.youtube.com/embed/fictional-global-900002',
              canEmbed: true,
              publishedAt: null,
            },
          ],
        }),
    };
    const service = new GameMediaCurationService(
      repository,
      highlightsReader,
      null,
      globalRepository,
    );

    const before = await service.getPublicGameMedia(id);
    expect(before.displayMode).toBe('AUTOMATIC');
    expect(before.displayVideos.map((item) => item.mediaType)).toEqual(['AUTOMATIC']);

    expect(await service.getGlobalVideo()).toBeNull();
    const created = await service.setGlobalVideo(
      {
        title: 'Fictional Global Video',
        embedUrl: 'https://www.youtube.com/embed/fictional-global-video',
        canonicalUrl: null,
        thumbnailUrl: null,
        sourceLabel: 'Test Fixture',
      },
      principal,
      null,
    );

    const withGlobal = await service.getPublicGameMedia(id);
    expect(withGlobal.displayMode).toBe('AUTOMATIC'); // unchanged -- global never upgrades an existing mode
    expect(withGlobal.displayVideos.map((item) => item.mediaType)).toEqual(['AUTOMATIC', 'GLOBAL']);
    expect(withGlobal.globalVideo?.id).toBe(created.id);

    // Idempotent replace -- still exactly one row.
    const replaced = await service.setGlobalVideo(
      {
        title: 'Fictional Global Video (Replaced)',
        embedUrl: 'https://www.youtube.com/embed/fictional-global-video-2',
        canonicalUrl: null,
        thumbnailUrl: null,
        sourceLabel: 'Test Fixture',
      },
      principal,
      null,
    );
    expect(replaced.id).toBe(created.id);
    const rowCount = await client.globalGameCenterVideo.count();
    expect(rowCount).toBe(1);

    // No game rows were ever touched by adding/replacing the global video.
    const highlightUnchanged = await client.gameHighlight.findFirst({
      where: { gameId: id, providerHighlightKey: 'fictional-global-900002' },
    });
    expect(highlightUnchanged?.title).toBe('Fictional Automatic Highlight For Global Test');
    const curatedCountUnchanged = await client.gameCuratedVideo.count({ where: { gameId: id } });
    expect(curatedCountUnchanged).toBe(0);

    // Remove -- reverts exactly to the pre-global state.
    await service.removeGlobalVideo(principal, null);
    const afterRemoval = await service.getPublicGameMedia(id);
    expect(afterRemoval.displayMode).toBe('AUTOMATIC');
    expect(afterRemoval.displayVideos.map((item) => item.mediaType)).toEqual(['AUTOMATIC']);
    expect(await service.getGlobalVideo()).toBeNull();

    const auditEvents = await client.adminAuditEvent.findMany({
      where: { entityType: 'GLOBAL_GAME_MEDIA' },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditEvents.some((e) => e.action === 'GLOBAL_GAME_MEDIA_CREATED')).toBe(true);
    expect(auditEvents.some((e) => e.action === 'GLOBAL_GAME_MEDIA_UPDATED')).toBe(true);
    expect(auditEvents.some((e) => e.action === 'GLOBAL_GAME_MEDIA_REMOVED')).toBe(true);
  });

  it('M32B: a game with no curated/automatic media reports GLOBAL, not NONE, once a global video is active', async () => {
    const client = requirePrisma(prisma);
    const teams = await client.team.findMany({ take: 2, orderBy: { id: 'asc' } });
    const homeTeam = teams.at(0);
    const awayTeam = teams.at(1);
    if (homeTeam === undefined || awayTeam === undefined) throw new Error('Expected seeded teams.');
    const bareGame = await client.game.create({
      data: {
        league: 'NFL',
        season: 2026,
        seasonType: 'PRE',
        week: 3,
        startTime: new Date('2026-08-29T23:00:00.000Z'),
        status: 'SCHEDULED',
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
      },
    });
    try {
      const repository = new PrismaGameMediaCurationRepository(client);
      const globalRepository = new PrismaGlobalGameMediaRepository(client);
      const service = new GameMediaCurationService(
        repository,
        noHighlights,
        null,
        globalRepository,
      );

      const withoutGlobal = await service.getPublicGameMedia(bareGame.id);
      expect(withoutGlobal.displayMode).toBe('NONE');

      await service.setGlobalVideo(
        {
          title: 'Fictional Global Video (Bare Game)',
          embedUrl: 'https://www.youtube.com/embed/fictional-global-bare',
          canonicalUrl: null,
          thumbnailUrl: null,
          sourceLabel: 'Test Fixture',
        },
        principal,
        null,
      );
      const withGlobal = await service.getPublicGameMedia(bareGame.id);
      expect(withGlobal.displayMode).toBe('GLOBAL');
      expect(withGlobal.displayVideos.map((item) => item.mediaType)).toEqual(['GLOBAL']);

      await service.removeGlobalVideo(principal, null);
      const afterRemoval = await service.getPublicGameMedia(bareGame.id);
      expect(afterRemoval.displayMode).toBe('NONE');
    } finally {
      await client.game.delete({ where: { id: bareGame.id } }).catch(() => undefined);
    }
  });
});

import { describe, expect, it } from 'vitest';

import type { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import type { PublicGameHighlightItemDto } from '../game-highlights/game-highlights.dto.js';
import type { GameWithTeams } from '../games/game.dto.js';
import {
  GameMediaCurationService,
  type GameMediaHighlightsReader,
} from './game-media-curation.service.js';
import type {
  CuratedVideoUpdateInput,
  CuratedVideoWriteInput,
  GameCuratedVideoRecord,
  GameMediaBrowseRow,
  GameMediaCurationRepository,
  GameMediaWeekQueryInput,
} from './game-media-curation.repository.js';
import { MAX_CURATED_VIDEOS_PER_GAME } from './game-media-curation.repository.js';
import { AppError as AppErrorClass } from '../../common/errors/app-error.js';
import type {
  GlobalGameCenterVideoRecord,
  GlobalGameCenterVideoWriteInput,
  GlobalGameMediaRepository,
} from './global-game-media.repository.js';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected a defined value in test setup.');
  return value;
}

const principal: AdministrativePrincipal = {
  userId: 'user-1',
  email: 'admin@example.test',
  role: 'ADMIN',
};

function fakeGame(overrides: Partial<GameWithTeams> = {}): GameWithTeams {
  const team = (id: string, abbreviation: string) => ({
    id,
    fullName: `${abbreviation} Team`,
    abbreviation,
    logoUrl: null,
    primaryColor: '#000000',
    secondaryColor: '#ffffff',
  });
  return {
    id: 'game-1',
    league: 'NFL',
    season: 2026,
    seasonType: 'PRE',
    week: 2,
    startTime: new Date('2026-08-22T23:00:00.000Z'),
    status: 'FINAL',
    homeScore: 20,
    awayScore: 17,
    quarter: null,
    clock: null,
    venueName: null,
    venueCity: null,
    broadcastNetwork: null,
    isNeutralSite: false,
    homeTeam: team('team-home', 'NE'),
    awayTeam: team('team-away', 'PHI'),
    editorialOverride: null,
    ...overrides,
  } as unknown as GameWithTeams;
}

class FakeRepository implements GameMediaCurationRepository {
  gamesById = new Map<string, GameWithTeams>();
  videosByGame = new Map<string, GameCuratedVideoRecord[]>();
  highlightCountByGame = new Map<string, number>();
  private nextId = 1;

  findGame(gameId: string): Promise<GameWithTeams | null> {
    return Promise.resolve(this.gamesById.get(gameId) ?? null);
  }

  listGamesForWeek(query: GameMediaWeekQueryInput): Promise<readonly GameMediaBrowseRow[]> {
    const rows = [...this.gamesById.values()]
      .filter(
        (game) =>
          game.season === query.season &&
          game.seasonType === query.seasonType &&
          (query.week === undefined || game.week === query.week),
      )
      .map((game) => ({
        game,
        curatedVideoCount: this.videosByGame.get(game.id)?.length ?? 0,
        automaticHighlightCount: this.highlightCountByGame.get(game.id) ?? 0,
      }));
    return Promise.resolve(rows);
  }

  listVideos(gameId: string): Promise<readonly GameCuratedVideoRecord[]> {
    return Promise.resolve(
      [...(this.videosByGame.get(gameId) ?? [])].sort((a, b) => a.position - b.position),
    );
  }

  countHighlights(gameId: string): Promise<number> {
    return Promise.resolve(this.highlightCountByGame.get(gameId) ?? 0);
  }

  findVideo(videoId: string): Promise<GameCuratedVideoRecord | null> {
    for (const videos of this.videosByGame.values()) {
      const found = videos.find((video) => video.id === videoId);
      if (found !== undefined) return Promise.resolve(found);
    }
    return Promise.resolve(null);
  }

  createVideo(
    gameId: string,
    input: CuratedVideoWriteInput,
    actor: unknown,
  ): Promise<GameCuratedVideoRecord> {
    void actor;
    const existing = this.videosByGame.get(gameId) ?? [];
    if (existing.length >= MAX_CURATED_VIDEOS_PER_GAME) {
      return Promise.reject(
        new AppErrorClass({
          code: 'GAME_CURATED_VIDEO_LIMIT_REACHED',
          message: 'limit reached',
          statusCode: 409,
        }),
      );
    }
    if (existing.some((video) => video.embedUrl === input.embedUrl)) {
      return Promise.reject(
        new AppErrorClass({
          code: 'GAME_CURATED_VIDEO_DUPLICATE_EMBED_URL',
          message: 'duplicate',
          statusCode: 409,
        }),
      );
    }
    const record: GameCuratedVideoRecord = {
      id: `video-${String(this.nextId++)}`,
      gameId,
      position: existing.length,
      title: input.title,
      embedUrl: input.embedUrl,
      canonicalUrl: input.canonicalUrl,
      thumbnailUrl: input.thumbnailUrl,
      sourceLabel: input.sourceLabel,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.videosByGame.set(gameId, [...existing, record]);
    return Promise.resolve(record);
  }

  updateVideo(
    videoId: string,
    input: CuratedVideoUpdateInput,
    actor: unknown,
  ): Promise<GameCuratedVideoRecord> {
    void actor;
    for (const videos of this.videosByGame.values()) {
      const index = videos.findIndex((video) => video.id === videoId);
      if (index === -1) continue;
      const existing = videos[index];
      if (existing === undefined) break;
      if (
        input.embedUrl !== undefined &&
        videos.some((video, i) => i !== index && video.embedUrl === input.embedUrl)
      ) {
        return Promise.reject(
          new AppErrorClass({
            code: 'GAME_CURATED_VIDEO_DUPLICATE_EMBED_URL',
            message: 'duplicate',
            statusCode: 409,
          }),
        );
      }
      const updated: GameCuratedVideoRecord = {
        ...existing,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.embedUrl === undefined ? {} : { embedUrl: input.embedUrl }),
        ...(input.canonicalUrl === undefined ? {} : { canonicalUrl: input.canonicalUrl }),
        ...(input.thumbnailUrl === undefined ? {} : { thumbnailUrl: input.thumbnailUrl }),
        ...(input.sourceLabel === undefined ? {} : { sourceLabel: input.sourceLabel }),
        updatedAt: new Date(),
      };
      videos[index] = updated;
      return Promise.resolve(updated);
    }
    return Promise.reject(new Error('video not found'));
  }

  deleteVideo(videoId: string, actor: unknown): Promise<GameCuratedVideoRecord> {
    void actor;
    for (const [gameId, videos] of this.videosByGame) {
      const index = videos.findIndex((video) => video.id === videoId);
      if (index === -1) continue;
      const deleted = videos[index];
      if (deleted === undefined) break;
      const remaining = videos.filter((video) => video.id !== videoId);
      const compacted = [...remaining]
        .sort((a, b) => a.position - b.position)
        .map((video, i) => ({ ...video, position: i }));
      this.videosByGame.set(gameId, compacted);
      return Promise.resolve(deleted);
    }
    return Promise.reject(new Error('video not found'));
  }

  reorderVideos(
    gameId: string,
    orderedVideoIds: readonly string[],
    actor: unknown,
  ): Promise<readonly GameCuratedVideoRecord[]> {
    void actor;
    const videos = this.videosByGame.get(gameId) ?? [];
    const byId = new Map(videos.map((video) => [video.id, video]));
    const ordered: GameCuratedVideoRecord[] = [];
    for (const id of orderedVideoIds) {
      const video = byId.get(id);
      if (video === undefined) {
        return Promise.reject(
          new AppErrorClass({
            code: 'GAME_CURATED_VIDEO_REORDER_MISMATCH',
            message: 'mismatch',
            statusCode: 422,
          }),
        );
      }
      ordered.push(video);
    }
    const repositioned = ordered.map((video, index) => ({ ...video, position: index }));
    this.videosByGame.set(gameId, repositioned);
    return Promise.resolve(repositioned);
  }
}

function fakeHighlightsReader(
  highlights: readonly PublicGameHighlightItemDto[] = [],
  coverage = 'UNKNOWN',
): GameMediaHighlightsReader {
  return {
    getPublicHighlights: () => Promise.resolve({ gameId: 'game-1', coverage, highlights }),
  };
}

const youtubeHosts = ['youtube.com', 'www.youtube.com'];

function video(overrides: Partial<CuratedVideoWriteInput> = {}): CuratedVideoWriteInput {
  return {
    title: 'Eagles vs. Patriots | Game Highlights',
    embedUrl: 'https://www.youtube.com/embed/abc123',
    canonicalUrl: null,
    thumbnailUrl: null,
    sourceLabel: null,
    ...overrides,
  };
}

/** M32B fake -- mirrors the real repository's "table holds at most one row"
 * invariant: `upsert` always updates the same in-memory record if one exists. */
class FakeGlobalMediaRepository implements GlobalGameMediaRepository {
  current: GlobalGameCenterVideoRecord | null = null;
  private nextId = 1;

  findActive(): Promise<GlobalGameCenterVideoRecord | null> {
    return Promise.resolve(this.current);
  }

  upsert(input: GlobalGameCenterVideoWriteInput): Promise<GlobalGameCenterVideoRecord> {
    const now = new Date();
    this.current = {
      id: this.current?.id ?? `global-video-${String(this.nextId++)}`,
      title: input.title,
      embedUrl: input.embedUrl,
      canonicalUrl: input.canonicalUrl,
      thumbnailUrl: input.thumbnailUrl,
      sourceLabel: input.sourceLabel,
      isActive: true,
      createdAt: this.current?.createdAt ?? now,
      updatedAt: now,
    };
    return Promise.resolve(this.current);
  }

  remove(): Promise<GlobalGameCenterVideoRecord | null> {
    const removed = this.current;
    this.current = null;
    return Promise.resolve(removed);
  }
}

function fakeGlobalMediaRepository(
  seed: GlobalGameCenterVideoWriteInput | null = null,
): FakeGlobalMediaRepository {
  const repository = new FakeGlobalMediaRepository();
  if (seed !== null) {
    repository.current = {
      id: 'global-video-seed',
      title: seed.title,
      embedUrl: seed.embedUrl,
      canonicalUrl: seed.canonicalUrl,
      thumbnailUrl: seed.thumbnailUrl,
      sourceLabel: seed.sourceLabel,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
  return repository;
}

function globalVideoInput(
  overrides: Partial<GlobalGameCenterVideoWriteInput> = {},
): GlobalGameCenterVideoWriteInput {
  return {
    title: 'NFL Kickoff Special',
    embedUrl: 'https://www.youtube.com/embed/global123',
    canonicalUrl: null,
    thumbnailUrl: null,
    sourceLabel: 'NFL',
    ...overrides,
  };
}

describe('GameMediaCurationService', () => {
  it('adds videos at sequential positions with the first as primary', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );

    const first = await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/1' }),
      principal,
      null,
    );
    expect(first.curatedVideos).toHaveLength(1);
    expect(first.curatedVideos[0]?.position).toBe(0);
    expect(first.curatedVideos[0]?.isPrimary).toBe(true);

    const second = await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/2' }),
      principal,
      null,
    );
    expect(second.curatedVideos).toHaveLength(2);
    expect(second.curatedVideos[1]?.position).toBe(1);
    expect(second.curatedVideos[1]?.isPrimary).toBe(false);
  });

  it('rejects a fifth video for the same game', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    for (let i = 0; i < MAX_CURATED_VIDEOS_PER_GAME; i += 1) {
      await service.addVideo(
        'game-1',
        video({ embedUrl: `https://www.youtube.com/embed/${String(i)}` }),
        principal,
        null,
      );
    }
    await expect(
      service.addVideo(
        'game-1',
        video({ embedUrl: 'https://www.youtube.com/embed/one-too-many' }),
        principal,
        null,
      ),
    ).rejects.toMatchObject({
      code: 'GAME_CURATED_VIDEO_LIMIT_REACHED',
    } satisfies Partial<AppError>);
  });

  it('rejects a duplicate embed URL for the same game', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    await service.addVideo('game-1', video(), principal, null);
    await expect(service.addVideo('game-1', video(), principal, null)).rejects.toMatchObject({
      code: 'GAME_CURATED_VIDEO_DUPLICATE_EMBED_URL',
    } satisfies Partial<AppError>);
  });

  it('rejects an embed host outside the configured allowlist', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    await expect(
      service.addVideo(
        'game-1',
        video({ embedUrl: 'https://vimeo.com/embed/123' }),
        principal,
        null,
      ),
    ).rejects.toMatchObject({
      code: 'GAME_CURATED_VIDEO_HOST_NOT_ALLOWED',
    } satisfies Partial<AppError>);
  });

  it('allows any HTTPS host when the allowlist is disabled (null)', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      null,
      fakeGlobalMediaRepository(),
    );
    const detail = await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://vimeo.com/embed/123' }),
      principal,
      null,
    );
    expect(detail.curatedVideos).toHaveLength(1);
  });

  it('reorders videos so the first ID becomes primary', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/1' }),
      principal,
      null,
    );
    await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/2' }),
      principal,
      null,
    );
    const [firstId, secondId] = must(repository.videosByGame.get('game-1')).map((v) => v.id);

    const reordered = await service.reorderVideos(
      'game-1',
      [must(secondId), must(firstId)],
      principal,
      null,
    );
    expect(reordered.curatedVideos[0]?.id).toBe(secondId);
    expect(reordered.curatedVideos[0]?.isPrimary).toBe(true);
    expect(reordered.curatedVideos[1]?.id).toBe(firstId);
    expect(reordered.curatedVideos[1]?.isPrimary).toBe(false);
  });

  it('rejects a reorder missing one of the game’s current videos', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/1' }),
      principal,
      null,
    );
    await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/2' }),
      principal,
      null,
    );
    const [firstId] = must(repository.videosByGame.get('game-1')).map((v) => v.id);

    await expect(
      service.reorderVideos('game-1', [must(firstId)], principal, null),
    ).rejects.toMatchObject({
      code: 'GAME_CURATED_VIDEO_REORDER_MISMATCH',
    } satisfies Partial<AppError>);
  });

  it('rejects a reorder containing a duplicate ID', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/1' }),
      principal,
      null,
    );
    await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/2' }),
      principal,
      null,
    );
    const [firstId] = must(repository.videosByGame.get('game-1')).map((v) => v.id);

    await expect(
      service.reorderVideos('game-1', [must(firstId), must(firstId)], principal, null),
    ).rejects.toMatchObject({
      code: 'GAME_CURATED_VIDEO_REORDER_MISMATCH',
    } satisfies Partial<AppError>);
  });

  it('rejects a reorder containing an unrecognized ID', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    await service.addVideo('game-1', video(), principal, null);

    await expect(
      service.reorderVideos('game-1', ['not-a-real-video-id'], principal, null),
    ).rejects.toMatchObject({
      code: 'GAME_CURATED_VIDEO_REORDER_MISMATCH',
    } satisfies Partial<AppError>);
  });

  it('compacts positions on delete so the next video becomes primary', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/1' }),
      principal,
      null,
    );
    await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/2' }),
      principal,
      null,
    );
    const [firstId, secondId] = must(repository.videosByGame.get('game-1')).map((v) => v.id);

    const afterDelete = await service.deleteVideo(must(firstId), principal, null);
    expect(afterDelete.curatedVideos).toHaveLength(1);
    expect(afterDelete.curatedVideos[0]?.id).toBe(secondId);
    expect(afterDelete.curatedVideos[0]?.position).toBe(0);
    expect(afterDelete.curatedVideos[0]?.isPrimary).toBe(true);
  });

  it('falls back to AUTOMATIC once the last curated video is deleted, when highlights exist', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    repository.highlightCountByGame.set('game-1', 1);
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    const added = await service.addVideo('game-1', video(), principal, null);
    expect(added.displayMode).toBe('CURATED');

    const videoId = must(added.curatedVideos[0]).id;
    const afterDelete = await service.deleteVideo(videoId, principal, null);
    expect(afterDelete.curatedVideos).toHaveLength(0);
    expect(afterDelete.displayMode).toBe('AUTOMATIC');
  });

  it('falls back to NONE once the last curated video is deleted, when no highlights exist either', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    const added = await service.addVideo('game-1', video(), principal, null);
    const afterDelete = await service.deleteVideo(must(added.curatedVideos[0]).id, principal, null);
    expect(afterDelete.displayMode).toBe('NONE');
  });

  it('reports the correct displayMode via getGameMediaDetail for all three states', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    repository.gamesById.set('game-2', fakeGame({ id: 'game-2' }));
    repository.gamesById.set('game-3', fakeGame({ id: 'game-3' }));
    repository.highlightCountByGame.set('game-2', 3);
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    await service.addVideo('game-1', video(), principal, null);

    expect((await service.getGameMediaDetail('game-1')).displayMode).toBe('CURATED');
    expect((await service.getGameMediaDetail('game-2')).displayMode).toBe('AUTOMATIC');
    expect((await service.getGameMediaDetail('game-3')).displayMode).toBe('NONE');
  });

  it('does not touch the automatic-highlight count when curating videos (preservation)', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    repository.highlightCountByGame.set('game-1', 2);
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );

    await service.addVideo('game-1', video(), principal, null);
    expect(repository.highlightCountByGame.get('game-1')).toBe(2);
    const detail = await service.getGameMediaDetail('game-1');
    expect(detail.game.automaticHighlightCount).toBe(2);
    expect(detail.displayMode).toBe('CURATED'); // curated overrides display, but the count itself is untouched
  });

  it('throws GAME_NOT_FOUND for an unknown game', async () => {
    const repository = new FakeRepository();
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    await expect(service.getGameMediaDetail('missing')).rejects.toMatchObject({
      code: 'GAME_NOT_FOUND',
    } satisfies Partial<AppError>);
  });

  it('throws GAME_CURATED_VIDEO_NOT_FOUND for an unknown video', async () => {
    const repository = new FakeRepository();
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    await expect(
      service.updateVideo('missing', { title: 'x' }, principal, null),
    ).rejects.toMatchObject({
      code: 'GAME_CURATED_VIDEO_NOT_FOUND',
    } satisfies Partial<AppError>);
  });

  it('getPublicGameMedia composes curated videos and highlights with the correct displayMode', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const highlight: PublicGameHighlightItemDto = {
      id: 'highlight-1',
      title: 'Automatic Highlight',
      description: null,
      highlightType: 'GAME',
      thumbnailUrl: null,
      canonicalUrl: null,
      embedUrl: null,
      canEmbed: false,
      publishedAt: null,
    };
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader([highlight], 'AVAILABLE'),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );

    const withoutCurated = await service.getPublicGameMedia('game-1');
    expect(withoutCurated.displayMode).toBe('AUTOMATIC');
    expect(withoutCurated.highlights).toEqual([highlight]);
    expect(withoutCurated.curatedVideos).toEqual([]);

    await service.addVideo('game-1', video(), principal, null);
    const withCurated = await service.getPublicGameMedia('game-1');
    expect(withCurated.displayMode).toBe('CURATED');
    expect(withCurated.curatedVideos).toHaveLength(1);
    // Highlights remain present in the response even when curated overrides
    // display -- the highlight data itself is never deleted or hidden.
    expect(withCurated.highlights).toEqual([highlight]);
  });
});

function automaticHighlight(id: string, title: string): PublicGameHighlightItemDto {
  return {
    id,
    title,
    description: null,
    highlightType: 'GAME',
    thumbnailUrl: null,
    canonicalUrl: null,
    embedUrl: `https://www.youtube.com/embed/${id}`,
    canEmbed: true,
    publishedAt: null,
  };
}

describe('GameMediaCurationService global video (M32B)', () => {
  it('getGlobalVideo returns null when none is configured', async () => {
    const repository = new FakeRepository();
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    expect(await service.getGlobalVideo()).toBeNull();
  });

  it('setGlobalVideo creates then idempotently replaces the single row, never a second one', async () => {
    const repository = new FakeRepository();
    const globalRepo = fakeGlobalMediaRepository();
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      globalRepo,
    );

    const created = await service.setGlobalVideo(globalVideoInput(), principal, null);
    expect(created.title).toBe('NFL Kickoff Special');
    const firstId = created.id;

    const replaced = await service.setGlobalVideo(
      globalVideoInput({ title: 'Replaced Title' }),
      principal,
      null,
    );
    expect(replaced.id).toBe(firstId); // same row, updated in place
    expect(replaced.title).toBe('Replaced Title');
    expect(await service.getGlobalVideo()).toEqual(replaced);
  });

  it('rejects a global video embed host outside the allowlist', async () => {
    const repository = new FakeRepository();
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    await expect(
      service.setGlobalVideo(
        globalVideoInput({ embedUrl: 'https://vimeo.com/embed/global' }),
        principal,
        null,
      ),
    ).rejects.toMatchObject({
      code: 'GAME_CURATED_VIDEO_HOST_NOT_ALLOWED',
    } satisfies Partial<AppError>);
  });

  it('removeGlobalVideo clears the single row and returns the removed record, or null if none existed', async () => {
    const repository = new FakeRepository();
    const globalRepo = fakeGlobalMediaRepository();
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      globalRepo,
    );
    expect(await service.removeGlobalVideo(principal, null)).toBeNull();

    await service.setGlobalVideo(globalVideoInput(), principal, null);
    const removed = await service.removeGlobalVideo(principal, null);
    expect(removed?.title).toBe('NFL Kickoff Special');
    expect(await service.getGlobalVideo()).toBeNull();
  });

  it('GLOBAL only: no curated, no automatic -- displayMode GLOBAL and displayVideos = [G]', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const globalRepo = fakeGlobalMediaRepository(globalVideoInput());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader([], 'UNKNOWN'),
      youtubeHosts,
      globalRepo,
    );

    const media = await service.getPublicGameMedia('game-1');
    expect(media.displayMode).toBe('GLOBAL');
    expect(media.displayVideos).toHaveLength(1);
    expect(media.displayVideos[0]?.mediaType).toBe('GLOBAL');

    const detail = await service.getGameMediaDetail('game-1');
    expect(detail.displayMode).toBe('GLOBAL');
    expect(detail.game.hasGlobalVideo).toBe(true);
  });

  it('AUTOMATIC + GLOBAL: one highlight -- order is [A0, G], displayMode stays AUTOMATIC', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const a0 = automaticHighlight('a0', 'Automatic Highlight');
    const globalRepo = fakeGlobalMediaRepository(globalVideoInput());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader([a0], 'AVAILABLE'),
      youtubeHosts,
      globalRepo,
    );

    const media = await service.getPublicGameMedia('game-1');
    expect(media.displayMode).toBe('AUTOMATIC');
    expect(media.displayVideos.map((item) => item.mediaType)).toEqual(['AUTOMATIC', 'GLOBAL']);
    expect(media.displayVideos.map((item) => item.id)).toEqual(['a0', media.globalVideo?.id]);
  });

  it('multiple automatic + GLOBAL: [A0, A1, A2] + G -> [A0, G, A1, A2]', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const highlights = [
      automaticHighlight('a0', 'First'),
      automaticHighlight('a1', 'Second'),
      automaticHighlight('a2', 'Third'),
    ];
    const globalRepo = fakeGlobalMediaRepository(globalVideoInput());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(highlights, 'AVAILABLE'),
      youtubeHosts,
      globalRepo,
    );

    const media = await service.getPublicGameMedia('game-1');
    expect(media.displayMode).toBe('AUTOMATIC');
    expect(media.displayVideos.map((item) => item.mediaType)).toEqual([
      'AUTOMATIC',
      'GLOBAL',
      'AUTOMATIC',
      'AUTOMATIC',
    ]);
    expect(media.displayVideos.map((item) => item.id)).toEqual([
      'a0',
      media.globalVideo?.id,
      'a1',
      'a2',
    ]);
  });

  it('CURATED + GLOBAL: [C0, C1, C2] + G -> [C0, G, C1, C2], displayMode stays CURATED', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const globalRepo = fakeGlobalMediaRepository(globalVideoInput());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      globalRepo,
    );
    await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/c0' }),
      principal,
      null,
    );
    await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/c1' }),
      principal,
      null,
    );
    await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/c2' }),
      principal,
      null,
    );

    const media = await service.getPublicGameMedia('game-1');
    expect(media.displayMode).toBe('CURATED');
    expect(media.displayVideos.map((item) => item.mediaType)).toEqual([
      'CURATED',
      'GLOBAL',
      'CURATED',
      'CURATED',
    ]);
    const curatedIds = media.curatedVideos.map((v) => v.id);
    expect(media.displayVideos.map((item) => item.id)).toEqual([
      curatedIds[0],
      media.globalVideo?.id,
      curatedIds[1],
      curatedIds[2],
    ]);
  });

  it('four curated (the per-game max) + GLOBAL: five display entries, global never consumes a curated slot', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const globalRepo = fakeGlobalMediaRepository(globalVideoInput());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      globalRepo,
    );
    for (let i = 0; i < MAX_CURATED_VIDEOS_PER_GAME; i += 1) {
      await service.addVideo(
        'game-1',
        video({ embedUrl: `https://www.youtube.com/embed/c${String(i)}` }),
        principal,
        null,
      );
    }

    const detail = await service.getGameMediaDetail('game-1');
    expect(detail.curatedVideos).toHaveLength(MAX_CURATED_VIDEOS_PER_GAME); // limit unaffected by global

    const media = await service.getPublicGameMedia('game-1');
    expect(media.displayVideos).toHaveLength(MAX_CURATED_VIDEOS_PER_GAME + 1);
    expect(media.displayVideos.map((item) => item.mediaType)).toEqual([
      'CURATED',
      'GLOBAL',
      'CURATED',
      'CURATED',
      'CURATED',
    ]);
  });

  it('removing the global video reverts display to what it was before, with no game rows touched', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const globalRepo = fakeGlobalMediaRepository();
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader(),
      youtubeHosts,
      globalRepo,
    );
    await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/c0' }),
      principal,
      null,
    );
    await service.addVideo(
      'game-1',
      video({ embedUrl: 'https://www.youtube.com/embed/c1' }),
      principal,
      null,
    );
    await service.setGlobalVideo(globalVideoInput(), principal, null);

    const before = await service.getPublicGameMedia('game-1');
    expect(before.displayVideos.map((item) => item.mediaType)).toEqual([
      'CURATED',
      'GLOBAL',
      'CURATED',
    ]);

    await service.removeGlobalVideo(principal, null);
    const after = await service.getPublicGameMedia('game-1');
    expect(after.displayVideos.map((item) => item.mediaType)).toEqual(['CURATED', 'CURATED']);
    expect(after.curatedVideos).toHaveLength(2); // unchanged -- no curated rows were touched
    expect(after.displayMode).toBe('CURATED');
  });

  it('does not exist -> NONE remains NONE (no global, no curated, no automatic)', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader([], 'UNKNOWN'),
      youtubeHosts,
      fakeGlobalMediaRepository(),
    );
    const media = await service.getPublicGameMedia('game-1');
    expect(media.displayMode).toBe('NONE');
    expect(media.displayVideos).toEqual([]);
  });

  it('preserves existing curated/automatic state -- adding a global video never touches GameCuratedVideo or highlight counts', async () => {
    const repository = new FakeRepository();
    repository.gamesById.set('game-1', fakeGame());
    repository.highlightCountByGame.set('game-1', 1);
    const globalRepo = fakeGlobalMediaRepository();
    const service = new GameMediaCurationService(
      repository,
      fakeHighlightsReader([automaticHighlight('a0', 'Automatic')], 'AVAILABLE'),
      youtubeHosts,
      globalRepo,
    );
    await service.addVideo('game-1', video(), principal, null);
    const before = repository.videosByGame.get('game-1');

    await service.setGlobalVideo(globalVideoInput(), principal, null);
    await service.removeGlobalVideo(principal, null);

    expect(repository.videosByGame.get('game-1')).toEqual(before);
    expect(repository.highlightCountByGame.get('game-1')).toBe(1);
  });
});

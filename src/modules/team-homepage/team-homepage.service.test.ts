import { describe, expect, it, vi } from 'vitest';
import type { ArticleRecord, PublicArticleListDto } from '../articles/article.dto.js';
import type { PublicArticleReader } from '../articles/article.service.js';
import type {
  DisplayMediaItemDto,
  PublicGameMediaDto,
} from '../game-media-curation/game-media-curation.dto.js';
import type {
  TeamHomepageConfigRecord,
  TeamHomepageHighlightPlacementRecord,
  TeamHomepageHighlightSettingsRecord,
  TeamHomepageMediaSourceType,
  TeamHomepagePlacementRecord,
} from './team-homepage.dto.js';
import type {
  TeamHomepageArticleCandidateRecord,
  TeamHomepageGameContext,
  TeamHomepageMediaCandidateRecord,
  TeamHomepageRepository,
} from './team-homepage.repository.js';
import { TeamHomepageService } from './team-homepage.service.js';

const TEAM = '11111111-1111-4111-8111-111111111111';
const OTHER_TEAM = '22222222-2222-4222-8222-222222222222';
const GAME = '33333333-3333-4333-8333-333333333333';
const VIDEO = '44444444-4444-4444-8444-444444444444';
const VIDEO_TWO = '55555555-5555-4555-8555-555555555555';
const ACTOR = {
  userId: '66666666-6666-4666-8666-666666666666',
  email: 'editor@example.com',
  role: 'EDITOR' as const,
};

class FakeRepository implements TeamHomepageRepository {
  activeTeams = new Set([TEAM, OTHER_TEAM]);
  config: TeamHomepageConfigRecord | null = null;
  editorial: TeamHomepagePlacementRecord[] = [];
  highlights: TeamHomepageHighlightPlacementRecord[] = [];
  settings: TeamHomepageHighlightSettingsRecord = { displayLimit: 5, fillWithAutomatic: true };
  media: TeamHomepageMediaCandidateRecord[] = [];
  games: TeamHomepageGameContext[] = [{ id: GAME, startTime: new Date('2026-08-01T00:00:00Z') }];

  isActiveTeam(teamId: string): Promise<boolean> {
    return Promise.resolve(this.activeTeams.has(teamId));
  }
  getConfig(): Promise<TeamHomepageConfigRecord | null> {
    return Promise.resolve(this.config);
  }
  updateConfig(
    _teamId: string,
    input: { imageUrl?: string | null; focalX?: number; focalY?: number; overlayOpacity?: number },
  ): Promise<TeamHomepageConfigRecord> {
    this.config = {
      bannerImageUrl:
        input.imageUrl === undefined ? (this.config?.bannerImageUrl ?? null) : input.imageUrl,
      bannerFocalX: input.focalX ?? this.config?.bannerFocalX ?? 50,
      bannerFocalY: input.focalY ?? this.config?.bannerFocalY ?? 50,
      bannerOverlayOpacity: input.overlayOpacity ?? this.config?.bannerOverlayOpacity ?? 35,
    };
    return Promise.resolve(this.config);
  }
  listEditorialPlacements(teamId: string): Promise<readonly TeamHomepagePlacementRecord[]> {
    return Promise.resolve(this.editorial.filter((row) => row.teamId === teamId));
  }
  createEditorialPlacement(
    input: Omit<TeamHomepagePlacementRecord, 'id' | 'position' | 'createdAt' | 'updatedAt'>,
  ): Promise<TeamHomepagePlacementRecord> {
    if (input.isLeadReplacement)
      this.editorial = this.editorial.map((row) =>
        row.teamId === input.teamId ? { ...row, isLeadReplacement: false } : row,
      );
    const row = editorial({ ...input, id: crypto.randomUUID(), position: this.editorial.length });
    this.editorial.push(row);
    return Promise.resolve(row);
  }
  updateEditorialLead(
    teamId: string,
    placementId: string,
    value: boolean,
  ): Promise<TeamHomepagePlacementRecord | null> {
    const found = this.editorial.find((row) => row.teamId === teamId && row.id === placementId);
    if (found === undefined) return Promise.resolve(null);
    if (value)
      this.editorial = this.editorial.map((row) =>
        row.teamId === teamId ? { ...row, isLeadReplacement: row.id === placementId } : row,
      );
    else
      this.editorial = this.editorial.map((row) =>
        row.id === placementId ? { ...row, isLeadReplacement: false } : row,
      );
    return Promise.resolve(this.editorial.find((row) => row.id === placementId) ?? null);
  }
  deleteEditorialPlacement(
    teamId: string,
    placementId: string,
  ): Promise<TeamHomepagePlacementRecord | null> {
    const row =
      this.editorial.find((item) => item.teamId === teamId && item.id === placementId) ?? null;
    this.editorial = this.editorial.filter((item) => item !== row);
    return Promise.resolve(row);
  }
  reorderEditorialPlacements(
    teamId: string,
    ids: readonly string[],
  ): Promise<readonly TeamHomepagePlacementRecord[]> {
    this.editorial = ids.map((id, position) => ({
      ...required(this.editorial.find((row) => row.id === id)),
      position,
    }));
    return this.listEditorialPlacements(teamId);
  }
  findArticleCandidate(): Promise<TeamHomepageArticleCandidateRecord | null> {
    return Promise.resolve({
      id: '77777777-7777-4777-8777-777777777777',
      title: 'Article',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      updatedAt: new Date(),
    });
  }
  findPublicArticle(): Promise<ArticleRecord | null> {
    return Promise.resolve(null);
  }
  listArticleCandidates(): Promise<readonly TeamHomepageArticleCandidateRecord[]> {
    return Promise.resolve([]);
  }
  findMediaCandidate(
    teamId: string,
    type: TeamHomepageMediaSourceType,
    id: string,
  ): Promise<TeamHomepageMediaCandidateRecord | null> {
    return Promise.resolve(
      this.media.find(
        (row) => row.sourceType === type && row.sourceId === id && this.activeTeams.has(teamId),
      ) ?? null,
    );
  }
  listMediaCandidates(): Promise<readonly TeamHomepageMediaCandidateRecord[]> {
    return Promise.resolve(this.media);
  }
  listHighlightPlacements(
    teamId: string,
  ): Promise<readonly TeamHomepageHighlightPlacementRecord[]> {
    return Promise.resolve(this.highlights.filter((row) => row.teamId === teamId));
  }
  createHighlightPlacement(
    teamId: string,
    source: TeamHomepageMediaCandidateRecord,
  ): Promise<TeamHomepageHighlightPlacementRecord> {
    const row = highlight({
      teamId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      gameId: source.gameId,
      position: this.highlights.length,
    });
    this.highlights.push(row);
    return Promise.resolve(row);
  }
  deleteHighlightPlacement(
    teamId: string,
    placementId: string,
  ): Promise<TeamHomepageHighlightPlacementRecord | null> {
    const row =
      this.highlights.find((item) => item.teamId === teamId && item.id === placementId) ?? null;
    this.highlights = this.highlights.filter((item) => item !== row);
    return Promise.resolve(row);
  }
  reorderHighlightPlacements(
    teamId: string,
    ids: readonly string[],
  ): Promise<readonly TeamHomepageHighlightPlacementRecord[]> {
    this.highlights = ids.map((id, position) => ({
      ...required(this.highlights.find((row) => row.id === id)),
      position,
    }));
    return this.listHighlightPlacements(teamId);
  }
  getHighlightSettings(): Promise<TeamHomepageHighlightSettingsRecord> {
    return Promise.resolve(this.settings);
  }
  updateHighlightSettings(
    _teamId: string,
    input: TeamHomepageHighlightSettingsRecord,
  ): Promise<TeamHomepageHighlightSettingsRecord> {
    this.settings = input;
    return Promise.resolve(input);
  }
  listRecentMediaGames(
    _teamId: string,
    limit: number,
  ): Promise<readonly TeamHomepageGameContext[]> {
    return Promise.resolve(this.games.slice(0, limit));
  }
  findGamesByIds(ids: readonly string[]): Promise<readonly TeamHomepageGameContext[]> {
    return Promise.resolve(this.games.filter((row) => ids.includes(row.id)));
  }
}

function build(repository = new FakeRepository(), fallback = [article('a1'), article('a2')]) {
  const mediaByGame = new Map<string, PublicGameMediaDto>();
  const articles: PublicArticleReader = {
    list: vi.fn(),
    listFeatured: vi.fn(),
    getBySlug: vi.fn(),
    listForTeam: vi.fn().mockResolvedValue({ articles: fallback, nextCursor: null }),
  };
  const gameMedia = {
    getPublicGameMedia: vi.fn((gameId: string) =>
      Promise.resolve(mediaByGame.get(gameId) ?? gameMediaDto(gameId, [])),
    ),
  };
  return {
    repository,
    mediaByGame,
    articles,
    gameMedia,
    service: new TeamHomepageService({
      repository,
      articles,
      gameMedia,
      now: () => new Date('2026-08-28T00:00:00Z'),
    }),
  };
}

describe('TeamHomepageService public composition', () => {
  it('returns banner defaults and the newest safe team article as the default lead', async () => {
    const { service } = build();
    const result = await service.getPublicHomepage(TEAM);
    expect(result.banner).toEqual({ imageUrl: null, focalX: 50, focalY: 50, overlayOpacity: 35 });
    expect(result.editorial.featuredItem).toMatchObject({ type: 'ARTICLE', article: { id: 'a1' } });
    expect(result.editorial.supportingItems).toHaveLength(1);
  });

  it('returns a custom banner and restores the fallback after an explicit clear', async () => {
    const repository = new FakeRepository();
    const { service } = build(repository);
    await service.updateBanner(
      TEAM,
      {
        imageUrl: 'https://res.cloudinary.com/example/team.jpg',
        focalX: 25,
        focalY: 70,
        overlayOpacity: 40,
      },
      ACTOR,
      null,
    );
    expect((await service.getPublicHomepage(TEAM)).banner).toEqual({
      imageUrl: 'https://res.cloudinary.com/example/team.jpg',
      focalX: 25,
      focalY: 70,
      overlayOpacity: 40,
    });
    await service.updateBanner(TEAM, { imageUrl: null }, ACTOR, null);
    expect((await service.getPublicHomepage(TEAM)).banner.imageUrl).toBeNull();
  });

  it('uses one valid lead replacement video while leaving ordinary videos supporting', async () => {
    const repository = new FakeRepository();
    repository.editorial = [
      editorial({
        sourceId: VIDEO,
        gameId: GAME,
        mediaSourceType: 'CURATED_GAME_VIDEO',
        isLeadReplacement: true,
      }),
      editorial({
        id: crypto.randomUUID(),
        sourceId: VIDEO_TWO,
        gameId: GAME,
        mediaSourceType: 'GAME_HIGHLIGHT',
        position: 1,
      }),
    ];
    const context = build(repository);
    context.mediaByGame.set(GAME, gameMediaDto(GAME, [video(VIDEO), video(VIDEO_TWO)]));
    const result = await context.service.getPublicHomepage(TEAM);
    expect(result.editorial.featuredItem).toMatchObject({ type: 'VIDEO', id: VIDEO });
    expect(result.editorial.supportingItems.map(itemId)).toEqual([VIDEO_TWO, 'a1', 'a2']);
  });

  it('falls back to the lead article when a replacement video becomes stale', async () => {
    const repository = new FakeRepository();
    repository.editorial = [
      editorial({
        sourceId: VIDEO,
        gameId: GAME,
        mediaSourceType: 'CURATED_GAME_VIDEO',
        isLeadReplacement: true,
      }),
    ];
    const { service } = build(repository);
    expect((await service.getPublicHomepage(TEAM)).editorial.featuredItem).toMatchObject({
      type: 'ARTICLE',
      article: { id: 'a1' },
    });
  });

  it('keeps supporting video order deterministic and removes duplicate fallback articles', async () => {
    const repository = new FakeRepository();
    repository.editorial = [
      editorial({ sourceId: VIDEO, gameId: GAME, mediaSourceType: 'CURATED_GAME_VIDEO' }),
      editorial({
        id: crypto.randomUUID(),
        sourceId: VIDEO_TWO,
        gameId: GAME,
        mediaSourceType: 'GAME_HIGHLIGHT',
        position: 1,
      }),
    ];
    const context = build(repository, [article('a1'), article('a1'), article('a2')]);
    context.mediaByGame.set(GAME, gameMediaDto(GAME, [video(VIDEO), video(VIDEO_TWO)]));
    expect(
      (await context.service.getPublicHomepage(TEAM)).editorial.supportingItems.map(itemId),
    ).toEqual([VIDEO, VIDEO_TWO, 'a2']);
  });

  it('preserves canEmbed and canonical fallback from displayVideos', async () => {
    const repository = new FakeRepository();
    repository.editorial = [
      editorial({
        sourceId: VIDEO,
        gameId: GAME,
        mediaSourceType: 'GAME_HIGHLIGHT',
        isLeadReplacement: true,
      }),
    ];
    const context = build(repository);
    context.mediaByGame.set(GAME, gameMediaDto(GAME, [video(VIDEO, false)]));
    expect((await context.service.getPublicHomepage(TEAM)).editorial.featuredItem).toMatchObject({
      canEmbed: false,
      embedUrl: null,
      canonicalUrl: 'https://example.com/watch',
    });
  });
});

describe('TeamHomepageService highlight curation', () => {
  it.each([3, 5, 10])('honors a display limit of %i with curated items first', async (limit) => {
    const repository = new FakeRepository();
    repository.settings = { displayLimit: limit, fillWithAutomatic: true };
    repository.games = Array.from({ length: 12 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      startTime: new Date(2026, 0, index + 1),
    }));
    const context = build(repository);
    for (const game of repository.games)
      context.mediaByGame.set(game.id, gameMediaDto(game.id, [video(crypto.randomUUID())]));
    const result = await context.service.getPublicHomepage(TEAM);
    expect(result.highlights).toHaveLength(limit);
  });

  it('returns curated-only when automatic fill is disabled and skips stale curated media', async () => {
    const repository = new FakeRepository();
    repository.settings = { displayLimit: 5, fillWithAutomatic: false };
    repository.highlights = [highlight({ sourceId: VIDEO, gameId: GAME })];
    expect((await build(repository).service.getPublicHomepage(TEAM)).highlights).toEqual([]);
  });

  it('fills one recent eligible item per game and excludes a global video', async () => {
    const repository = new FakeRepository();
    repository.settings = { displayLimit: 3, fillWithAutomatic: true };
    const context = build(repository);
    context.mediaByGame.set(
      GAME,
      gameMediaDto(GAME, [{ ...video(crypto.randomUUID()), mediaType: 'GLOBAL' }, video(VIDEO)]),
    );
    expect((await context.service.getPublicHomepage(TEAM)).highlights.map(({ id }) => id)).toEqual([
      VIDEO,
    ]);
  });
});

describe('TeamHomepageService admin invariants', () => {
  it('atomically replaces the previous lead selection in the repository contract', async () => {
    const repository = new FakeRepository();
    repository.media = [media(VIDEO), media(VIDEO_TWO)];
    const { service } = build(repository);
    await service.addEditorial(
      TEAM,
      {
        sourceType: 'VIDEO',
        sourceId: VIDEO,
        mediaSourceType: 'CURATED_GAME_VIDEO',
        isLeadReplacement: true,
      },
      ACTOR,
      null,
    );
    await service.addEditorial(
      TEAM,
      {
        sourceType: 'VIDEO',
        sourceId: VIDEO_TWO,
        mediaSourceType: 'CURATED_GAME_VIDEO',
        isLeadReplacement: true,
      },
      ACTOR,
      null,
    );
    expect(
      repository.editorial
        .filter(({ isLeadReplacement }) => isLeadReplacement)
        .map(({ sourceId }) => sourceId),
    ).toEqual([VIDEO_TWO]);
  });

  it('rejects duplicate editorial and highlight placements', async () => {
    const repository = new FakeRepository();
    repository.media = [media(VIDEO)];
    const { service } = build(repository);
    await service.addEditorial(
      TEAM,
      {
        sourceType: 'VIDEO',
        sourceId: VIDEO,
        mediaSourceType: 'CURATED_GAME_VIDEO',
        isLeadReplacement: false,
      },
      ACTOR,
      null,
    );
    await expect(
      service.addEditorial(
        TEAM,
        {
          sourceType: 'VIDEO',
          sourceId: VIDEO,
          mediaSourceType: 'CURATED_GAME_VIDEO',
          isLeadReplacement: false,
        },
        ACTOR,
        null,
      ),
    ).rejects.toMatchObject({ code: 'TEAM_HOMEPAGE_EDITORIAL_DUPLICATE' });
    await service.addHighlight(
      TEAM,
      { sourceType: 'CURATED_GAME_VIDEO', sourceId: VIDEO },
      ACTOR,
      null,
    );
    await expect(
      service.addHighlight(
        TEAM,
        { sourceType: 'CURATED_GAME_VIDEO', sourceId: VIDEO },
        ACTOR,
        null,
      ),
    ).rejects.toMatchObject({ code: 'TEAM_HOMEPAGE_HIGHLIGHT_DUPLICATE' });
  });

  it('rejects unrelated-team media and non-exact reorder requests', async () => {
    const repository = new FakeRepository();
    const { service } = build(repository);
    await expect(
      service.addHighlight(
        TEAM,
        { sourceType: 'CURATED_GAME_VIDEO', sourceId: VIDEO },
        ACTOR,
        null,
      ),
    ).rejects.toMatchObject({ code: 'TEAM_HOMEPAGE_MEDIA_NOT_FOUND' });
    repository.highlights = [highlight({ sourceId: VIDEO })];
    await expect(
      service.reorderHighlights(TEAM, { placementIds: [] }, ACTOR, null),
    ).rejects.toMatchObject({ code: 'TEAM_HOMEPAGE_HIGHLIGHT_REORDER_MISMATCH' });
  });

  it('reorders the exact current highlight set deterministically', async () => {
    const repository = new FakeRepository();
    const first = highlight({ sourceId: VIDEO, position: 0 });
    const second = highlight({ sourceId: VIDEO_TWO, position: 1 });
    repository.highlights = [first, second];
    const { service } = build(repository);
    await service.reorderHighlights(TEAM, { placementIds: [second.id, first.id] }, ACTOR, null);
    expect(repository.highlights.map(({ sourceId, position }) => ({ sourceId, position }))).toEqual(
      [
        { sourceId: VIDEO_TWO, position: 0 },
        { sourceId: VIDEO, position: 1 },
      ],
    );
  });
});

function article(id: string): PublicArticleListDto {
  return {
    id,
    slug: id,
    type: 'ORIGINAL',
    title: id,
    summary: null,
    contentType: 'ARTICLE',
    mediaThumbnailUrl: null,
    sourceName: null,
    sourceUrl: null,
    sourcePublishedAt: null,
    sourceIsOfficialTeam: false,
    heroImageUrl: null,
    heroImageAlt: null,
    isFeatured: false,
    publishedAt: '2026-08-01T00:00:00.000Z',
    teams: [],
  };
}
function editorial(
  overrides: Partial<TeamHomepagePlacementRecord> = {},
): TeamHomepagePlacementRecord {
  return {
    id: crypto.randomUUID(),
    teamId: TEAM,
    sourceType: 'VIDEO',
    sourceId: VIDEO,
    mediaSourceType: 'CURATED_GAME_VIDEO',
    gameId: GAME,
    position: 0,
    isLeadReplacement: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
function highlight(
  overrides: Partial<TeamHomepageHighlightPlacementRecord> = {},
): TeamHomepageHighlightPlacementRecord {
  return {
    id: crypto.randomUUID(),
    teamId: TEAM,
    sourceType: 'CURATED_GAME_VIDEO',
    sourceId: VIDEO,
    gameId: GAME,
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
function media(id: string): TeamHomepageMediaCandidateRecord {
  return {
    sourceType: 'CURATED_GAME_VIDEO',
    sourceId: id,
    gameId: GAME,
    title: id,
    thumbnailUrl: null,
    canonicalUrl: 'https://example.com/watch',
    embedUrl: 'https://www.youtube.com/embed/example',
    canEmbed: true,
    publishedAt: new Date(),
  };
}
function video(id: string, canEmbed = true): DisplayMediaItemDto {
  return {
    id,
    mediaType: 'CURATED',
    title: id,
    embedUrl: 'https://www.youtube.com/embed/example',
    canonicalUrl: 'https://example.com/watch',
    thumbnailUrl: null,
    sourceLabel: null,
    canEmbed,
  };
}
function gameMediaDto(
  gameId: string,
  displayVideos: readonly DisplayMediaItemDto[],
): PublicGameMediaDto {
  return {
    gameId,
    displayMode: displayVideos.length === 0 ? 'NONE' : 'CURATED',
    curatedVideos: [],
    highlights: [],
    globalVideo: null,
    displayVideos,
    coverage: 'AVAILABLE',
  };
}
function itemId(
  item: Awaited<
    ReturnType<TeamHomepageService['getPublicHomepage']>
  >['editorial']['supportingItems'][number],
): string {
  return item.type === 'ARTICLE' ? item.article.id : item.id;
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected fixture row.');
  return value;
}

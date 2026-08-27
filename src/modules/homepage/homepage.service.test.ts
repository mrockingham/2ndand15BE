import { describe, expect, it, vi } from 'vitest';

import type { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import type { ArticleRecord } from '../articles/article.dto.js';
import type { PublicGameMediaDto } from '../game-media-curation/game-media-curation.dto.js';
import type { GameWithTeams } from '../games/game.dto.js';
import type { AiHubWeeklyInsightsService } from '../ai-hub/weekly-insights.service.js';
import type { InsightCard } from '../ai-hub/weekly-insights.js';
import {
  HomepageService,
  type HomepageGameMediaReader,
  type HomepageStatsReader,
} from './homepage.service.js';
import type { CreateHeroSlideInput, UpdateHeroSlideInput } from './homepage.schemas.js';
import {
  MAX_HERO_SLIDES,
  MAX_HOMEPAGE_HIGHLIGHT_PLACEMENTS,
  MAX_TOP_STORIES,
  updateHighlightSettingsSchema,
} from './homepage.schemas.js';
import type {
  HomepageCurrentWeekContext,
  HomepageHeroSlideRecord,
  HomepageHighlightCandidateListResult,
  HomepageHighlightPlacementRecord,
  HomepageHighlightSettingsRecord,
  HomepageHighlightSourceTypeValue,
  HomepageRepository,
  HomepageTopStoryRecord,
} from './homepage.repository.js';
import { AppError as AppErrorClass } from '../../common/errors/app-error.js';

const principal: AdministrativePrincipal = {
  userId: 'user-1',
  email: 'editor@example.test',
  role: 'EDITOR',
};

function createInput(overrides: Partial<CreateHeroSlideInput> = {}): CreateHeroSlideInput {
  return {
    isActive: true,
    imageUrl: 'https://example.test/hero.jpg',
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
    ...overrides,
  };
}

class FakeHomepageRepository implements HomepageRepository {
  slides: HomepageHeroSlideRecord[] = [];
  topStories: HomepageTopStoryRecord[] = [];
  articlesById = new Map<string, ArticleRecord>();
  publicArticleIds = new Set<string>();
  gamesWithMedia: GameWithTeams[] = [];
  // M37A: Homepage highlight curation
  placements: HomepageHighlightPlacementRecord[] = [];
  highlightSettings: HomepageHighlightSettingsRecord | null = null;
  gameHighlightSources = new Map<string, { readonly gameId: string }>();
  curatedVideoSources = new Map<string, { readonly gameId: string }>();
  gamesById = new Map<string, GameWithTeams>();
  highlightCandidates: HomepageHighlightCandidateListResult = { candidates: [], nextCursor: null };
  currentWeekContext: HomepageCurrentWeekContext | null = null;
  private nextId = 1;

  listHeroSlides(): Promise<readonly HomepageHeroSlideRecord[]> {
    return Promise.resolve([...this.slides].sort((a, b) => a.position - b.position));
  }

  listActiveHeroSlides(): Promise<readonly HomepageHeroSlideRecord[]> {
    return Promise.resolve(
      this.slides.filter((s) => s.isActive).sort((a, b) => a.position - b.position),
    );
  }

  findHeroSlide(slideId: string): Promise<HomepageHeroSlideRecord | null> {
    return Promise.resolve(this.slides.find((s) => s.id === slideId) ?? null);
  }

  createHeroSlide(input: CreateHeroSlideInput): Promise<HomepageHeroSlideRecord> {
    if (this.slides.length >= MAX_HERO_SLIDES) {
      return Promise.reject(
        new AppErrorClass({
          code: 'HOMEPAGE_HERO_SLIDE_LIMIT_REACHED',
          message: 'limit reached',
          statusCode: 409,
        }),
      );
    }
    const now = new Date();
    const record: HomepageHeroSlideRecord = {
      id: `slide-${String(this.nextId++)}`,
      position: this.slides.length,
      isActive: input.isActive,
      imageUrl: input.imageUrl,
      imageAlt: input.imageAlt,
      imageBrightness: input.imageBrightness,
      imageContrast: input.imageContrast,
      imageSaturation: input.imageSaturation,
      overlayOpacity: input.overlayOpacity,
      focalPointX: input.focalPointX,
      focalPointY: input.focalPointY,
      imageScale: input.imageScale,
      createdAt: now,
      updatedAt: now,
      contentBlocks: input.contentBlocks.map((block, i) => ({
        id: `block-${String(i)}`,
        slot: block.slot,
        content: block.content,
      })),
      ctas: input.ctas.map((cta, i) => ({ id: `cta-${String(i)}`, position: i, ...cta })),
    };
    this.slides.push(record);
    return Promise.resolve(record);
  }

  updateHeroSlide(slideId: string, input: UpdateHeroSlideInput): Promise<HomepageHeroSlideRecord> {
    const index = this.slides.findIndex((s) => s.id === slideId);
    if (index === -1) return Promise.reject(new Error('not found'));
    const existing = this.slides[index];
    if (existing === undefined) return Promise.reject(new Error('not found'));
    const updated: HomepageHeroSlideRecord = {
      ...existing,
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
      ...(input.imageAlt === undefined ? {} : { imageAlt: input.imageAlt }),
      ...(input.imageBrightness === undefined ? {} : { imageBrightness: input.imageBrightness }),
      ...(input.contentBlocks === undefined
        ? {}
        : {
            contentBlocks: input.contentBlocks.map((block, i) => ({
              id: `block-${String(i)}`,
              slot: block.slot,
              content: block.content,
            })),
          }),
      ...(input.ctas === undefined
        ? {}
        : { ctas: input.ctas.map((cta, i) => ({ id: `cta-${String(i)}`, position: i, ...cta })) }),
      updatedAt: new Date(),
    };
    this.slides[index] = updated;
    return Promise.resolve(updated);
  }

  deleteHeroSlide(slideId: string): Promise<HomepageHeroSlideRecord> {
    const index = this.slides.findIndex((s) => s.id === slideId);
    if (index === -1) return Promise.reject(new Error('not found'));
    const [deleted] = this.slides.splice(index, 1);
    if (deleted === undefined) return Promise.reject(new Error('not found'));
    this.slides = this.slides
      .sort((a, b) => a.position - b.position)
      .map((slide, i) => ({ ...slide, position: i }));
    return Promise.resolve(deleted);
  }

  reorderHeroSlides(slideIds: readonly string[]): Promise<readonly HomepageHeroSlideRecord[]> {
    const existingIds = new Set(this.slides.map((s) => s.id));
    const providedIds = new Set(slideIds);
    const isExactMatch =
      slideIds.length === this.slides.length &&
      providedIds.size === slideIds.length &&
      [...existingIds].every((id) => providedIds.has(id));
    if (!isExactMatch) {
      return Promise.reject(
        new AppErrorClass({
          code: 'HOMEPAGE_HERO_SLIDE_REORDER_MISMATCH',
          message: 'mismatch',
          statusCode: 422,
        }),
      );
    }
    this.slides = slideIds.map((id, position) => {
      const slide = this.slides.find((s) => s.id === id);
      if (slide === undefined) throw new Error('unreachable');
      return { ...slide, position };
    });
    return Promise.resolve([...this.slides]);
  }

  listTopStories(): Promise<readonly HomepageTopStoryRecord[]> {
    return Promise.resolve([...this.topStories].sort((a, b) => a.position - b.position));
  }

  findTopStory(articleId: string): Promise<HomepageTopStoryRecord | null> {
    return Promise.resolve(this.topStories.find((t) => t.articleId === articleId) ?? null);
  }

  addTopStory(articleId: string): Promise<HomepageTopStoryRecord> {
    const existing = this.topStories.find((t) => t.articleId === articleId);
    if (existing !== undefined) return Promise.resolve(existing);
    if (this.topStories.length >= MAX_TOP_STORIES) {
      return Promise.reject(
        new AppErrorClass({
          code: 'HOMEPAGE_TOP_STORY_LIMIT_REACHED',
          message: 'limit reached',
          statusCode: 409,
        }),
      );
    }
    const now = new Date();
    const record: HomepageTopStoryRecord = {
      id: `top-story-${String(this.nextId++)}`,
      articleId,
      position: this.topStories.length,
      createdAt: now,
      updatedAt: now,
    };
    this.topStories.push(record);
    return Promise.resolve(record);
  }

  removeTopStory(articleId: string): Promise<HomepageTopStoryRecord | null> {
    const index = this.topStories.findIndex((t) => t.articleId === articleId);
    if (index === -1) return Promise.resolve(null);
    const [removed] = this.topStories.splice(index, 1);
    this.topStories.forEach((story, i) => {
      this.topStories[i] = { ...story, position: i };
    });
    return Promise.resolve(removed ?? null);
  }

  reorderTopStories(articleIds: readonly string[]): Promise<readonly HomepageTopStoryRecord[]> {
    const existingIds = new Set(this.topStories.map((t) => t.articleId));
    const providedIds = new Set(articleIds);
    const isExactMatch =
      articleIds.length === this.topStories.length &&
      providedIds.size === articleIds.length &&
      [...existingIds].every((id) => providedIds.has(id));
    if (!isExactMatch) {
      return Promise.reject(
        new AppErrorClass({
          code: 'HOMEPAGE_TOP_STORY_REORDER_MISMATCH',
          message: 'mismatch',
          statusCode: 422,
        }),
      );
    }
    this.topStories = articleIds.map((articleId, position) => {
      const story = this.topStories.find((t) => t.articleId === articleId);
      if (story === undefined) throw new Error('unreachable');
      return { ...story, position };
    });
    return Promise.resolve([...this.topStories]);
  }

  findArticlesByIds(articleIds: readonly string[]): Promise<readonly ArticleRecord[]> {
    return Promise.resolve(
      articleIds
        .map((id) => this.articlesById.get(id))
        .filter((a): a is ArticleRecord => a !== undefined),
    );
  }

  findPublicArticlesByIds(articleIds: readonly string[]): Promise<readonly ArticleRecord[]> {
    return Promise.resolve(
      articleIds
        .filter((id) => this.publicArticleIds.has(id))
        .map((id) => this.articlesById.get(id))
        .filter((a): a is ArticleRecord => a !== undefined),
    );
  }

  findRecentGamesWithMedia(limit: number): Promise<readonly GameWithTeams[]> {
    return Promise.resolve(this.gamesWithMedia.slice(0, limit));
  }

  // -- M37A: Homepage highlight curation ------------------------------------

  listActiveHighlightPlacements(): Promise<readonly HomepageHighlightPlacementRecord[]> {
    return Promise.resolve([...this.placements].sort((a, b) => a.position - b.position));
  }

  findHighlightPlacement(placementId: string): Promise<HomepageHighlightPlacementRecord | null> {
    return Promise.resolve(this.placements.find((p) => p.id === placementId) ?? null);
  }

  findHighlightPlacementBySource(
    sourceType: HomepageHighlightSourceTypeValue,
    sourceId: string,
  ): Promise<HomepageHighlightPlacementRecord | null> {
    return Promise.resolve(
      this.placements.find((p) => p.sourceType === sourceType && p.sourceId === sourceId) ?? null,
    );
  }

  createHighlightPlacement(input: {
    sourceType: HomepageHighlightSourceTypeValue;
    sourceId: string;
    gameId: string;
  }): Promise<HomepageHighlightPlacementRecord> {
    if (this.placements.length >= MAX_HOMEPAGE_HIGHLIGHT_PLACEMENTS) {
      return Promise.reject(
        new AppErrorClass({
          code: 'HOMEPAGE_HIGHLIGHT_LIMIT_REACHED',
          message: 'limit reached',
          statusCode: 409,
        }),
      );
    }
    const existing = this.placements.find(
      (p) => p.sourceType === input.sourceType && p.sourceId === input.sourceId,
    );
    if (existing !== undefined) {
      return Promise.reject(
        new AppErrorClass({
          code: 'HOMEPAGE_HIGHLIGHT_DUPLICATE',
          message: 'duplicate',
          statusCode: 409,
        }),
      );
    }
    const now = new Date();
    const record: HomepageHighlightPlacementRecord = {
      id: `placement-${String(this.nextId++)}`,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      gameId: input.gameId,
      position: this.placements.length,
      createdAt: now,
      updatedAt: now,
    };
    this.placements.push(record);
    return Promise.resolve(record);
  }

  deleteHighlightPlacement(placementId: string): Promise<HomepageHighlightPlacementRecord | null> {
    const index = this.placements.findIndex((p) => p.id === placementId);
    if (index === -1) return Promise.resolve(null);
    const [deleted] = this.placements.splice(index, 1);
    this.placements = this.placements
      .sort((a, b) => a.position - b.position)
      .map((placement, i) => ({ ...placement, position: i }));
    return Promise.resolve(deleted ?? null);
  }

  reorderHighlightPlacements(
    placementIds: readonly string[],
  ): Promise<readonly HomepageHighlightPlacementRecord[]> {
    const existingIds = new Set(this.placements.map((p) => p.id));
    const providedIds = new Set(placementIds);
    const isExactMatch =
      placementIds.length === this.placements.length &&
      providedIds.size === placementIds.length &&
      [...existingIds].every((id) => providedIds.has(id));
    if (!isExactMatch) {
      return Promise.reject(
        new AppErrorClass({
          code: 'HOMEPAGE_HIGHLIGHT_REORDER_MISMATCH',
          message: 'mismatch',
          statusCode: 422,
        }),
      );
    }
    this.placements = placementIds.map((id, position) => {
      const placement = this.placements.find((p) => p.id === id);
      if (placement === undefined) throw new Error('unreachable');
      return { ...placement, position };
    });
    return Promise.resolve([...this.placements]);
  }

  getHighlightSettings(): Promise<HomepageHighlightSettingsRecord> {
    return Promise.resolve(this.highlightSettings ?? { displayLimit: 5, fillWithAutomatic: true });
  }

  updateHighlightSettings(input: {
    displayLimit?: number;
    fillWithAutomatic?: boolean;
  }): Promise<HomepageHighlightSettingsRecord> {
    const before = this.highlightSettings ?? { displayLimit: 5, fillWithAutomatic: true };
    this.highlightSettings = {
      displayLimit: input.displayLimit ?? before.displayLimit,
      fillWithAutomatic: input.fillWithAutomatic ?? before.fillWithAutomatic,
    };
    return Promise.resolve(this.highlightSettings);
  }

  findGameHighlightSource(id: string): Promise<{ readonly gameId: string } | null> {
    return Promise.resolve(this.gameHighlightSources.get(id) ?? null);
  }

  findCuratedVideoSource(id: string): Promise<{ readonly gameId: string } | null> {
    return Promise.resolve(this.curatedVideoSources.get(id) ?? null);
  }

  findGamesWithTeamsByIds(gameIds: readonly string[]): Promise<readonly GameWithTeams[]> {
    return Promise.resolve(
      gameIds
        .map((id) => this.gamesById.get(id))
        .filter((g): g is GameWithTeams => g !== undefined),
    );
  }

  listHighlightCandidates(): Promise<HomepageHighlightCandidateListResult> {
    return Promise.resolve(this.highlightCandidates);
  }

  findCurrentWeekContext(): Promise<HomepageCurrentWeekContext | null> {
    return Promise.resolve(this.currentWeekContext);
  }
}

function article(id: string, overrides: Partial<ArticleRecord> = {}): ArticleRecord {
  return {
    id,
    slug: `slug-${id}`,
    type: 'ORIGINAL',
    status: 'PUBLISHED',
    version: 1,
    title: `Title ${id}`,
    summary: null,
    body: null,
    contentType: 'ARTICLE',
    mediaThumbnailUrl: null,
    sourceName: null,
    sourceUrl: null,
    sourcePublishedAt: null,
    sourceIsOfficialTeam: false,
    heroImageUrl: null,
    heroImageAlt: null,
    heroImageAttribution: null,
    heroImageAttributionUrl: null,
    seoTitle: null,
    seoDescription: null,
    isFeatured: false,
    featuredPriority: null,
    featuredStartsAt: null,
    featuredEndsAt: null,
    publishedAt: new Date('2026-08-26T12:00:00.000Z'),
    scheduledFor: null,
    createdById: null,
    updatedById: null,
    createdBySnapshot: 'editor@example.test',
    updatedBySnapshot: 'editor@example.test',
    createdAt: new Date('2026-08-26T11:00:00.000Z'),
    updatedAt: new Date('2026-08-26T12:00:00.000Z'),
    teams: [],
    ...overrides,
  } as unknown as ArticleRecord;
}

function game(id: string, overrides: Partial<GameWithTeams> = {}): GameWithTeams {
  const team = (teamId: string, abbreviation: string) => ({
    id: teamId,
    fullName: `${abbreviation} Team`,
    abbreviation,
    logoUrl: null,
    primaryColor: '#000000',
    secondaryColor: '#ffffff',
  });
  return {
    id,
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
    homeTeam: team(`${id}-home`, 'NE'),
    awayTeam: team(`${id}-away`, 'PHI'),
    editorialOverride: null,
    ...overrides,
  } as unknown as GameWithTeams;
}

function fakeGameMediaReader(media: Map<string, PublicGameMediaDto>): HomepageGameMediaReader {
  return {
    getPublicGameMedia: (gameId) => {
      const dto = media.get(gameId);
      if (dto === undefined) throw new Error(`No fake media configured for ${gameId}`);
      return Promise.resolve(dto);
    },
  };
}

function fakeMedia(overrides: Partial<PublicGameMediaDto> = {}): PublicGameMediaDto {
  return {
    gameId: 'game-1',
    displayMode: 'AUTOMATIC',
    curatedVideos: [],
    highlights: [],
    globalVideo: null,
    displayVideos: [
      {
        id: 'highlight-1',
        mediaType: 'AUTOMATIC',
        title: 'Highlight',
        embedUrl: 'https://www.youtube.com/embed/x',
        canonicalUrl: 'https://www.youtube.com/watch?v=x',
        thumbnailUrl: null,
        sourceLabel: null,
        canEmbed: true,
      },
    ],
    coverage: 'AVAILABLE',
    ...overrides,
  };
}

function fakeStatsReader(overrides: Partial<HomepageStatsReader> = {}): HomepageStatsReader {
  return {
    getMetadata: () => Promise.resolve({ data: { availableSeasons: [2023, 2024, 2025] } }),
    getSeasonLeaders: (query) =>
      Promise.resolve({
        data: [
          {
            rank: 1,
            metricValue: 4_500,
            player: {
              id: 'p1',
              displayName: `Leader ${query.metric}`,
              position: 'QB',
              positionGroup: 'QB',
              headshotUrl: null,
            },
            teamContext: {
              type: 'SINGLE',
              teams: [{ id: 't1', abbreviation: 'NE', fullName: 'NE Team' }],
            },
          },
        ],
      }),
    getWeeklyLeaders: () => Promise.resolve({ data: [] }),
    ...overrides,
  };
}

/** Default: no published predictions stored -- matches the real
 * `AiHubWeeklyInsightsService.getWeeklyInsights` behavior when nothing has
 * been published for the requested week (see `weekly-insights.service.ts`).
 * `getWeeklyInsights` is loosely typed (not `Partial<AiHubWeeklyInsightsService>`)
 * so a test can hand back a realistic-but-partial `deriveWeeklyInsights`-shaped
 * value without constructing every field that function returns. */
function fakeAiHub(
  overrides: {
    getWeeklyInsights?: (...args: unknown[]) => Promise<unknown>;
  } = {},
): AiHubWeeklyInsightsService {
  return {
    getWeeklyInsights:
      overrides.getWeeklyInsights ??
      vi.fn().mockRejectedValue(
        new AppErrorClass({
          code: 'WEEKLY_INSIGHTS_NOT_FOUND',
          message: 'No published predictions were found for the selected week.',
          statusCode: 404,
        }),
      ),
  } as unknown as AiHubWeeklyInsightsService;
}

/** A realistic `InsightCard` (see `ai-hub/weekly-insights.ts`) for constructing
 * a fake `getWeeklyInsights` resolved value in Insight Rail tests. */
function insightCard(overrides: Partial<InsightCard> = {}): InsightCard {
  return {
    rank: 1,
    game: {
      id: 'game-1',
      startTime: '2026-09-07T17:00:00.000Z',
      homeTeam: { id: 'team-home', fullName: 'NE Team', abbreviation: 'NE' },
      awayTeam: { id: 'team-away', fullName: 'PHI Team', abbreviation: 'PHI' },
    },
    favorite: { id: 'team-home', fullName: 'NE Team', abbreviation: 'NE' },
    underdog: { id: 'team-away', fullName: 'PHI Team', abbreviation: 'PHI' },
    favoriteProbability: 0.72,
    underdogProbability: 0.28,
    probabilityGap: 0.44,
    projectedScore: { home: 27, away: 17 },
    projectedMargin: 10,
    projectedTotal: 44,
    confidence: 'HIGH',
    factors: [{ code: 'TEAM_STRENGTH', favors: 'HOME', label: 'Stronger overall team' }],
    ...overrides,
  };
}

function buildService(
  repository = new FakeHomepageRepository(),
  options: Partial<{
    gameMedia: HomepageGameMediaReader;
    stats: HomepageStatsReader;
    aiHub: AiHubWeeklyInsightsService;
    fallbackSeason: number;
  }> = {},
) {
  return new HomepageService({
    repository,
    gameMedia: options.gameMedia ?? fakeGameMediaReader(new Map()),
    stats: options.stats ?? fakeStatsReader(),
    aiHub: options.aiHub ?? fakeAiHub(),
    fallbackSeason: options.fallbackSeason ?? 2026,
  });
}

describe('HomepageService Hero slides', () => {
  it('creates a slide at the next position', async () => {
    const repository = new FakeHomepageRepository();
    const service = buildService(repository);
    const first = await service.createHeroSlide(createInput(), principal, null);
    const second = await service.createHeroSlide(createInput(), principal, null);
    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
  });

  it('rejects an 11th slide', async () => {
    const repository = new FakeHomepageRepository();
    const service = buildService(repository);
    for (let i = 0; i < MAX_HERO_SLIDES; i += 1) {
      await service.createHeroSlide(createInput(), principal, null);
    }
    await expect(service.createHeroSlide(createInput(), principal, null)).rejects.toMatchObject({
      code: 'HOMEPAGE_HERO_SLIDE_LIMIT_REACHED',
    } satisfies Partial<AppError>);
  });

  it('updates a slide, including toggling isActive (activate/deactivate)', async () => {
    const repository = new FakeHomepageRepository();
    const service = buildService(repository);
    const created = await service.createHeroSlide(createInput(), principal, null);
    const updated = await service.updateHeroSlide(created.id, { isActive: false }, principal, null);
    expect(updated.isActive).toBe(false);
  });

  it('404s updating/getting/deleting an unknown slide', async () => {
    const service = buildService();
    await expect(service.getHeroSlide('missing')).rejects.toMatchObject({
      code: 'HOMEPAGE_HERO_SLIDE_NOT_FOUND',
    } satisfies Partial<AppError>);
    await expect(
      service.updateHeroSlide('missing', { isActive: false }, principal, null),
    ).rejects.toMatchObject({ code: 'HOMEPAGE_HERO_SLIDE_NOT_FOUND' } satisfies Partial<AppError>);
    await expect(service.deleteHeroSlide('missing', principal, null)).rejects.toMatchObject({
      code: 'HOMEPAGE_HERO_SLIDE_NOT_FOUND',
    } satisfies Partial<AppError>);
  });

  it('deleting a slide compacts remaining positions', async () => {
    const repository = new FakeHomepageRepository();
    const service = buildService(repository);
    const a = await service.createHeroSlide(createInput(), principal, null);
    const b = await service.createHeroSlide(createInput(), principal, null);
    const c = await service.createHeroSlide(createInput(), principal, null);
    await service.deleteHeroSlide(a.id, principal, null);
    const list = await service.listHeroSlides();
    expect(list.slides.map((s) => s.id)).toEqual([b.id, c.id]);
    expect(list.slides.map((s) => s.position)).toEqual([0, 1]);
  });

  it('reorders slides so the first ID becomes primary (position 0)', async () => {
    const repository = new FakeHomepageRepository();
    const service = buildService(repository);
    const a = await service.createHeroSlide(createInput(), principal, null);
    const b = await service.createHeroSlide(createInput(), principal, null);
    const reordered = await service.reorderHeroSlides({ slideIds: [b.id, a.id] }, principal, null);
    expect(reordered.slides.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(reordered.slides[0]?.position).toBe(0);
  });

  it('rejects a reorder missing an existing slide', async () => {
    const repository = new FakeHomepageRepository();
    const service = buildService(repository);
    const a = await service.createHeroSlide(createInput(), principal, null);
    await service.createHeroSlide(createInput(), principal, null);
    await expect(
      service.reorderHeroSlides({ slideIds: [a.id] }, principal, null),
    ).rejects.toMatchObject({
      code: 'HOMEPAGE_HERO_SLIDE_REORDER_MISMATCH',
    } satisfies Partial<AppError>);
  });

  it('public homepage only returns active slides, in position order', async () => {
    const repository = new FakeHomepageRepository();
    const service = buildService(repository);
    const a = await service.createHeroSlide(createInput({ isActive: true }), principal, null);
    await service.createHeroSlide(createInput({ isActive: false }), principal, null);
    const c = await service.createHeroSlide(createInput({ isActive: true }), principal, null);
    const homepage = await service.getPublicHomepage();
    expect(homepage.heroSlides.map((s) => s.id)).toEqual([a.id, c.id]);
  });
});

describe('HomepageService Top Stories', () => {
  it('marks an article as a Top Story at the next position', async () => {
    const repository = new FakeHomepageRepository();
    repository.articlesById.set('a1', article('a1'));
    repository.publicArticleIds.add('a1');
    const service = buildService(repository);
    const marked = await service.markTopStory('a1', principal, null);
    expect(marked.position).toBe(0);
    expect(marked.article.title).toBe('Title a1');
  });

  it('marking the same article twice is idempotent (no duplicate row)', async () => {
    const repository = new FakeHomepageRepository();
    repository.articlesById.set('a1', article('a1'));
    repository.publicArticleIds.add('a1');
    const service = buildService(repository);
    const first = await service.markTopStory('a1', principal, null);
    const second = await service.markTopStory('a1', principal, null);
    expect(second.id).toBe(first.id);
    expect(await service.listTopStories()).toHaveLength(1);
  });

  it('404s marking a nonexistent article', async () => {
    const service = buildService();
    await expect(service.markTopStory('missing', principal, null)).rejects.toMatchObject({
      code: 'ARTICLE_NOT_FOUND',
    } satisfies Partial<AppError>);
  });

  it('allows marking a DRAFT/SCHEDULED article ahead of publish (admin write is not visibility-gated)', async () => {
    const repository = new FakeHomepageRepository();
    repository.articlesById.set('a1', article('a1', { status: 'DRAFT', publishedAt: null }));
    // Deliberately NOT added to publicArticleIds.
    const service = buildService(repository);
    const marked = await service.markTopStory('a1', principal, null);
    expect(marked.article.status).toBe('DRAFT');
  });

  it('unmarking removes the row and compacts positions', async () => {
    const repository = new FakeHomepageRepository();
    repository.articlesById.set('a1', article('a1'));
    repository.articlesById.set('a2', article('a2'));
    repository.publicArticleIds.add('a1');
    repository.publicArticleIds.add('a2');
    const service = buildService(repository);
    await service.markTopStory('a1', principal, null);
    await service.markTopStory('a2', principal, null);
    await service.unmarkTopStory('a1', principal, null);
    const list = await service.listTopStories();
    expect(list.map((t) => t.article.id)).toEqual(['a2']);
    expect(list[0]?.position).toBe(0);
  });

  it('unmarking a non-curated article is a harmless no-op', async () => {
    const service = buildService();
    await expect(service.unmarkTopStory('never-marked', principal, null)).resolves.toBeUndefined();
  });

  it('caps Top Stories at 6', async () => {
    const repository = new FakeHomepageRepository();
    for (let i = 0; i < MAX_TOP_STORIES; i += 1) {
      const id = `a${String(i)}`;
      repository.articlesById.set(id, article(id));
      repository.publicArticleIds.add(id);
    }
    repository.articlesById.set('overflow', article('overflow'));
    repository.publicArticleIds.add('overflow');
    const service = buildService(repository);
    for (let i = 0; i < MAX_TOP_STORIES; i += 1) {
      await service.markTopStory(`a${String(i)}`, principal, null);
    }
    await expect(service.markTopStory('overflow', principal, null)).rejects.toMatchObject({
      code: 'HOMEPAGE_TOP_STORY_LIMIT_REACHED',
    } satisfies Partial<AppError>);
  });

  it('reorders so the first article ID becomes the lead story (position 0)', async () => {
    const repository = new FakeHomepageRepository();
    repository.articlesById.set('a1', article('a1'));
    repository.articlesById.set('a2', article('a2'));
    repository.publicArticleIds.add('a1');
    repository.publicArticleIds.add('a2');
    const service = buildService(repository);
    await service.markTopStory('a1', principal, null);
    await service.markTopStory('a2', principal, null);
    const reordered = await service.reorderTopStories(
      { articleIds: ['a2', 'a1'] },
      principal,
      null,
    );
    expect(reordered.map((t) => t.article.id)).toEqual(['a2', 'a1']);
    expect(reordered[0]?.position).toBe(0);
  });

  it('excludes an unpublished/ineligible article from the public homepage without erroring', async () => {
    const repository = new FakeHomepageRepository();
    repository.articlesById.set('a1', article('a1'));
    repository.publicArticleIds.add('a1');
    const service = buildService(repository);
    await service.markTopStory('a1', principal, null);
    // The article becomes ineligible after curation (e.g. unpublished) --
    // simulate by removing it from the public-visible set without touching
    // the curation row itself (Article preservation: the row is untouched).
    repository.publicArticleIds.delete('a1');
    const homepage = await service.getPublicHomepage();
    expect(homepage.topStories).toEqual([]);
    // The curation row itself, and the article record, are both untouched.
    expect(await service.listTopStories()).toHaveLength(1);
    expect(repository.articlesById.get('a1')).toBeDefined();
  });

  it('never mutates the Article record when marking/unmarking (Article preservation)', async () => {
    const repository = new FakeHomepageRepository();
    const original = article('a1');
    repository.articlesById.set('a1', original);
    repository.publicArticleIds.add('a1');
    const service = buildService(repository);
    await service.markTopStory('a1', principal, null);
    await service.unmarkTopStory('a1', principal, null);
    expect(repository.articlesById.get('a1')).toBe(original);
  });
});

describe('HomepageService Highlights', () => {
  it('returns a bounded, ordered list sourced from existing game media (no provider calls)', async () => {
    const repository = new FakeHomepageRepository();
    const g1 = game('game-1');
    const g2 = game('game-2');
    repository.gamesWithMedia = [g1, g2];
    const media = new Map([
      ['game-1', fakeMedia({ gameId: 'game-1' })],
      ['game-2', fakeMedia({ gameId: 'game-2' })],
    ]);
    const service = buildService(repository, { gameMedia: fakeGameMediaReader(media) });
    const homepage = await service.getPublicHomepage();
    expect(homepage.highlights.map((h) => h.gameId)).toEqual(['game-1', 'game-2']);
    expect(homepage.highlights[0]?.mediaType).toBe('AUTOMATIC');
  });

  it('never surfaces the global video as a homepage highlight, even if it is first in displayVideos', async () => {
    const repository = new FakeHomepageRepository();
    repository.gamesWithMedia = [game('game-1')];
    const media = new Map([
      [
        'game-1',
        fakeMedia({
          gameId: 'game-1',
          displayVideos: [
            {
              id: 'global-1',
              mediaType: 'GLOBAL',
              title: 'Global Video',
              embedUrl: 'https://www.youtube.com/embed/global',
              canonicalUrl: null,
              thumbnailUrl: null,
              sourceLabel: 'NFL',
              canEmbed: true,
            },
            {
              id: 'curated-1',
              mediaType: 'CURATED',
              title: 'Curated Highlight',
              embedUrl: 'https://www.youtube.com/embed/c1',
              canonicalUrl: null,
              thumbnailUrl: null,
              sourceLabel: null,
              canEmbed: true,
            },
          ],
        }),
      ],
    ]);
    const service = buildService(repository, { gameMedia: fakeGameMediaReader(media) });
    const homepage = await service.getPublicHomepage();
    expect(homepage.highlights).toHaveLength(1);
    expect(homepage.highlights[0]?.mediaType).toBe('CURATED');
  });

  it('drops a game whose only media turns out to be GLOBAL (defense in depth)', async () => {
    const repository = new FakeHomepageRepository();
    repository.gamesWithMedia = [game('game-1')];
    const media = new Map([
      [
        'game-1',
        fakeMedia({
          gameId: 'game-1',
          displayVideos: [
            {
              id: 'global-1',
              mediaType: 'GLOBAL',
              title: 'Global Video',
              embedUrl: 'https://www.youtube.com/embed/global',
              canonicalUrl: null,
              thumbnailUrl: null,
              sourceLabel: 'NFL',
              canEmbed: true,
            },
          ],
        }),
      ],
    ]);
    const service = buildService(repository, { gameMedia: fakeGameMediaReader(media) });
    const homepage = await service.getPublicHomepage();
    expect(homepage.highlights).toEqual([]);
  });

  it('is bounded to the configured limit even if more games exist', async () => {
    const repository = new FakeHomepageRepository();
    const games = Array.from({ length: 20 }, (_, i) => game(`game-${String(i)}`));
    repository.gamesWithMedia = games;
    // findRecentGamesWithMedia itself is expected to already apply the bound
    // (the fake mirrors this by only slicing to the passed `limit`).
    const media = new Map(games.map((g) => [g.id, fakeMedia({ gameId: g.id })]));
    const service = buildService(repository, { gameMedia: fakeGameMediaReader(media) });
    const homepage = await service.getPublicHomepage();
    expect(homepage.highlights.length).toBeLessThanOrEqual(8);
  });
});

describe('HomepageService Leaders', () => {
  it('fetches passing/rushing/receiving with the correct metric ids and resolved season', async () => {
    const queries: { metric: string; season: number }[] = [];
    const stats = fakeStatsReader({
      getSeasonLeaders: (query) => {
        queries.push({ metric: query.metric, season: query.season });
        return Promise.resolve({
          data: [
            {
              rank: 1,
              metricValue: 100,
              player: {
                id: 'p1',
                displayName: 'Player',
                position: 'QB',
                positionGroup: 'QB',
                headshotUrl: null,
              },
              teamContext: {
                type: 'SINGLE',
                teams: [{ id: 't1', abbreviation: 'NE', fullName: 'NE Team' }],
              },
            },
          ],
        });
      },
    });
    const service = buildService(new FakeHomepageRepository(), { stats });
    const homepage = await service.getPublicHomepage();
    expect(homepage.leaders.season).toBe(2025); // max of [2023,2024,2025]
    expect(homepage.leaders.seasonType).toBe('REG');
    expect(queries.map((q) => q.metric).sort()).toEqual(
      ['passing_yards', 'receiving_yards', 'rushing_yards'].sort(),
    );
    expect(queries.every((q) => q.season === 2025)).toBe(true);
    expect(homepage.leaders.passing[0]?.value).toBe(100);
  });

  it('maps a SINGLE team context to a team and a MULTI/NONE context to null', async () => {
    const stats = fakeStatsReader({
      getSeasonLeaders: () =>
        Promise.resolve({
          data: [
            {
              rank: 1,
              metricValue: 1,
              player: {
                id: 'p1',
                displayName: 'Solo',
                position: null,
                positionGroup: null,
                headshotUrl: null,
              },
              teamContext: { type: 'MULTI', teams: [] },
            },
          ],
        }),
    });
    const service = buildService(new FakeHomepageRepository(), { stats });
    const homepage = await service.getPublicHomepage();
    expect(homepage.leaders.passing[0]?.team).toBeNull();
  });

  it('falls back to the configured season when stats-hub reports no imported seasons', async () => {
    const stats = fakeStatsReader({
      getMetadata: () => Promise.resolve({ data: { availableSeasons: [] } }),
    });
    const service = buildService(new FakeHomepageRepository(), { stats, fallbackSeason: 2022 });
    const homepage = await service.getPublicHomepage();
    expect(homepage.leaders.season).toBe(2022);
  });

  it('never fabricates data: an empty/malformed stats response yields an empty category, not an error', async () => {
    const stats = fakeStatsReader({
      getSeasonLeaders: () => Promise.resolve({ unexpected: 'shape' }),
    });
    const service = buildService(new FakeHomepageRepository(), { stats });
    const homepage = await service.getPublicHomepage();
    expect(homepage.leaders.passing).toEqual([]);
    expect(homepage.leaders.rushing).toEqual([]);
    expect(homepage.leaders.receiving).toEqual([]);
  });

  it('requests exactly top 3 per category', async () => {
    const limits: number[] = [];
    const stats = fakeStatsReader({
      getSeasonLeaders: (query) => {
        limits.push(query.limit);
        return Promise.resolve({ data: [] });
      },
    });
    const service = buildService(new FakeHomepageRepository(), { stats });
    await service.getPublicHomepage();
    expect(limits).toEqual([3, 3, 3]);
  });
});

// ---------------------------------------------------------------------------
// M37A: Homepage highlight curation CRUD
// ---------------------------------------------------------------------------

describe('HomepageService highlight curation CRUD (M37A)', () => {
  function registerSource(
    repository: FakeHomepageRepository,
    sourceType: HomepageHighlightSourceTypeValue,
    sourceId: string,
    gameId: string,
  ): void {
    const target =
      sourceType === 'GAME_HIGHLIGHT'
        ? repository.gameHighlightSources
        : repository.curatedVideoSources;
    target.set(sourceId, { gameId });
    if (!repository.gamesById.has(gameId)) repository.gamesById.set(gameId, game(gameId));
  }

  function registerMediaForSource(
    media: Map<string, PublicGameMediaDto>,
    gameId: string,
    sourceId: string,
  ): void {
    media.set(
      gameId,
      fakeMedia({
        gameId,
        displayVideos: [
          {
            id: sourceId,
            mediaType: 'CURATED',
            title: 'A great catch',
            embedUrl: 'https://www.youtube.com/embed/x',
            canonicalUrl: 'https://www.youtube.com/watch?v=x',
            thumbnailUrl: null,
            sourceLabel: null,
            canEmbed: true,
          },
        ],
      }),
    );
  }

  it('adds a placement, which then appears in listHighlightPlacements', async () => {
    const repository = new FakeHomepageRepository();
    registerSource(repository, 'GAME_HIGHLIGHT', 'h1', 'game-1');
    const media = new Map<string, PublicGameMediaDto>();
    registerMediaForSource(media, 'game-1', 'h1');
    const service = buildService(repository, { gameMedia: fakeGameMediaReader(media) });

    const created = await service.addHighlightPlacement(
      { sourceType: 'GAME_HIGHLIGHT', sourceId: 'h1' },
      principal,
      null,
    );
    expect(created.sourceId).toBe('h1');
    expect(created.position).toBe(0);

    const list = await service.listHighlightPlacements();
    expect(list.placements.map((p) => p.id)).toEqual([created.id]);
  });

  it('404s adding a placement whose source does not exist', async () => {
    const repository = new FakeHomepageRepository();
    const service = buildService(repository);
    await expect(
      service.addHighlightPlacement(
        { sourceType: 'GAME_HIGHLIGHT', sourceId: 'missing' },
        principal,
        null,
      ),
    ).rejects.toMatchObject({
      code: 'HOMEPAGE_HIGHLIGHT_SOURCE_NOT_FOUND',
    } satisfies Partial<AppError>);
  });

  it('rejects a duplicate (sourceType, sourceId) placement', async () => {
    const repository = new FakeHomepageRepository();
    registerSource(repository, 'GAME_HIGHLIGHT', 'h1', 'game-1');
    const media = new Map<string, PublicGameMediaDto>();
    registerMediaForSource(media, 'game-1', 'h1');
    const service = buildService(repository, { gameMedia: fakeGameMediaReader(media) });

    await service.addHighlightPlacement(
      { sourceType: 'GAME_HIGHLIGHT', sourceId: 'h1' },
      principal,
      null,
    );
    await expect(
      service.addHighlightPlacement(
        { sourceType: 'GAME_HIGHLIGHT', sourceId: 'h1' },
        principal,
        null,
      ),
    ).rejects.toMatchObject({ code: 'HOMEPAGE_HIGHLIGHT_DUPLICATE' } satisfies Partial<AppError>);
  });

  it('rejects an 11th placement once 10 exist', async () => {
    const repository = new FakeHomepageRepository();
    const media = new Map<string, PublicGameMediaDto>();
    for (let i = 0; i < MAX_HOMEPAGE_HIGHLIGHT_PLACEMENTS; i += 1) {
      const sourceId = `h${String(i)}`;
      const gameId = `game-${String(i)}`;
      registerSource(repository, 'GAME_HIGHLIGHT', sourceId, gameId);
      registerMediaForSource(media, gameId, sourceId);
    }
    const service = buildService(repository, { gameMedia: fakeGameMediaReader(media) });
    for (let i = 0; i < MAX_HOMEPAGE_HIGHLIGHT_PLACEMENTS; i += 1) {
      await service.addHighlightPlacement(
        { sourceType: 'GAME_HIGHLIGHT', sourceId: `h${String(i)}` },
        principal,
        null,
      );
    }
    registerSource(repository, 'GAME_HIGHLIGHT', 'overflow', 'game-overflow');
    registerMediaForSource(media, 'game-overflow', 'overflow');
    await expect(
      service.addHighlightPlacement(
        { sourceType: 'GAME_HIGHLIGHT', sourceId: 'overflow' },
        principal,
        null,
      ),
    ).rejects.toMatchObject({
      code: 'HOMEPAGE_HIGHLIGHT_LIMIT_REACHED',
    } satisfies Partial<AppError>);
  });

  it('removes a placement; 404s removing a missing one', async () => {
    const repository = new FakeHomepageRepository();
    registerSource(repository, 'GAME_HIGHLIGHT', 'h1', 'game-1');
    const media = new Map<string, PublicGameMediaDto>();
    registerMediaForSource(media, 'game-1', 'h1');
    const service = buildService(repository, { gameMedia: fakeGameMediaReader(media) });
    const created = await service.addHighlightPlacement(
      { sourceType: 'GAME_HIGHLIGHT', sourceId: 'h1' },
      principal,
      null,
    );
    await service.removeHighlightPlacement(created.id, principal, null);
    expect((await service.listHighlightPlacements()).placements).toEqual([]);

    await expect(
      service.removeHighlightPlacement('missing', principal, null),
    ).rejects.toMatchObject({
      code: 'HOMEPAGE_HIGHLIGHT_PLACEMENT_NOT_FOUND',
    } satisfies Partial<AppError>);
  });

  it('reorders placements; rejects a non-permutation reorder', async () => {
    const repository = new FakeHomepageRepository();
    const media = new Map<string, PublicGameMediaDto>();
    registerSource(repository, 'GAME_HIGHLIGHT', 'h1', 'game-1');
    registerSource(repository, 'GAME_HIGHLIGHT', 'h2', 'game-2');
    registerMediaForSource(media, 'game-1', 'h1');
    registerMediaForSource(media, 'game-2', 'h2');
    const service = buildService(repository, { gameMedia: fakeGameMediaReader(media) });
    const a = await service.addHighlightPlacement(
      { sourceType: 'GAME_HIGHLIGHT', sourceId: 'h1' },
      principal,
      null,
    );
    const b = await service.addHighlightPlacement(
      { sourceType: 'GAME_HIGHLIGHT', sourceId: 'h2' },
      principal,
      null,
    );

    const reordered = await service.reorderHighlightPlacements(
      { placementIds: [b.id, a.id] },
      principal,
      null,
    );
    expect(reordered.map((p) => p.id)).toEqual([b.id, a.id]);

    await expect(
      service.reorderHighlightPlacements({ placementIds: [a.id] }, principal, null),
    ).rejects.toMatchObject({
      code: 'HOMEPAGE_HIGHLIGHT_REORDER_MISMATCH',
    } satisfies Partial<AppError>);
  });

  it('updateHighlightSettings persists the new displayLimit/fillWithAutomatic', async () => {
    const repository = new FakeHomepageRepository();
    const service = buildService(repository);
    const updated = await service.updateHighlightSettings(
      { displayLimit: 8, fillWithAutomatic: false },
      principal,
      null,
    );
    expect(updated).toEqual({ displayLimit: 8, fillWithAutomatic: false });
    const list = await service.listHighlightPlacements();
    expect(list.settings).toEqual({ displayLimit: 8, fillWithAutomatic: false });
  });

  it('the displayLimit schema enforces the 3-10 bound directly', () => {
    expect(updateHighlightSettingsSchema.safeParse({ displayLimit: 2 }).success).toBe(false);
    expect(updateHighlightSettingsSchema.safeParse({ displayLimit: 11 }).success).toBe(false);
    expect(updateHighlightSettingsSchema.safeParse({ displayLimit: 3 }).success).toBe(true);
    expect(updateHighlightSettingsSchema.safeParse({ displayLimit: 10 }).success).toBe(true);
    expect(updateHighlightSettingsSchema.safeParse({}).success).toBe(false); // at least one field
  });
});

// ---------------------------------------------------------------------------
// M37A: public Highlights composition (curated + automatic fill)
// ---------------------------------------------------------------------------

describe('HomepageService public Highlights composition (M37A)', () => {
  function placementFor(
    id: string,
    sourceType: HomepageHighlightSourceTypeValue,
    sourceId: string,
    gameId: string,
    position: number,
  ): HomepageHighlightPlacementRecord {
    return {
      id,
      sourceType,
      sourceId,
      gameId,
      position,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  function validMediaFor(gameId: string, sourceId: string): PublicGameMediaDto {
    return fakeMedia({
      gameId,
      displayVideos: [
        {
          id: sourceId,
          mediaType: 'CURATED',
          title: `Curated for ${gameId}`,
          embedUrl: 'https://www.youtube.com/embed/x',
          canonicalUrl: 'https://www.youtube.com/watch?v=x',
          thumbnailUrl: null,
          sourceLabel: null,
          canEmbed: true,
        },
      ],
    });
  }

  it('curated-only when fillWithAutomatic is false, even below displayLimit', async () => {
    const repository = new FakeHomepageRepository();
    repository.highlightSettings = { displayLimit: 5, fillWithAutomatic: false };
    repository.placements = [
      placementFor('p1', 'GAME_HIGHLIGHT', 'h1', 'game-1', 0),
      placementFor('p2', 'GAME_HIGHLIGHT', 'h2', 'game-2', 1),
    ];
    repository.gamesById.set('game-1', game('game-1'));
    repository.gamesById.set('game-2', game('game-2'));
    // A pool of other games exists but must never be used since fillWithAutomatic is false.
    repository.gamesWithMedia = [game('game-3'), game('game-4')];
    const media = new Map([
      ['game-1', validMediaFor('game-1', 'h1')],
      ['game-2', validMediaFor('game-2', 'h2')],
      ['game-3', fakeMedia({ gameId: 'game-3' })],
      ['game-4', fakeMedia({ gameId: 'game-4' })],
    ]);
    const service = buildService(repository, { gameMedia: fakeGameMediaReader(media) });

    const homepage = await service.getPublicHomepage();
    expect(homepage.highlights).toHaveLength(2);
    expect(homepage.highlights.map((h) => h.gameId).sort()).toEqual(['game-1', 'game-2']);
    expect(homepage.highlights.every((h) => h.homepageSelection === 'CURATED')).toBe(true);
  });

  it('fills remaining slots with automatic items, tagged AUTOMATIC, once curated is exhausted', async () => {
    const repository = new FakeHomepageRepository();
    repository.highlightSettings = { displayLimit: 5, fillWithAutomatic: true };
    repository.placements = [
      placementFor('p1', 'GAME_HIGHLIGHT', 'h1', 'game-1', 0),
      placementFor('p2', 'GAME_HIGHLIGHT', 'h2', 'game-2', 1),
      placementFor('p3', 'GAME_HIGHLIGHT', 'h3', 'game-3', 2),
    ];
    repository.gamesById.set('game-1', game('game-1'));
    repository.gamesById.set('game-2', game('game-2'));
    repository.gamesById.set('game-3', game('game-3'));
    repository.gamesWithMedia = [game('game-4'), game('game-5'), game('game-6')];
    const media = new Map([
      ['game-1', validMediaFor('game-1', 'h1')],
      ['game-2', validMediaFor('game-2', 'h2')],
      ['game-3', validMediaFor('game-3', 'h3')],
      ['game-4', fakeMedia({ gameId: 'game-4' })],
      ['game-5', fakeMedia({ gameId: 'game-5' })],
      ['game-6', fakeMedia({ gameId: 'game-6' })],
    ]);
    const service = buildService(repository, { gameMedia: fakeGameMediaReader(media) });

    const homepage = await service.getPublicHomepage();
    expect(homepage.highlights).toHaveLength(5);
    const curated = homepage.highlights.filter((h) => h.homepageSelection === 'CURATED');
    const automatic = homepage.highlights.filter((h) => h.homepageSelection === 'AUTOMATIC');
    expect(curated).toHaveLength(3);
    expect(automatic).toHaveLength(2);
    expect(curated.map((h) => h.gameId).sort()).toEqual(['game-1', 'game-2', 'game-3']);
    expect(automatic.map((h) => h.gameId).sort()).toEqual(['game-4', 'game-5']);
  });

  it('never re-shows a game already referenced by a placement, even a stale one, in the automatic pool', async () => {
    const repository = new FakeHomepageRepository();
    repository.highlightSettings = { displayLimit: 2, fillWithAutomatic: true };
    // Placement for game-1 whose sourceId is stale/deleted -- not present in
    // game-1's displayVideos, so it's excluded from curated *and* must not
    // resurface in the automatic pool either.
    repository.placements = [placementFor('p1', 'GAME_HIGHLIGHT', 'stale-source', 'game-1', 0)];
    repository.gamesById.set('game-1', game('game-1'));
    repository.gamesWithMedia = [game('game-1'), game('game-2')];
    const media = new Map([
      ['game-1', fakeMedia({ gameId: 'game-1' })], // no item with id "stale-source"
      ['game-2', fakeMedia({ gameId: 'game-2' })],
    ]);
    const service = buildService(repository, { gameMedia: fakeGameMediaReader(media) });

    const homepage = await service.getPublicHomepage();
    expect(homepage.highlights.map((h) => h.gameId)).toEqual(['game-2']);
    expect(homepage.highlights[0]?.homepageSelection).toBe('AUTOMATIC');
  });

  it('a stale curated placement is silently excluded and does not count against displayLimit', async () => {
    const repository = new FakeHomepageRepository();
    repository.highlightSettings = { displayLimit: 5, fillWithAutomatic: true };
    repository.placements = [
      placementFor('p1', 'GAME_HIGHLIGHT', 'stale-source', 'game-1', 0), // stale
      placementFor('p2', 'GAME_HIGHLIGHT', 'h2', 'game-2', 1), // valid
      placementFor('p3', 'GAME_HIGHLIGHT', 'h3', 'game-3', 2), // valid
    ];
    repository.gamesById.set('game-1', game('game-1'));
    repository.gamesById.set('game-2', game('game-2'));
    repository.gamesById.set('game-3', game('game-3'));
    repository.gamesWithMedia = [game('game-4'), game('game-5'), game('game-6'), game('game-7')];
    const media = new Map([
      ['game-1', fakeMedia({ gameId: 'game-1' })], // no "stale-source" item -> stale
      ['game-2', validMediaFor('game-2', 'h2')],
      ['game-3', validMediaFor('game-3', 'h3')],
      ['game-4', fakeMedia({ gameId: 'game-4' })],
      ['game-5', fakeMedia({ gameId: 'game-5' })],
      ['game-6', fakeMedia({ gameId: 'game-6' })],
      ['game-7', fakeMedia({ gameId: 'game-7' })],
    ]);
    const service = buildService(repository, { gameMedia: fakeGameMediaReader(media) });

    const homepage = await service.getPublicHomepage();
    expect(homepage.highlights).toHaveLength(5);
    const curated = homepage.highlights.filter((h) => h.homepageSelection === 'CURATED');
    const automatic = homepage.highlights.filter((h) => h.homepageSelection === 'AUTOMATIC');
    expect(curated).toHaveLength(2);
    expect(automatic).toHaveLength(3);
    // game-1 (the stale placement's game) never appears anywhere.
    expect(homepage.highlights.some((h) => h.gameId === 'game-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M37A: Insight Rail
// ---------------------------------------------------------------------------

describe('HomepageService Insight Rail (M37A)', () => {
  const context: HomepageCurrentWeekContext = { season: 2026, week: 5, seasonType: 'REG' };

  describe('AI Hub snapshot', () => {
    it('returns null when no predictions are published yet for the resolved week', async () => {
      const repository = new FakeHomepageRepository();
      repository.currentWeekContext = context;
      const service = buildService(repository); // default fakeAiHub rejects with WEEKLY_INSIGHTS_NOT_FOUND
      const homepage = await service.getPublicHomepage();
      expect(homepage.insights.aiHub).toBeNull();
    });

    it('returns null (never called) when no current-week context can be resolved', async () => {
      const repository = new FakeHomepageRepository();
      repository.currentWeekContext = null;
      const getWeeklyInsights = vi.fn();
      const service = buildService(repository, { aiHub: fakeAiHub({ getWeeklyInsights }) });
      const homepage = await service.getPublicHomepage();
      expect(homepage.insights.aiHub).toBeNull();
      expect(getWeeklyInsights).not.toHaveBeenCalled();
    });

    it('maps a populated snapshot: strongestPick/closestMatchup/highestProjectedTotal', async () => {
      const repository = new FakeHomepageRepository();
      repository.currentWeekContext = context;
      const strongest = insightCard({ rank: 1, favoriteProbability: 0.81 });
      const closest = insightCard({
        rank: 2,
        game: { ...strongest.game, id: 'game-2' },
        favoriteProbability: 0.51,
      });
      const highestTotal = insightCard({
        rank: 3,
        game: { ...strongest.game, id: 'game-3' },
        projectedScore: { home: 35, away: 31 },
        projectedTotal: 66,
      });
      const getWeeklyInsights = vi.fn().mockResolvedValue({
        strongestPick: strongest,
        closestMatchup: closest,
        projectedHighestScoringGame: highestTotal,
      });
      const service = buildService(repository, { aiHub: fakeAiHub({ getWeeklyInsights }) });

      const homepage = await service.getPublicHomepage();
      expect(homepage.insights.aiHub).not.toBeNull();
      expect(homepage.insights.aiHub?.season).toBe(2026);
      expect(homepage.insights.aiHub?.week).toBe(5);
      expect(homepage.insights.aiHub?.seasonType).toBe('REG');
      expect(homepage.insights.aiHub?.strongestPick).toEqual({
        game: {
          gameId: strongest.game.id,
          startTime: strongest.game.startTime,
          homeTeam: strongest.game.homeTeam,
          awayTeam: strongest.game.awayTeam,
        },
        favoriteTeam: strongest.favorite,
        favoriteProbability: strongest.favoriteProbability,
        projectedScore: strongest.projectedScore,
        projectedTotal: strongest.projectedTotal,
      });
      expect(homepage.insights.aiHub?.closestMatchup?.favoriteProbability).toBe(0.51);
      expect(homepage.insights.aiHub?.highestProjectedTotal?.projectedTotal).toBe(66);
    });
  });

  describe('weekly leaders snapshot', () => {
    it('returns null when findCurrentWeekContext resolves null', async () => {
      const repository = new FakeHomepageRepository();
      repository.currentWeekContext = null;
      const service = buildService(repository);
      const homepage = await service.getPublicHomepage();
      expect(homepage.insights.weeklyLeaders).toBeNull();
    });

    it('returns null when the resolved week and every backward-stepped week (up to 4) are empty', async () => {
      const repository = new FakeHomepageRepository();
      repository.currentWeekContext = { season: 2026, week: 5, seasonType: 'REG' };
      const queriedWeeks: number[] = [];
      const stats = fakeStatsReader({
        getWeeklyLeaders: (query) => {
          queriedWeeks.push(query.week);
          return Promise.resolve({ data: [] });
        },
      });
      const service = buildService(repository, { stats });
      const homepage = await service.getPublicHomepage();
      expect(homepage.insights.weeklyLeaders).toBeNull();
      // Weeks 5,4,3,2,1 queried (3 categories each) -- never week 0.
      expect(new Set(queriedWeeks)).toEqual(new Set([5, 4, 3, 2, 1]));
      expect(queriedWeeks).not.toContain(0);
    });

    it("returns the resolved week's data when found on the first try", async () => {
      const repository = new FakeHomepageRepository();
      repository.currentWeekContext = { season: 2026, week: 5, seasonType: 'REG' };
      const stats = fakeStatsReader({
        getWeeklyLeaders: (query) => {
          if (query.week !== 5) return Promise.resolve({ data: [] });
          return Promise.resolve({
            data: [
              {
                rank: 1,
                metricValue: 300,
                week: 5,
                season: 2026,
                player: { id: 'p1', displayName: 'Player One' },
                team: { abbreviation: 'NE' },
              },
            ],
          });
        },
      });
      const service = buildService(repository, { stats });
      const homepage = await service.getPublicHomepage();
      expect(homepage.insights.weeklyLeaders?.week).toBe(5);
      expect(homepage.insights.weeklyLeaders?.season).toBe(2026);
      expect(homepage.insights.weeklyLeaders?.passing?.playerName).toBe('Player One');
    });

    it('steps backward and finds an earlier week when the current week is empty, reporting the actual week used', async () => {
      const repository = new FakeHomepageRepository();
      repository.currentWeekContext = { season: 2026, week: 5, seasonType: 'REG' };
      const stats = fakeStatsReader({
        getWeeklyLeaders: (query) => {
          if (query.week !== 3) return Promise.resolve({ data: [] });
          return Promise.resolve({
            data: [
              {
                rank: 1,
                metricValue: 150,
                week: 3,
                season: 2026,
                player: { id: 'p2', displayName: 'Player Two' },
                team: { abbreviation: 'PHI' },
              },
            ],
          });
        },
      });
      const service = buildService(repository, { stats });
      const homepage = await service.getPublicHomepage();
      expect(homepage.insights.weeklyLeaders?.week).toBe(3);
      expect(homepage.insights.weeklyLeaders?.season).toBe(2026);
      expect(homepage.insights.weeklyLeaders?.rushing?.playerName).toBe('Player Two');
    });

    it('never steps into week < 1', async () => {
      const repository = new FakeHomepageRepository();
      repository.currentWeekContext = { season: 2026, week: 2, seasonType: 'REG' };
      const queriedWeeks: number[] = [];
      const stats = fakeStatsReader({
        getWeeklyLeaders: (query) => {
          queriedWeeks.push(query.week);
          return Promise.resolve({ data: [] });
        },
      });
      const service = buildService(repository, { stats });
      await service.getPublicHomepage();
      expect(Math.min(...queriedWeeks)).toBe(1);
      expect(queriedWeeks).not.toContain(0);
    });
  });
});

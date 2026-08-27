import { describe, expect, it } from 'vitest';

import type { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import type { ArticleRecord } from '../articles/article.dto.js';
import type { PublicGameMediaDto } from '../game-media-curation/game-media-curation.dto.js';
import type { GameWithTeams } from '../games/game.dto.js';
import {
  HomepageService,
  type HomepageGameMediaReader,
  type HomepageStatsReader,
} from './homepage.service.js';
import type { CreateHeroSlideInput, UpdateHeroSlideInput } from './homepage.schemas.js';
import { MAX_HERO_SLIDES, MAX_TOP_STORIES } from './homepage.schemas.js';
import type {
  HomepageHeroSlideRecord,
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
    ...overrides,
  };
}

function buildService(
  repository = new FakeHomepageRepository(),
  options: Partial<{
    gameMedia: HomepageGameMediaReader;
    stats: HomepageStatsReader;
    fallbackSeason: number;
  }> = {},
) {
  return new HomepageService({
    repository,
    gameMedia: options.gameMedia ?? fakeGameMediaReader(new Map()),
    stats: options.stats ?? fakeStatsReader(),
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

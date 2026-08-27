import { describe, expect, it } from 'vitest';

import type { ArticleRecord } from '../articles/article.dto.js';
import type { GameWithTeams } from '../games/game.dto.js';
import type { DisplayMediaItemDto } from '../game-media-curation/game-media-curation.dto.js';
import {
  toAdminHeroListDto,
  toAdminHeroSlideDto,
  toAdminTopStoryDto,
  toPublicHeroSlideDto,
  toPublicHomepageHighlightDto,
  toPublicTopStoryDto,
} from './homepage.dto.js';
import type { HomepageHeroSlideRecord, HomepageTopStoryRecord } from './homepage.repository.js';

function heroSlide(overrides: Partial<HomepageHeroSlideRecord> = {}): HomepageHeroSlideRecord {
  return {
    id: 'slide-1',
    position: 0,
    isActive: true,
    imageUrl: 'https://example.test/hero.jpg',
    imageAlt: 'Hero image',
    imageBrightness: 100,
    imageContrast: 100,
    imageSaturation: 100,
    overlayOpacity: 0,
    focalPointX: 50,
    focalPointY: 50,
    imageScale: 100,
    createdAt: new Date('2026-08-27T00:00:00.000Z'),
    updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    contentBlocks: [
      {
        id: 'block-1',
        slot: 'TOP_LEFT',
        content: {
          type: 'doc',
          children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hi' }] }],
        },
      },
    ],
    ctas: [
      { id: 'cta-1', position: 0, label: 'Read more', url: '/articles/foo', variant: 'PRIMARY' },
    ],
    ...overrides,
  };
}

function article(overrides: Partial<ArticleRecord> = {}): ArticleRecord {
  return {
    id: 'article-1',
    slug: 'big-game-recap',
    type: 'ORIGINAL',
    status: 'PUBLISHED',
    version: 1,
    title: 'Big Game Recap',
    summary: 'A recap.',
    body: 'Body text.',
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

function topStoryRecord(overrides: Partial<HomepageTopStoryRecord> = {}): HomepageTopStoryRecord {
  return {
    id: 'top-story-1',
    articleId: 'article-1',
    position: 0,
    createdAt: new Date('2026-08-27T00:00:00.000Z'),
    updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    ...overrides,
  };
}

function game(overrides: Partial<GameWithTeams> = {}): GameWithTeams {
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

describe('toAdminHeroSlideDto / toPublicHeroSlideDto', () => {
  it('admin shape never includes creator/updater identity', () => {
    const serialized = JSON.stringify(toAdminHeroSlideDto(heroSlide()));
    expect(serialized).not.toContain('createdBy');
    expect(serialized).not.toContain('updatedBy');
  });

  it('public shape omits isActive and timestamps', () => {
    const dto = toPublicHeroSlideDto(heroSlide());
    expect(dto).not.toHaveProperty('isActive');
    expect(dto).not.toHaveProperty('createdAt');
    expect(dto.contentBlocks).toHaveLength(1);
    expect(dto.ctas).toHaveLength(1);
  });
});

describe('toAdminHeroListDto', () => {
  it('reports readyForPublish once 3+ slides are active', () => {
    const slides = [0, 1, 2].map((i) => heroSlide({ id: `slide-${String(i)}`, position: i }));
    const list = toAdminHeroListDto(slides);
    expect(list.meta.activeCount).toBe(3);
    expect(list.meta.readyForPublish).toBe(true);
  });

  it('reports readyForPublish: false below 3 active slides', () => {
    const slides = [heroSlide({ id: 'a' }), heroSlide({ id: 'b', isActive: false })];
    const list = toAdminHeroListDto(slides);
    expect(list.meta.activeCount).toBe(1);
    expect(list.meta.readyForPublish).toBe(false);
  });
});

describe('toAdminTopStoryDto / toPublicTopStoryDto', () => {
  it('embeds the article summary and never leaks admin fields publicly', () => {
    const publicDto = toPublicTopStoryDto(topStoryRecord(), article());
    const serialized = JSON.stringify(publicDto);
    expect(serialized).not.toContain('createdBySnapshot');
    expect(serialized).not.toContain('body');
    expect(publicDto.article.title).toBe('Big Game Recap');
  });

  it('admin shape includes richer article fields (status, version)', () => {
    const adminDto = toAdminTopStoryDto(topStoryRecord(), article());
    expect(adminDto.article.status).toBe('PUBLISHED');
    expect(adminDto.article.version).toBe(1);
  });
});

describe('toPublicHomepageHighlightDto', () => {
  const item: DisplayMediaItemDto = {
    id: 'highlight-1',
    mediaType: 'AUTOMATIC',
    title: 'Eagles vs. Patriots',
    embedUrl: 'https://www.youtube.com/embed/abc',
    canonicalUrl: 'https://www.youtube.com/watch?v=abc',
    thumbnailUrl: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
    sourceLabel: null,
    canEmbed: true,
  };

  it('maps game + display item into the provider-neutral homepage shape', () => {
    const dto = toPublicHomepageHighlightDto(game(), item);
    expect(dto).toEqual({
      gameId: 'game-1',
      title: 'Eagles vs. Patriots',
      thumbnailUrl: item.thumbnailUrl,
      canonicalUrl: item.canonicalUrl,
      embedUrl: item.embedUrl,
      canEmbed: true,
      mediaType: 'AUTOMATIC',
      awayTeam: {
        id: 'team-away',
        fullName: 'PHI Team',
        abbreviation: 'PHI',
        logoUrl: null,
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
      },
      homeTeam: {
        id: 'team-home',
        fullName: 'NE Team',
        abbreviation: 'NE',
        logoUrl: null,
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
      },
      gameDate: '2026-08-22T23:00:00.000Z',
    });
  });

  it('throws if ever given a GLOBAL item (never surfaced on the homepage)', () => {
    expect(() => toPublicHomepageHighlightDto(game(), { ...item, mediaType: 'GLOBAL' })).toThrow();
  });
});

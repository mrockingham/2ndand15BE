import { describe, expect, it } from 'vitest';

import type { ArticleRecord } from '../articles/article.dto.js';
import { selectAutomaticTopStories } from './automatic-top-stories.js';

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

describe('selectAutomaticTopStories', () => {
  it('returns nothing when count is zero or negative', () => {
    expect(selectAutomaticTopStories([article('a1')], new Set(), 0)).toEqual([]);
  });

  it('excludes already-curated article ids', () => {
    const pool = [article('a1'), article('a2')];
    const picks = selectAutomaticTopStories(pool, new Set(['a1']), 5);
    expect(picks.map((a) => a.id)).toEqual(['a2']);
  });

  it('drops entries with no usable publish date rather than guessing one', () => {
    const pool = [
      article('a1', { publishedAt: null, status: 'DRAFT', scheduledFor: null }),
      article('a2', { publishedAt: new Date('2026-08-29T10:00:00.000Z') }),
    ];
    const picks = selectAutomaticTopStories(pool, new Set(), 5);
    expect(picks.map((a) => a.id)).toEqual(['a2']);
  });

  it('orders strictly by freshness (effectivePublishedAt desc) and never reorders', () => {
    const pool = [
      article('old', { publishedAt: new Date('2026-08-28T00:00:00.000Z') }),
      article('newest', { publishedAt: new Date('2026-08-29T12:00:00.000Z') }),
      article('mid', { publishedAt: new Date('2026-08-29T00:00:00.000Z') }),
    ];
    const picks = selectAutomaticTopStories(pool, new Set(), 5);
    expect(picks.map((a) => a.id)).toEqual(['newest', 'mid', 'old']);
  });

  it("uses a SCHEDULED article's scheduledFor as its effective publish time", () => {
    const pool = [
      article('scheduled', {
        status: 'SCHEDULED',
        publishedAt: null,
        scheduledFor: new Date('2026-08-29T12:00:00.000Z'),
      }),
      article('published', { publishedAt: new Date('2026-08-29T00:00:00.000Z') }),
    ];
    const picks = selectAutomaticTopStories(pool, new Set(), 5);
    expect(picks.map((a) => a.id)).toEqual(['scheduled', 'published']);
  });

  it('caps VIDEO/HIGHLIGHT items at 2 when enough ARTICLE inventory exists', () => {
    const pool = [
      article('v1', { contentType: 'VIDEO', publishedAt: new Date('2026-08-29T12:00:00.000Z') }),
      article('v2', { contentType: 'VIDEO', publishedAt: new Date('2026-08-29T11:00:00.000Z') }),
      article('v3', {
        contentType: 'HIGHLIGHT',
        publishedAt: new Date('2026-08-29T10:00:00.000Z'),
      }),
      article('a1', { contentType: 'ARTICLE', publishedAt: new Date('2026-08-29T09:00:00.000Z') }),
      article('a2', { contentType: 'ARTICLE', publishedAt: new Date('2026-08-29T08:00:00.000Z') }),
      article('a3', { contentType: 'ARTICLE', publishedAt: new Date('2026-08-29T07:00:00.000Z') }),
      article('a4', { contentType: 'ARTICLE', publishedAt: new Date('2026-08-29T06:00:00.000Z') }),
    ];
    // Enough ARTICLE inventory exists to fill all 6 requested slots without
    // ever needing v3, so the cap holds and v3 is excluded entirely rather
    // than appended once the other slots are already full.
    const picks = selectAutomaticTopStories(pool, new Set(), 6);
    expect(picks.map((a) => a.id)).toEqual(['v1', 'v2', 'a1', 'a2', 'a3', 'a4']);
    expect(picks.filter((a) => a.contentType !== 'ARTICLE')).toHaveLength(2);
  });

  it('caps repeats of the same sourceName at 2 when alternatives exist, never capping null (staff) sources', () => {
    const pool = [
      article('s1', { sourceName: 'PFT', publishedAt: new Date('2026-08-29T12:00:00.000Z') }),
      article('s2', { sourceName: 'PFT', publishedAt: new Date('2026-08-29T11:00:00.000Z') }),
      article('s3', { sourceName: 'PFT', publishedAt: new Date('2026-08-29T10:00:00.000Z') }),
      article('staff1', { sourceName: null, publishedAt: new Date('2026-08-29T09:00:00.000Z') }),
      article('staff2', { sourceName: null, publishedAt: new Date('2026-08-29T08:00:00.000Z') }),
      article('other', { sourceName: 'CBS', publishedAt: new Date('2026-08-29T07:00:00.000Z') }),
    ];
    const picks = selectAutomaticTopStories(pool, new Set(), 5);
    expect(picks.map((a) => a.id)).toEqual(['s1', 's2', 'staff1', 'staff2', 'other']);
  });

  it('fills remaining slots by pure freshness rather than leaving them empty when the pool is sparse', () => {
    const pool = [
      article('v1', {
        contentType: 'VIDEO',
        sourceName: 'PFT',
        publishedAt: new Date('2026-08-29T12:00:00.000Z'),
      }),
      article('v2', {
        contentType: 'VIDEO',
        sourceName: 'PFT',
        publishedAt: new Date('2026-08-29T11:00:00.000Z'),
      }),
      article('v3', {
        contentType: 'VIDEO',
        sourceName: 'PFT',
        publishedAt: new Date('2026-08-29T10:00:00.000Z'),
      }),
    ];
    // Only VIDEO/PFT inventory exists -- both soft caps would otherwise stop
    // at 2, but the requested count of 3 must still be met from what's
    // actually available rather than returned short.
    const picks = selectAutomaticTopStories(pool, new Set(), 3);
    expect(picks.map((a) => a.id)).toEqual(['v1', 'v2', 'v3']);
  });
});

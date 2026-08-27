import { describe, expect, it } from 'vitest';

import type { HighlightlyHighlight } from '../../evaluation/highlightly/highlightly-schemas.js';
import { normalizeHighlightlyHighlight } from './highlightly-highlight-normalizer.js';

function highlight(overrides: Partial<HighlightlyHighlight> = {}): HighlightlyHighlight {
  return {
    id: 105170,
    type: 'VERIFIED',
    imgUrl: 'https://i.ytimg.com/vi/oaMBTMAdkW8/hqdefault.jpg',
    title: 'Philadelphia Eagles vs. New England Patriots | 2026 Preseason Week 2',
    description: null,
    url: 'https://www.youtube.com/watch?v=oaMBTMAdkW8',
    embedUrl: 'https://www.youtube.com/embed/oaMBTMAdkW8',
    channel: 'NFL',
    source: 'youtube',
    category: 'other',
    match: { id: 566033, league: 'NFL', season: 2026, date: null, round: 'preseason' },
    ...overrides,
  };
}

describe('normalizeHighlightlyHighlight', () => {
  it('maps a real, complete highlight', () => {
    const normalized = normalizeHighlightlyHighlight(highlight());
    expect(normalized).toEqual({
      providerHighlightKey: '105170',
      title: 'Philadelphia Eagles vs. New England Patriots | 2026 Preseason Week 2',
      description: null,
      highlightType: 'GAME',
      thumbnailUrl: 'https://i.ytimg.com/vi/oaMBTMAdkW8/hqdefault.jpg',
      canonicalUrl: 'https://www.youtube.com/watch?v=oaMBTMAdkW8',
      embedUrl: 'https://www.youtube.com/embed/oaMBTMAdkW8',
      publishedAt: null,
    });
  });

  it('always classifies as GAME regardless of the provider category field', () => {
    // Real Highlightly data never populates category usefully (always "other"),
    // so highlightType is deterministic, not derived from it.
    const normalized = normalizeHighlightlyHighlight(highlight({ category: 'touchdown-pass' }));
    expect(normalized.highlightType).toBe('GAME');
  });

  it('normalizes a stringified numeric ID to the same identity as a real number', () => {
    const numeric = normalizeHighlightlyHighlight(highlight({ id: 105170 }));
    const stringy = normalizeHighlightlyHighlight(highlight({ id: '105170' }));
    expect(numeric.providerHighlightKey).toBe(stringy.providerHighlightKey);
  });

  it('handles missing optional metadata safely', () => {
    const normalized = normalizeHighlightlyHighlight(
      highlight({ description: null, imgUrl: null, url: null, embedUrl: null }),
    );
    expect(normalized.description).toBeNull();
    expect(normalized.thumbnailUrl).toBeNull();
    expect(normalized.canonicalUrl).toBeNull();
    expect(normalized.embedUrl).toBeNull();
  });

  it('trims blank description to null rather than an empty string', () => {
    const normalized = normalizeHighlightlyHighlight(highlight({ description: '   ' }));
    expect(normalized.description).toBeNull();
  });

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['http://insecure.example.com/video.jpg'],
    ['not a url'],
  ])('rejects an unsafe or non-https URL (%s) rather than persisting it', (unsafeUrl) => {
    const normalized = normalizeHighlightlyHighlight(
      highlight({ imgUrl: unsafeUrl, url: unsafeUrl, embedUrl: unsafeUrl }),
    );
    expect(normalized.thumbnailUrl).toBeNull();
    expect(normalized.canonicalUrl).toBeNull();
    expect(normalized.embedUrl).toBeNull();
  });

  it('never invents a publish timestamp from the game date', () => {
    const normalized = normalizeHighlightlyHighlight(
      highlight({ match: { id: 566033, date: '2026-08-22T23:00:00.000Z' } }),
    );
    expect(normalized.publishedAt).toBeNull();
  });
});

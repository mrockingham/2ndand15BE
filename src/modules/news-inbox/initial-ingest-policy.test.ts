import { describe, expect, it } from 'vitest';

import type { NormalizedFeedEntry } from './feed-parser.js';
import { classifyInitialIngestEntries, isLateOutOfOrderEntry } from './initial-ingest-policy.js';

const NOW = new Date('2026-08-25T12:00:00.000Z');

function entry(overrides: Partial<NormalizedFeedEntry> & { canonicalUrl: string }): NormalizedFeedEntry {
  return {
    externalId: null,
    headline: 'Fixture headline',
    description: null,
    author: null,
    publishedAt: null,
    thumbnailUrl: null,
    ...overrides,
    canonicalUrlHash: overrides.canonicalUrl,
  };
}

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

describe('classifyInitialIngestEntries', () => {
  it('keeps only entries within the lookback window and buckets the rest', () => {
    const recent = entry({ canonicalUrl: 'https://example.com/recent', publishedAt: hoursAgo(1) });
    const borderline = entry({
      canonicalUrl: 'https://example.com/borderline',
      publishedAt: hoursAgo(71),
    });
    const stale = entry({ canonicalUrl: 'https://example.com/stale', publishedAt: hoursAgo(200) });
    const dateless = entry({ canonicalUrl: 'https://example.com/dateless', publishedAt: null });

    const result = classifyInitialIngestEntries([recent, borderline, stale, dateless], NOW, {
      lookbackHours: 72,
      maxItemsPerSource: 25,
    });

    expect(result.eligible).toEqual([recent, borderline]);
    expect(result.outsideLookback).toEqual([stale]);
    expect(result.missingPublishedAt).toEqual([dateless]);
    expect(result.truncated).toEqual([]);
  });

  it('never imports a dateless item blindly, even when the feed has plenty of room under the cap', () => {
    const dateless = entry({ canonicalUrl: 'https://example.com/dateless', publishedAt: null });
    const result = classifyInitialIngestEntries([dateless], NOW, {
      lookbackHours: 72,
      maxItemsPerSource: 25,
    });
    expect(result.eligible).toEqual([]);
    expect(result.missingPublishedAt).toEqual([dateless]);
  });

  it('caps eligible entries deterministically, keeping the newest first and reporting the overflow', () => {
    const items = [3, 1, 5, 2, 4].map((hoursOld) =>
      entry({ canonicalUrl: `https://example.com/item-${String(hoursOld)}`, publishedAt: hoursAgo(hoursOld) }),
    );
    const result = classifyInitialIngestEntries(items, NOW, {
      lookbackHours: 72,
      maxItemsPerSource: 2,
    });

    expect(result.eligible.map((item) => item.canonicalUrl)).toEqual([
      'https://example.com/item-1',
      'https://example.com/item-2',
    ]);
    expect(result.truncated.map((item) => item.canonicalUrl)).toEqual([
      'https://example.com/item-3',
      'https://example.com/item-4',
      'https://example.com/item-5',
    ]);
  });

  it('breaks exact publish-time ties deterministically by canonical URL', () => {
    const sameInstant = hoursAgo(1);
    const b = entry({ canonicalUrl: 'https://example.com/b', publishedAt: sameInstant });
    const a = entry({ canonicalUrl: 'https://example.com/a', publishedAt: sameInstant });
    const result = classifyInitialIngestEntries([b, a], NOW, {
      lookbackHours: 72,
      maxItemsPerSource: 25,
    });
    expect(result.eligible.map((item) => item.canonicalUrl)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });
});

describe('isLateOutOfOrderEntry', () => {
  const policy = { toleranceHours: 48 };

  it('is never late when there is no watermark yet', () => {
    const item = entry({ canonicalUrl: 'https://example.com/x', publishedAt: hoursAgo(500) });
    expect(isLateOutOfOrderEntry(item, null, policy)).toBe(false);
  });

  it('is never late when the entry has no publication date', () => {
    const item = entry({ canonicalUrl: 'https://example.com/x', publishedAt: null });
    expect(isLateOutOfOrderEntry(item, hoursAgo(0), policy)).toBe(false);
  });

  it('flags an entry well behind the watermark plus tolerance', () => {
    const watermark = hoursAgo(0);
    const oldItem = entry({ canonicalUrl: 'https://example.com/old', publishedAt: hoursAgo(200) });
    expect(isLateOutOfOrderEntry(oldItem, watermark, policy)).toBe(true);
  });

  it('does not flag an entry within tolerance of the watermark', () => {
    const watermark = hoursAgo(0);
    const nearby = entry({ canonicalUrl: 'https://example.com/nearby', publishedAt: hoursAgo(40) });
    expect(isLateOutOfOrderEntry(nearby, watermark, policy)).toBe(false);
  });
});

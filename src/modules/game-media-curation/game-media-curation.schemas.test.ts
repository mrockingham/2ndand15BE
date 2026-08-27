import { describe, expect, it } from 'vitest';

import {
  createCuratedVideoSchema,
  gameMediaWeekQuerySchema,
  reorderCuratedVideosSchema,
  updateCuratedVideoSchema,
} from './game-media-curation.schemas.js';

const validInput = {
  title: 'Eagles vs. Patriots | Game Highlights',
  embedUrl: 'https://www.youtube.com/embed/abc123',
};

describe('createCuratedVideoSchema', () => {
  it('accepts a minimal valid input and defaults optional fields to null', () => {
    const result = createCuratedVideoSchema.parse(validInput);
    expect(result).toEqual({
      title: validInput.title,
      embedUrl: validInput.embedUrl,
      canonicalUrl: null,
      thumbnailUrl: null,
      sourceLabel: null,
    });
  });

  it('accepts optional canonicalUrl/thumbnailUrl/sourceLabel when provided', () => {
    const result = createCuratedVideoSchema.parse({
      ...validInput,
      canonicalUrl: 'https://www.youtube.com/watch?v=abc123',
      thumbnailUrl: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
      sourceLabel: 'NFL',
    });
    expect(result.canonicalUrl).toBe('https://www.youtube.com/watch?v=abc123');
    expect(result.sourceLabel).toBe('NFL');
  });

  it('rejects a plain http embed URL', () => {
    expect(() =>
      createCuratedVideoSchema.parse({ ...validInput, embedUrl: 'http://www.youtube.com/embed/x' }),
    ).toThrow();
  });

  it('rejects a javascript: URL', () => {
    expect(() =>
      createCuratedVideoSchema.parse({ ...validInput, embedUrl: 'javascript:alert(1)' }),
    ).toThrow();
  });

  it('rejects a data: URL', () => {
    expect(() =>
      createCuratedVideoSchema.parse({
        ...validInput,
        embedUrl: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      }),
    ).toThrow();
  });

  it('rejects a file: URL', () => {
    expect(() =>
      createCuratedVideoSchema.parse({ ...validInput, embedUrl: 'file:///etc/passwd' }),
    ).toThrow();
  });

  it('rejects raw iframe markup instead of a URL', () => {
    expect(() =>
      createCuratedVideoSchema.parse({
        ...validInput,
        embedUrl: '<iframe src="https://www.youtube.com/embed/x"></iframe>',
      }),
    ).toThrow();
  });

  it('rejects a malformed URL', () => {
    expect(() =>
      createCuratedVideoSchema.parse({ ...validInput, embedUrl: 'not a url at all' }),
    ).toThrow();
  });

  it('rejects an empty title', () => {
    expect(() => createCuratedVideoSchema.parse({ ...validInput, title: '   ' })).toThrow();
  });

  it('rejects unknown fields', () => {
    expect(() =>
      createCuratedVideoSchema.parse({ ...validInput, iframeHtml: '<iframe></iframe>' }),
    ).toThrow();
  });
});

describe('updateCuratedVideoSchema', () => {
  it('accepts a single field update', () => {
    expect(updateCuratedVideoSchema.parse({ title: 'Updated Title' })).toEqual({
      title: 'Updated Title',
    });
  });

  it('accepts explicitly clearing an optional field to null', () => {
    expect(updateCuratedVideoSchema.parse({ sourceLabel: null })).toEqual({ sourceLabel: null });
  });

  it('rejects an empty update body', () => {
    expect(() => updateCuratedVideoSchema.parse({})).toThrow();
  });

  it('rejects an http embed URL on update', () => {
    expect(() =>
      updateCuratedVideoSchema.parse({ embedUrl: 'http://www.youtube.com/embed/x' }),
    ).toThrow();
  });
});

describe('reorderCuratedVideosSchema', () => {
  it('accepts up to 4 video IDs', () => {
    const ids = [
      'a0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000002',
      'a0000000-0000-4000-8000-000000000003',
      'a0000000-0000-4000-8000-000000000004',
    ];
    expect(reorderCuratedVideosSchema.parse({ videoIds: ids }).videoIds).toEqual(ids);
  });

  it('rejects more than 4 video IDs', () => {
    const ids = Array.from(
      { length: 5 },
      (_, i) => `a0000000-0000-4000-8000-00000000000${String(i)}`,
    );
    expect(() => reorderCuratedVideosSchema.parse({ videoIds: ids })).toThrow();
  });

  it('rejects an empty list', () => {
    expect(() => reorderCuratedVideosSchema.parse({ videoIds: [] })).toThrow();
  });
});

describe('gameMediaWeekQuerySchema', () => {
  it('accepts season + seasonType without week', () => {
    const result = gameMediaWeekQuerySchema.parse({ season: '2026', seasonType: 'PRE' });
    expect(result).toEqual({ season: 2026, seasonType: 'PRE' });
  });

  it('accepts season + seasonType + week', () => {
    const result = gameMediaWeekQuerySchema.parse({ season: '2026', seasonType: 'PRE', week: '2' });
    expect(result.week).toBe(2);
  });

  it('rejects an invalid seasonType', () => {
    expect(() =>
      gameMediaWeekQuerySchema.parse({ season: '2026', seasonType: 'OFFSEASON' }),
    ).toThrow();
  });
});

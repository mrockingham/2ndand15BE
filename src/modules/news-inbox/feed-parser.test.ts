import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { parseNewsFeed, sanitizeSourceDescription } from './feed-parser.js';

describe('news feed parser', () => {
  it('normalizes bounded RSS metadata and omits full-content fields', async () => {
    const feed = parseNewsFeed(await fixture('sample-rss.xml'));
    expect(feed.kind).toBe('RSS');
    expect(feed.entries).toHaveLength(2);
    expect(feed.entries[0]).toMatchObject({
      externalId: 'fictional-rss-1',
      headline: 'Buffalo Bills open fictional training session',
      canonicalUrl: 'https://news.example.com/story/one?edition=morning',
      description: 'A short source description.',
      author: 'Fixture Reporter',
    });
    expect(JSON.stringify(feed)).not.toContain('full fictional body');
  });

  it('legacy article fixtures are completely unaffected by media parsing (regression)', async () => {
    const rss = parseNewsFeed(await fixture('sample-rss.xml'));
    expect(rss.entries.every((entry) => entry.thumbnailUrl === null)).toBe(true);
    const atom = parseNewsFeed(await fixture('sample-atom.xml'));
    expect(atom.entries.every((entry) => entry.thumbnailUrl === null)).toBe(true);
  });

  it('captures a media:content thumbnail and a matching image enclosure as the same field', async () => {
    const feed = parseNewsFeed(await fixture('sample-media-rss.xml'));
    expect(feed.entries[0]).toMatchObject({
      externalId: 'fictional-media-1',
      canonicalUrl:
        'https://video.example.com/video/fictional-coach-postgame-press-conference-week-1',
      thumbnailUrl: 'https://static.example.com/image/fictional-thumb-1.jpg',
    });
  });

  it('captures a media:content thumbnail with no enclosure present', async () => {
    const feed = parseNewsFeed(await fixture('sample-media-rss.xml'));
    expect(feed.entries[1]).toMatchObject({
      externalId: 'fictional-media-2',
      thumbnailUrl: 'https://static.example.com/image/fictional-thumb-2.jpg',
    });
  });

  it('never captures a non-image enclosure (e.g. video/mp4) as a thumbnail URL', async () => {
    const feed = parseNewsFeed(await fixture('sample-media-rss.xml'));
    expect(feed.entries[2]).toMatchObject({
      externalId: 'fictional-media-3',
      thumbnailUrl: null,
    });
    expect(JSON.stringify(feed)).not.toContain('fictional-clip.mp4');
  });

  it('leaves thumbnailUrl null when a video item has no media metadata at all', async () => {
    const feed = parseNewsFeed(await fixture('sample-media-rss.xml'));
    expect(feed.entries[3]).toMatchObject({
      externalId: 'fictional-media-4',
      thumbnailUrl: null,
    });
  });

  it('normalizes common Atom fields and alternate links', async () => {
    const feed = parseNewsFeed(await fixture('sample-atom.xml'));
    expect(feed.kind).toBe('ATOM');
    expect(feed.entries[0]).toMatchObject({
      externalId: 'fictional-atom-1',
      canonicalUrl: 'https://atom.example.com/items/one',
      description: 'A bounded Atom summary.',
      author: 'Atom Reporter',
    });
    expect(feed.entries[0]?.publishedAt?.toISOString()).toBe('2026-08-01T15:30:00.000Z');
  });

  it.each([
    [
      'DOCTYPE',
      '<!DOCTYPE rss [<!ENTITY x "boom">]><rss><channel/></rss>',
      'NEWS_FEED_XML_ENTITY_FORBIDDEN',
    ],
    ['malformed XML', '<rss><channel></rss>', 'NEWS_FEED_XML_MALFORMED'],
    [
      'missing title',
      '<rss><channel><item><link>https://example.com/1</link></item></channel></rss>',
      'NEWS_FEED_ENTRY_TITLE_INVALID',
    ],
    [
      'missing URL',
      '<rss><channel><item><title>Missing URL</title></item></channel></rss>',
      'NEWS_FEED_ENTRY_URL_INVALID',
    ],
    [
      'unsafe description',
      '<rss><channel><item><title>Unsafe</title><link>https://example.com/1</link><description><script>alert(1)</script></description></item></channel></rss>',
      'NEWS_SOURCE_DESCRIPTION_UNSAFE',
    ],
    ['control character', '<rss>\u0001</rss>', 'NEWS_FEED_TEXT_INVALID'],
  ])('rejects %s', (_name, xml, code) => {
    expect(() => parseNewsFeed(xml)).toThrow(expect.objectContaining({ code }));
  });

  it('bounds descriptions, strips markup, and rejects executable metadata', () => {
    expect(sanitizeSourceDescription('<p>Hello <b>NFL</b></p>')).toBe('Hello NFL');
    expect(() => sanitizeSourceDescription('<a href="javascript:alert(1)">bad</a>')).toThrow(
      expect.objectContaining({ code: 'NEWS_SOURCE_DESCRIPTION_UNSAFE' }),
    );
  });

  it('enforces entry and nesting limits', () => {
    const twoEntries =
      '<rss><channel><item><title>One</title><link>https://example.com/1</link></item><item><title>Two</title><link>https://example.com/2</link></item></channel></rss>';
    expect(() => parseNewsFeed(twoEntries, 1)).toThrow(
      expect.objectContaining({ code: 'NEWS_FEED_ENTRY_LIMIT_EXCEEDED' }),
    );
    const nested = `${'<a>'.repeat(33)}${'</a>'.repeat(33)}`;
    expect(() => parseNewsFeed(nested)).toThrow();
  });
});

function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

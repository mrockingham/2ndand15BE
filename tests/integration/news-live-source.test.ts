import { describe, expect, it } from 'vitest';

import { SafeFeedClient } from '../../src/modules/news-inbox/feed-client.js';
import { parseNewsFeed } from '../../src/modules/news-inbox/feed-parser.js';

const liveNewsTestEnabled = process.env.RUN_LIVE_NEWS_SOURCE_TESTS === 'true';
const liveFeedUrl = process.env.LIVE_NEWS_FEED_URL;

describe.skipIf(!liveNewsTestEnabled)('opt-in live news source', () => {
  it('fetches and parses one explicitly supplied public RSS or Atom URL without persistence', async () => {
    if (liveFeedUrl === undefined) throw new Error('LIVE_NEWS_FEED_URL is required.');
    const response = await new SafeFeedClient().fetch(liveFeedUrl);
    expect(response.notModified).toBe(false);
    const parsed = parseNewsFeed(response.body ?? '');
    expect(['RSS', 'ATOM']).toContain(parsed.kind);
    expect(parsed.entries.length).toBeGreaterThan(0);
    expect(parsed.entries.length).toBeLessThanOrEqual(100);
  });
});

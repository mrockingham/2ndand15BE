import { describe, expect, it, vi } from 'vitest';

import { SafeFeedClient, type FeedFetch } from './feed-client.js';

describe('safe feed client', () => {
  it('revalidates redirects and rejects private redirect targets', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/feed' } }),
      );
    const client = new SafeFeedClient(fetch, () => Promise.resolve(['93.184.216.34']));
    await expect(client.fetch('https://example.com/feed')).rejects.toMatchObject({
      code: 'NEWS_URL_PRIVATE_DESTINATION',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects DNS answers containing private addresses before fetching', async () => {
    const fetch = vi.fn();
    const client = new SafeFeedClient(fetch, () => Promise.resolve(['93.184.216.34', '10.0.0.1']));
    await expect(client.fetch('https://example.com/feed')).rejects.toMatchObject({
      code: 'NEWS_URL_PRIVATE_DESTINATION',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('enforces byte limits and expected XML content', async () => {
    const large = new Response('x'.repeat(101), {
      headers: { 'content-type': 'application/xml' },
    });
    const client = new SafeFeedClient(
      vi.fn().mockResolvedValue(large),
      () => Promise.resolve(['93.184.216.34']),
      { maximumBytes: 100, maximumRedirects: 1, timeoutMs: 1_000 },
    );
    await expect(client.fetch('https://example.com/feed')).rejects.toMatchObject({
      code: 'NEWS_FEED_RESPONSE_TOO_LARGE',
    });

    const htmlClient = new SafeFeedClient(
      vi
        .fn()
        .mockResolvedValue(
          new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
        ),
      () => Promise.resolve(['93.184.216.34']),
    );
    await expect(htmlClient.fetch('https://example.com/feed')).rejects.toMatchObject({
      code: 'NEWS_FEED_CONTENT_TYPE_INVALID',
    });
  });

  it('sends conditional validators and treats 304 as success', async () => {
    const fetch = vi.fn<FeedFetch>().mockResolvedValue(new Response(null, { status: 304 }));
    const client = new SafeFeedClient(fetch, () => Promise.resolve(['93.184.216.34']));
    await expect(
      client.fetch('https://example.com/feed', {
        etag: '"abc"',
        modified: 'Sat, 01 Aug 2026 00:00:00 GMT',
      }),
    ).resolves.toMatchObject({
      notModified: true,
      bytes: 0,
    });
    const request = fetch.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    expect(headers.get('if-none-match')).toBe('"abc"');
    expect(headers.get('if-modified-since')).toBe('Sat, 01 Aug 2026 00:00:00 GMT');
  });

  it('aborts timed-out requests', async () => {
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    const client = new SafeFeedClient(fetch, () => Promise.resolve(['93.184.216.34']), {
      maximumBytes: 100,
      maximumRedirects: 1,
      timeoutMs: 5,
    });
    await expect(client.fetch('https://example.com/feed')).rejects.toMatchObject({
      code: 'NEWS_FEED_TIMEOUT',
    });
  });
});

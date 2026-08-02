import { describe, expect, it, vi } from 'vitest';

import { highlightlyMatchListResponseSchema } from './highlightly-schemas.js';
import {
  HighlightlyEvaluationHttpClient,
  type HighlightlyFetch,
} from './highlightly-http-client.js';

describe('HighlightlyEvaluationHttpClient', () => {
  it('sends private authentication in a header, validates envelopes, and counts requests', async () => {
    const secret = 'highlightly-private-test-key';
    const fetchImplementation = vi.fn<HighlightlyFetch>().mockImplementation((input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/matches');
      expect(url.searchParams.get('league')).toBe('NFL');
      expect(new Headers(init?.headers).get('x-rapidapi-key')).toBe(secret);
      return Promise.resolve(
        Response.json(emptyMatchPage(), {
          headers: {
            'x-ratelimit-requests-limit': '100',
            'x-ratelimit-requests-remaining': '99',
          },
        }),
      );
    });
    const client = createClient({ apiKey: secret, fetchImplementation });

    await expect(
      client.get('/matches', { league: 'NFL' }, highlightlyMatchListResponseSchema),
    ).resolves.toEqual(emptyMatchPage());
    expect(client.getRequestCount()).toBe(1);
    expect(client.getRateLimitObservation()).toEqual({ limit: 100, remaining: 99 });
  });

  it('rejects malformed response envelopes without leaking keys, headers, or URLs', async () => {
    const secret = 'highlightly-secret-not-for-errors';
    const client = createClient({
      apiKey: secret,
      fetchImplementation: () => Promise.resolve(Response.json({ data: 'not-an-array' })),
    });

    let caught: unknown;
    try {
      await client.get('/matches', { league: 'NFL' }, highlightlyMatchListResponseSchema);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'INVALID_RESPONSE' });
    const serialized = JSON.stringify(caught);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('x-rapidapi-key');
    expect(serialized).not.toContain('https://example.test');
  });

  it('times out an aborted request and counts the attempted call', async () => {
    const fetchImplementation: HighlightlyFetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    const client = createClient({ fetchImplementation, requestTimeoutMs: 10 });

    await expect(
      client.get('/matches', { league: 'NFL' }, highlightlyMatchListResponseSchema),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(client.getRequestCount()).toBe(1);
  });

  it('honors Retry-After for HTTP 429 and keeps retries bounded', async () => {
    const fetchImplementation = vi
      .fn<HighlightlyFetch>()
      .mockResolvedValue(
        Response.json({ message: 'limited' }, { status: 429, headers: { 'retry-after': '2' } }),
      );
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue();
    const client = createClient({ fetchImplementation, sleep, maxRetries: 1 });

    await expect(
      client.get('/matches', { league: 'NFL' }, highlightlyMatchListResponseSchema),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(client.getRequestCount()).toBe(2);
  });

  it('does not retry invalid credentials or invalid request parameters', async () => {
    const fetchImplementation = vi
      .fn<HighlightlyFetch>()
      .mockResolvedValueOnce(Response.json({ message: 'denied' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ message: 'bad query' }, { status: 400 }));
    const client = createClient({ fetchImplementation, maxRetries: 3 });

    await expect(
      client.get('/matches', { league: 'NFL' }, highlightlyMatchListResponseSchema),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    await expect(
      client.get('/matches', { league: 'NFL' }, highlightlyMatchListResponseSchema),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('retries transient server failures only up to the configured limit', async () => {
    const fetchImplementation = vi
      .fn<HighlightlyFetch>()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({}, { status: 502 }))
      .mockResolvedValueOnce(Response.json(emptyMatchPage()));
    const client = createClient({
      fetchImplementation,
      maxRetries: 2,
      sleep: () => Promise.resolve(),
    });

    await expect(
      client.get('/matches', { league: 'NFL' }, highlightlyMatchListResponseSchema),
    ).resolves.toEqual(emptyMatchPage());
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(client.getRequestCount()).toBe(3);
  });
});

function createClient(
  overrides: Partial<ConstructorParameters<typeof HighlightlyEvaluationHttpClient>[0]> = {},
): HighlightlyEvaluationHttpClient {
  return new HighlightlyEvaluationHttpClient({
    baseUrl: 'https://example.test',
    apiKey: 'test-key',
    requestTimeoutMs: 1_000,
    maxRetries: 0,
    sleep: () => Promise.resolve(),
    random: () => 0,
    ...overrides,
  });
}

function emptyMatchPage() {
  return {
    data: [],
    pagination: { totalCount: 0, offset: 0, limit: 100 },
    plan: { tier: 'BASIC' },
  };
}

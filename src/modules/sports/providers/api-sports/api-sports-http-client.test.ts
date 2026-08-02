import { describe, expect, it, vi } from 'vitest';

import { ApiSportsHttpClient, type ApiSportsFetch } from './api-sports-http-client.js';

describe('ApiSportsHttpClient', () => {
  it('times out requests and does not retry when maxRetries is zero', async () => {
    const fetchImplementation: ApiSportsFetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    const client = createClient({ fetchImplementation, requestTimeoutMs: 10 });
    await expect(client.get('games', {})).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });

  it('respects Retry-After for HTTP 429 and reports exhausted rate limits', async () => {
    const fetchImplementation = vi
      .fn<ApiSportsFetch>()
      .mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '2' } }));
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue();
    const client = createClient({ fetchImplementation, sleep, maxRetries: 1 });

    await expect(client.get('games', {})).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('limits transient HTTP retries and succeeds when a later attempt recovers', async () => {
    const fetchImplementation = vi
      .fn<ApiSportsFetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 502 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue();
    const client = createClient({ fetchImplementation, sleep, maxRetries: 2 });

    await expect(client.get('games', {})).resolves.toEqual({ ok: true });
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('keeps the API key absent from warnings and public error fields', async () => {
    const secret = 'provider-secret-that-must-not-leak';
    const warn = vi.fn();
    const fetchImplementation = vi
      .fn<ApiSportsFetch>()
      .mockRejectedValue(new Error('network down'));
    const client = new ApiSportsHttpClient({
      baseUrl: 'https://example.test',
      apiKey: secret,
      requestTimeoutMs: 1_000,
      maxRetries: 1,
      fetchImplementation,
      sleep: () => Promise.resolve(),
      random: () => 0,
      logger: { warn },
    });

    let caught: unknown;
    try {
      await client.get('games', { league: 1 });
    } catch (error: unknown) {
      caught = error;
    }
    const serializedError = JSON.stringify(caught);
    const serializedWarnings = JSON.stringify(warn.mock.calls);
    expect(serializedError).not.toContain(secret);
    expect(serializedError).not.toContain('x-apisports-key');
    expect(serializedError).not.toContain('https://example.test');
    expect(serializedWarnings).not.toContain(secret);
    expect(serializedWarnings).not.toContain('x-apisports-key');
  });
});

function createClient(
  overrides: Partial<ConstructorParameters<typeof ApiSportsHttpClient>[0]> = {},
): ApiSportsHttpClient {
  return new ApiSportsHttpClient({
    baseUrl: 'https://example.test',
    apiKey: 'test-key',
    requestTimeoutMs: 1_000,
    maxRetries: 0,
    sleep: () => Promise.resolve(),
    random: () => 0,
    ...overrides,
  });
}

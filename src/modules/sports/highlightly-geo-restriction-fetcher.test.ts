import { describe, expect, it, vi } from 'vitest';

import {
  HighlightlyEvaluationHttpClient,
  type HighlightlyFetch,
} from './evaluation/highlightly/highlightly-http-client.js';
import { createHighlightlyGeoRestrictionFetcher } from './highlightly-geo-restriction-fetcher.js';

function createClient(fetchImplementation: HighlightlyFetch): HighlightlyEvaluationHttpClient {
  return new HighlightlyEvaluationHttpClient({
    baseUrl: 'https://example.test',
    apiKey: 'test-key',
    requestTimeoutMs: 1_000,
    maxRetries: 0,
    fetchImplementation,
  });
}

describe('createHighlightlyGeoRestrictionFetcher', () => {
  it('calls /highlights/geo-restrictions/{id} with the highlight id as a path segment', async () => {
    const fetchImplementation = vi.fn<HighlightlyFetch>().mockImplementation((input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/highlights/geo-restrictions/105170');
      return Promise.resolve(
        Response.json({
          state: 'No restricitons applied',
          embeddable: true,
          allowedCountries: [],
          blockedCountries: [],
        }),
      );
    });
    const fetcher = createHighlightlyGeoRestrictionFetcher(createClient(fetchImplementation));

    const result = await fetcher.fetch('105170');
    expect(result.failureReason).toBeNull();
    expect(result.restriction).toEqual({
      state: 'No restricitons applied',
      embeddable: true,
      allowedCountries: [],
      blockedCountries: [],
    });
  });

  it('never throws -- a provider failure becomes a sanitized failureReason', async () => {
    const fetcher = createHighlightlyGeoRestrictionFetcher(
      createClient(() => Promise.resolve(new Response(null, { status: 500 }))),
    );

    const result = await fetcher.fetch('105170');
    expect(result.restriction).toBeNull();
    expect(result.failureReason).toBe('HTTP_ERROR');
  });

  it('URL-encodes the highlight id', async () => {
    const fetchImplementation = vi.fn<HighlightlyFetch>().mockImplementation((input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/highlights/geo-restrictions/abc%2Fdef');
      return Promise.resolve(
        Response.json({
          state: 'ok',
          embeddable: true,
          allowedCountries: [],
          blockedCountries: [],
        }),
      );
    });
    const fetcher = createHighlightlyGeoRestrictionFetcher(createClient(fetchImplementation));
    await fetcher.fetch('abc/def');
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});

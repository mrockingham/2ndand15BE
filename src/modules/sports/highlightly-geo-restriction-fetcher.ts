import { HighlightlyEvaluationError } from './evaluation/highlightly/highlightly-http-client.js';
import type { HighlightlyEvaluationHttpClient } from './evaluation/highlightly/highlightly-http-client.js';
import {
  highlightlyGeoRestrictionsSchema,
  type HighlightlyGeoRestrictions,
} from './evaluation/highlightly/highlightly-schemas.js';

export interface GeoRestrictionFetchResult {
  readonly restriction: HighlightlyGeoRestrictions | null;
  readonly failureReason: string | null;
}

export interface GeoRestrictionFetcher {
  fetch(providerHighlightKey: string): Promise<GeoRestrictionFetchResult>;
}

/**
 * M31C: the `/highlights/geo-restrictions/{id}` lookup documented (but not yet
 * called) in docs/current-season-games/highlightly-highlights-2026-08-25.md
 * section 1. `{id}` is a path segment, not a query parameter, so it is
 * interpolated directly -- `providerHighlightKey` always originates from a
 * Highlightly-supplied highlight `id` already round-tripped through
 * `String()` by `normalizeHighlightlyHighlight`, never from user input.
 * Failures never throw: embed-eligibility evaluation must degrade to a safe
 * "do not embed" outcome rather than fail the highlight sync it runs inside.
 */
export function createHighlightlyGeoRestrictionFetcher(
  client: HighlightlyEvaluationHttpClient,
): GeoRestrictionFetcher {
  return {
    async fetch(providerHighlightKey) {
      try {
        const restriction = await client.get(
          `/highlights/geo-restrictions/${encodeURIComponent(providerHighlightKey)}`,
          {},
          highlightlyGeoRestrictionsSchema,
        );
        return { restriction, failureReason: null };
      } catch (error: unknown) {
        const failureReason = error instanceof HighlightlyEvaluationError ? error.code : 'OTHER';
        return { restriction: null, failureReason };
      }
    },
  };
}

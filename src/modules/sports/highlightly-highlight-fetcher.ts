import type { HighlightlyEvaluationHttpClient } from './evaluation/highlightly/highlightly-http-client.js';
import {
  highlightlyHighlightSchema,
  highlightlyRawHighlightsResponseSchema,
  type HighlightlyHighlight,
} from './evaluation/highlightly/highlightly-schemas.js';

export interface HighlightFetchResult {
  readonly highlights: readonly HighlightlyHighlight[] | null;
  readonly failureReason: string | null;
}

export interface HighlightFetcher {
  fetch(providerGameId: string): Promise<HighlightFetchResult>;
}

const HIGHLIGHTS_LIMIT = 40;

/**
 * The single `/highlights?matchId={id}` fetch for M31 game-highlight sync/diagnostics.
 * `/highlights` is a dedicated endpoint, never embedded in `/matches/{id}` (confirmed
 * live 2026-08-25), so this is a genuinely separate request from
 * `createHighlightlyMatchDetailFetcher` -- one request per game, reusing the same
 * `HighlightlyEvaluationHttpClient` (auth/retry/timeout/rate-limit) rather than a
 * second HTTP stack. Each returned item's `match.id` is verified against the
 * requested `providerGameId` so an unrelated highlight can never be attributed to
 * the wrong game.
 */
export function createHighlightlyHighlightFetcher(
  client: HighlightlyEvaluationHttpClient,
): HighlightFetcher {
  return {
    async fetch(providerGameId) {
      const payload = await client.get(
        '/highlights',
        { matchId: providerGameId, limit: HIGHLIGHTS_LIMIT },
        highlightlyRawHighlightsResponseSchema,
      );
      const highlights: HighlightlyHighlight[] = [];
      for (const raw of payload.data) {
        const parsed = highlightlyHighlightSchema.safeParse(raw);
        if (!parsed.success) return { highlights: null, failureReason: 'Highlight failed validation.' };
        if (parsed.data.match !== undefined && String(parsed.data.match.id) !== providerGameId) {
          return { highlights: null, failureReason: 'Highlight match identity mismatch.' };
        }
        highlights.push(parsed.data);
      }
      return { highlights, failureReason: null };
    },
  };
}

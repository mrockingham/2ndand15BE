import type { HighlightlyEvaluationHttpClient } from './evaluation/highlightly/highlightly-http-client.js';
import {
  highlightlyDetailedMatchSchema,
  highlightlyRawMatchDetailResponseSchema,
} from './evaluation/highlightly/highlightly-schemas.js';
import type { MatchDetailFetcher } from './live-game-validation.js';

/**
 * The single `/matches/{id}` fetch shared by team-stat and play observation, whether the
 * caller is the diagnostic live-validation harness or the M27 active-game poller. Neither
 * caller re-implements Highlightly parsing: this only performs the HTTP GET and the same
 * schema/identity validation `HighlightlyCurrentGamePlayProvider`/`HighlightlyCurrentGameDetailsProvider`
 * already do; the real normalizer functions (`normalizeHighlightlyCurrentGamePlays`,
 * `normalizeHighlightlyCurrentGameDetails`) are applied by the caller against this one payload.
 */
export function createHighlightlyMatchDetailFetcher(
  client: HighlightlyEvaluationHttpClient,
): MatchDetailFetcher {
  return {
    async fetch(providerGameId) {
      const payload = await client.get(
        `/matches/${providerGameId}`,
        {},
        highlightlyRawMatchDetailResponseSchema,
      );
      const parsed = highlightlyDetailedMatchSchema.safeParse(payload[0]);
      if (!parsed.success || String(parsed.data.id) !== providerGameId) {
        return { detail: null, failureReason: 'Detailed match failed validation.' };
      }
      return { detail: parsed.data, failureReason: null };
    },
  };
}

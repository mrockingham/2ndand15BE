import type { HighlightlyEvaluationHttpClient } from './evaluation/highlightly/highlightly-http-client.js';
import {
  highlightlyBoxScoreResponseSchema,
  type HighlightlyBoxScoreResponse,
} from './evaluation/highlightly/highlightly-schemas.js';

export interface BoxScoreFetchResult {
  readonly boxScore: HighlightlyBoxScoreResponse | null;
  readonly failureReason: string | null;
  readonly requestsUsed: number;
}

/** Narrow provider-edge port used only when the independent player-stat cadence is due. */
export interface BoxScoreFetcher {
  fetch(providerGameId: string): Promise<BoxScoreFetchResult>;
}

export function createHighlightlyBoxScoreFetcher(
  client: HighlightlyEvaluationHttpClient,
): BoxScoreFetcher {
  return {
    async fetch(providerGameId) {
      const requestsBefore = client.getRequestCount();
      try {
        const boxScore = await client.get(
          `/box-score/${providerGameId}`,
          {},
          highlightlyBoxScoreResponseSchema,
        );
        return {
          boxScore,
          failureReason: null,
          requestsUsed: client.getRequestCount() - requestsBefore,
        };
      } catch (error: unknown) {
        return {
          boxScore: null,
          failureReason: error instanceof Error ? error.message : 'Box score was unavailable.',
          requestsUsed: client.getRequestCount() - requestsBefore,
        };
      }
    },
  };
}

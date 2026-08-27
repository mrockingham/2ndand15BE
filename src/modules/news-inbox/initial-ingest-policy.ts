import type { NormalizedFeedEntry } from './feed-parser.js';

/**
 * M30D: the first time a source is ever ingested for real, an RSS/Atom feed can
 * legitimately contain weeks or months of history. Importing all of it would flood
 * the editorial inbox the moment a long-paused official-team source is activated.
 * These bounds apply only to that one-time initial ingest -- a source is "initial"
 * exactly when it has never written a real `NewsCandidate` row, which is a durable,
 * restart-safe signal already implied by existing data (deliberately not
 * `NewsSource.lastSuccessfulAt`, since a no-write `testSource` dry run also
 * completes successfully and must not count as a real first ingest). Steady-state
 * ingestion after that first real write is unbounded by this policy and relies on
 * existing identity/dedupe behavior instead.
 */
export interface InitialIngestPolicyConfig {
  readonly lookbackHours: number;
  readonly maxItemsPerSource: number;
}

export interface InitialIngestClassification {
  readonly eligible: readonly NormalizedFeedEntry[];
  readonly outsideLookback: readonly NormalizedFeedEntry[];
  readonly missingPublishedAt: readonly NormalizedFeedEntry[];
  readonly truncated: readonly NormalizedFeedEntry[];
}

export function classifyInitialIngestEntries(
  entries: readonly NormalizedFeedEntry[],
  now: Date,
  policy: InitialIngestPolicyConfig,
): InitialIngestClassification {
  const cutoff = now.getTime() - policy.lookbackHours * 3_600_000;
  const missingPublishedAt: NormalizedFeedEntry[] = [];
  const outsideLookback: NormalizedFeedEntry[] = [];
  const withinLookback: NormalizedFeedEntry[] = [];
  for (const entry of entries) {
    if (entry.publishedAt === null) {
      missingPublishedAt.push(entry);
      continue;
    }
    if (entry.publishedAt.getTime() < cutoff) {
      outsideLookback.push(entry);
      continue;
    }
    withinLookback.push(entry);
  }
  const sorted = [...withinLookback].sort((a, b) => {
    const byDate = (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
    return byDate !== 0 ? byDate : a.canonicalUrl.localeCompare(b.canonicalUrl);
  });
  return {
    eligible: sorted.slice(0, policy.maxItemsPerSource),
    truncated: sorted.slice(policy.maxItemsPerSource),
    outsideLookback,
    missingPublishedAt,
  };
}

/**
 * M30D: guards steady-state ingestion (after a source's initial ingest has
 * completed) against a feed that reorders itself and surfaces an old item this
 * source has never seen before -- e.g. an old article resurfacing at the top of a
 * feed. `watermark` is the newest `sourcePublishedAt` this source has ever
 * persisted (derived from existing `NewsCandidate` rows, not new schema state).
 * An entry this far behind the watermark is only treated as "late" when it is
 * genuinely new; an already-known item (identified by external ID or canonical
 * URL) always continues to update normally regardless of its date.
 */
export interface LateItemPolicyConfig {
  readonly toleranceHours: number;
}

export function isLateOutOfOrderEntry(
  entry: NormalizedFeedEntry,
  watermark: Date | null,
  policy: LateItemPolicyConfig,
): boolean {
  if (watermark === null || entry.publishedAt === null) return false;
  const cutoff = watermark.getTime() - policy.toleranceHours * 3_600_000;
  return entry.publishedAt.getTime() < cutoff;
}

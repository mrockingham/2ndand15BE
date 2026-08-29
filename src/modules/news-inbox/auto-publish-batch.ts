import type { AutoPublishCandidateRecord } from './news.dto.js';
import {
  evaluateAutoPublishEligibility,
  type AutoPublishPolicy,
  type AutoPublishRejectionReason,
} from './auto-publish-eligibility.js';

/**
 * M42B: applies the per-run and per-source caps (ticket §Q) on top of the
 * per-candidate eligibility rules, in the pool's existing order (oldest
 * `sourcePublishedAt` first -- see `listAutoPublishCandidatePool`). Pure and
 * side-effect free so both the real auto-publish pass and its dry-run
 * preview share one implementation and can never disagree about which
 * candidates would be selected.
 */

export interface AutoPublishBatchLimits {
  readonly maxPerRun: number;
  readonly maxPerSourcePerRun: number;
}

export type AutoPublishBatchReason =
  AutoPublishRejectionReason | 'PER_RUN_CAP_REACHED' | 'PER_SOURCE_CAP_REACHED';

export interface AutoPublishBatchItem {
  readonly candidate: AutoPublishCandidateRecord;
  readonly shouldPublish: boolean;
  readonly reason: AutoPublishBatchReason | null;
}

export function evaluateAutoPublishBatch(
  pool: readonly AutoPublishCandidateRecord[],
  now: Date,
  policy: AutoPublishPolicy,
  limits: AutoPublishBatchLimits,
): readonly AutoPublishBatchItem[] {
  const items: AutoPublishBatchItem[] = [];
  const perSourceCount = new Map<string, number>();
  let totalCount = 0;

  for (const candidate of pool) {
    // Structurally unreachable given listAutoPublishCandidatePool's
    // relation filter (a NEW candidate matching an ACTIVE/ARTICLE/non-
    // MANUAL_ONLY source always has a non-null source) -- kept as a defensive
    // guard since NewsCandidate.sourceId is a nullable, SetNull-on-delete FK.
    if (candidate.source === null) {
      items.push({ candidate, shouldPublish: false, reason: 'SOURCE_NOT_ACTIVE' });
      continue;
    }
    const result = evaluateAutoPublishEligibility(candidate.source, candidate, now, policy);
    if (!result.eligible) {
      items.push({ candidate, shouldPublish: false, reason: result.reason });
      continue;
    }
    if (totalCount >= limits.maxPerRun) {
      items.push({ candidate, shouldPublish: false, reason: 'PER_RUN_CAP_REACHED' });
      continue;
    }
    const sourceCount = perSourceCount.get(candidate.source.id) ?? 0;
    if (sourceCount >= limits.maxPerSourcePerRun) {
      items.push({ candidate, shouldPublish: false, reason: 'PER_SOURCE_CAP_REACHED' });
      continue;
    }
    perSourceCount.set(candidate.source.id, sourceCount + 1);
    totalCount += 1;
    items.push({ candidate, shouldPublish: true, reason: null });
  }
  return items;
}

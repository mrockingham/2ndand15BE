import { describe, expect, it } from 'vitest';

import type { AutoPublishPolicy } from './auto-publish-eligibility.js';
import { evaluateAutoPublishBatch, type AutoPublishBatchLimits } from './auto-publish-batch.js';
import type { AutoPublishCandidateRecord } from './news.dto.js';

const POLICY: AutoPublishPolicy = { maxAgeHours: 24, minDescriptionLength: 40 };
const NOW = new Date('2026-08-29T12:00:00.000Z');

function candidate(
  id: string,
  overrides: Omit<Partial<AutoPublishCandidateRecord>, 'source'> & {
    readonly source?: Partial<NonNullable<AutoPublishCandidateRecord['source']>> | null;
  } = {},
): AutoPublishCandidateRecord {
  const { source: sourceOverride, ...rest } = overrides;
  return {
    id,
    sourceId: 'source-1',
    sourceNameSnapshot: 'Fictional Source',
    sourceExternalId: `ext-${id}`,
    canonicalUrl: `https://news.example.com/story/${id}`,
    canonicalUrlHash: `hash-${id}`,
    headline: `Fictional headline ${id}`,
    sourceDescription: 'A fictional forty-plus character description used for testing purposes.',
    sourceAuthor: null,
    contentType: 'ARTICLE',
    mediaThumbnailUrl: null,
    sourcePublishedAt: new Date('2026-08-29T06:00:00.000Z'),
    discoveredAt: new Date('2026-08-29T06:05:00.000Z'),
    status: 'NEW',
    dismissalReason: null,
    convertedArticleId: null,
    reviewedById: null,
    reviewedBySnapshot: null,
    reviewedAt: null,
    createdAt: new Date('2026-08-29T06:05:00.000Z'),
    updatedAt: new Date('2026-08-29T06:05:00.000Z'),
    suggestedTeams: [],
    source:
      sourceOverride === null
        ? null
        : {
            id: 'source-1',
            slug: 'fictional-source',
            status: 'ACTIVE',
            kind: 'RSS',
            contentType: 'ARTICLE',
            autoPublishArticles: true,
            allowsDescriptionUse: true,
            isOfficialTeam: false,
            ...sourceOverride,
          },
    ...rest,
  } as unknown as AutoPublishCandidateRecord;
}

const LIMITS: AutoPublishBatchLimits = { maxPerRun: 20, maxPerSourcePerRun: 10 };

describe('evaluateAutoPublishBatch', () => {
  it('publishes every eligible candidate when limits are not reached', () => {
    const pool = [candidate('a'), candidate('b')];
    const result = evaluateAutoPublishBatch(pool, NOW, POLICY, LIMITS);
    expect(result.map((r) => ({ id: r.candidate.id, shouldPublish: r.shouldPublish }))).toEqual([
      { id: 'a', shouldPublish: true },
      { id: 'b', shouldPublish: true },
    ]);
  });

  it('carries through the per-candidate rejection reason unchanged', () => {
    const pool = [candidate('a', { sourceDescription: 'too short' })];
    const result = evaluateAutoPublishBatch(pool, NOW, POLICY, LIMITS);
    expect(result).toEqual([
      { candidate: pool[0], shouldPublish: false, reason: 'DESCRIPTION_TOO_SHORT' },
    ]);
  });

  it('stops selecting once the global per-run cap is reached, in pool order', () => {
    const pool = [candidate('a'), candidate('b'), candidate('c')];
    const result = evaluateAutoPublishBatch(pool, NOW, POLICY, { ...LIMITS, maxPerRun: 2 });
    expect(
      result.map((r) => ({ id: r.candidate.id, shouldPublish: r.shouldPublish, reason: r.reason })),
    ).toEqual([
      { id: 'a', shouldPublish: true, reason: null },
      { id: 'b', shouldPublish: true, reason: null },
      { id: 'c', shouldPublish: false, reason: 'PER_RUN_CAP_REACHED' },
    ]);
  });

  it('stops selecting from a source once its per-source cap is reached, but keeps selecting from other sources', () => {
    const pool = [
      candidate('a', { source: { id: 'source-1' } }),
      candidate('b', { source: { id: 'source-1' } }),
      candidate('c', { source: { id: 'source-1' } }),
      candidate('d', { source: { id: 'source-2' } }),
    ];
    const result = evaluateAutoPublishBatch(pool, NOW, POLICY, {
      ...LIMITS,
      maxPerSourcePerRun: 2,
    });
    expect(
      result.map((r) => ({ id: r.candidate.id, shouldPublish: r.shouldPublish, reason: r.reason })),
    ).toEqual([
      { id: 'a', shouldPublish: true, reason: null },
      { id: 'b', shouldPublish: true, reason: null },
      { id: 'c', shouldPublish: false, reason: 'PER_SOURCE_CAP_REACHED' },
      { id: 'd', shouldPublish: true, reason: null },
    ]);
  });

  it('an ineligible candidate never consumes cap budget', () => {
    const pool = [candidate('a', { sourceDescription: null }), candidate('b'), candidate('c')];
    const result = evaluateAutoPublishBatch(pool, NOW, POLICY, { ...LIMITS, maxPerRun: 2 });
    expect(result.map((r) => ({ id: r.candidate.id, shouldPublish: r.shouldPublish }))).toEqual([
      { id: 'a', shouldPublish: false },
      { id: 'b', shouldPublish: true },
      { id: 'c', shouldPublish: true },
    ]);
  });
});

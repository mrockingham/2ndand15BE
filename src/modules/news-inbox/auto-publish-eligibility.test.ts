import { describe, expect, it } from 'vitest';

import {
  evaluateAutoPublishEligibility,
  type AutoPublishEligibilityCandidate,
  type AutoPublishEligibilitySource,
  type AutoPublishPolicy,
} from './auto-publish-eligibility.js';

const POLICY: AutoPublishPolicy = { maxAgeHours: 24, minDescriptionLength: 40 };
const NOW = new Date('2026-08-29T12:00:00.000Z');

function source(
  overrides: Partial<AutoPublishEligibilitySource> = {},
): AutoPublishEligibilitySource {
  return {
    status: 'ACTIVE',
    kind: 'RSS',
    contentType: 'ARTICLE',
    autoPublishArticles: true,
    allowsDescriptionUse: true,
    ...overrides,
  };
}

function candidate(
  overrides: Partial<AutoPublishEligibilityCandidate> = {},
): AutoPublishEligibilityCandidate {
  return {
    status: 'NEW',
    convertedArticleId: null,
    headline: 'A fictional headline about a real football game',
    canonicalUrl: 'https://news.example.com/story/one',
    sourceDescription: 'A fictional forty-plus character description used for testing purposes.',
    sourcePublishedAt: new Date('2026-08-29T06:00:00.000Z'),
    ...overrides,
  };
}

describe('evaluateAutoPublishEligibility', () => {
  it('is eligible when every source and candidate check passes', () => {
    expect(evaluateAutoPublishEligibility(source(), candidate(), NOW, POLICY)).toEqual({
      eligible: true,
      reason: null,
    });
  });

  it('rejects a MANUAL_ONLY source', () => {
    expect(
      evaluateAutoPublishEligibility(source({ kind: 'MANUAL_ONLY' }), candidate(), NOW, POLICY),
    ).toEqual({ eligible: false, reason: 'SOURCE_MANUAL_ONLY' });
  });

  it('rejects a PAUSED source', () => {
    expect(
      evaluateAutoPublishEligibility(source({ status: 'PAUSED' }), candidate(), NOW, POLICY),
    ).toEqual({ eligible: false, reason: 'SOURCE_NOT_ACTIVE' });
  });

  it('rejects a DISABLED source', () => {
    expect(
      evaluateAutoPublishEligibility(source({ status: 'DISABLED' }), candidate(), NOW, POLICY),
    ).toEqual({ eligible: false, reason: 'SOURCE_NOT_ACTIVE' });
  });

  it('rejects when the source has not opted into auto-publish', () => {
    expect(
      evaluateAutoPublishEligibility(
        source({ autoPublishArticles: false }),
        candidate(),
        NOW,
        POLICY,
      ),
    ).toEqual({ eligible: false, reason: 'SOURCE_AUTO_PUBLISH_DISABLED' });
  });

  it('rejects a VIDEO source', () => {
    expect(
      evaluateAutoPublishEligibility(source({ contentType: 'VIDEO' }), candidate(), NOW, POLICY),
    ).toEqual({ eligible: false, reason: 'SOURCE_NOT_ARTICLE_CONTENT_TYPE' });
  });

  it('rejects a HIGHLIGHT source', () => {
    expect(
      evaluateAutoPublishEligibility(
        source({ contentType: 'HIGHLIGHT' }),
        candidate(),
        NOW,
        POLICY,
      ),
    ).toEqual({ eligible: false, reason: 'SOURCE_NOT_ARTICLE_CONTENT_TYPE' });
  });

  it('rejects a source without description-use rights (the rights-model conflict this milestone found)', () => {
    expect(
      evaluateAutoPublishEligibility(
        source({ allowsDescriptionUse: false }),
        candidate(),
        NOW,
        POLICY,
      ),
    ).toEqual({ eligible: false, reason: 'SOURCE_DESCRIPTION_USE_NOT_ALLOWED' });
  });

  it('rejects a candidate older than the recency window using sourcePublishedAt, not discoveredAt', () => {
    expect(
      evaluateAutoPublishEligibility(
        source(),
        candidate({ sourcePublishedAt: new Date('2026-08-27T00:00:00.000Z') }),
        NOW,
        POLICY,
      ),
    ).toEqual({ eligible: false, reason: 'TOO_OLD' });
  });

  it('rejects a candidate with a missing publishedAt rather than guessing recency', () => {
    expect(
      evaluateAutoPublishEligibility(source(), candidate({ sourcePublishedAt: null }), NOW, POLICY),
    ).toEqual({ eligible: false, reason: 'MISSING_PUBLISHED_AT' });
  });

  it('rejects an invalid (non-HTTPS) canonical URL', () => {
    expect(
      evaluateAutoPublishEligibility(
        source(),
        candidate({ canonicalUrl: 'http://news.example.com/story/one' }),
        NOW,
        POLICY,
      ),
    ).toEqual({ eligible: false, reason: 'INVALID_CANONICAL_URL' });
  });

  it('rejects a missing description', () => {
    expect(
      evaluateAutoPublishEligibility(source(), candidate({ sourceDescription: null }), NOW, POLICY),
    ).toEqual({ eligible: false, reason: 'MISSING_DESCRIPTION' });
  });

  it('rejects a whitespace-only description', () => {
    expect(
      evaluateAutoPublishEligibility(
        source(),
        candidate({ sourceDescription: '   \n  ' }),
        NOW,
        POLICY,
      ),
    ).toEqual({ eligible: false, reason: 'MISSING_DESCRIPTION' });
  });

  it('rejects a too-short description', () => {
    expect(
      evaluateAutoPublishEligibility(
        source(),
        candidate({ sourceDescription: 'Too short.' }),
        NOW,
        POLICY,
      ),
    ).toEqual({ eligible: false, reason: 'DESCRIPTION_TOO_SHORT' });
  });

  it('rejects a REVIEWING candidate -- human interaction wins', () => {
    expect(
      evaluateAutoPublishEligibility(source(), candidate({ status: 'REVIEWING' }), NOW, POLICY),
    ).toEqual({ eligible: false, reason: 'CANDIDATE_NOT_NEW' });
  });

  it('rejects a SAVED candidate -- human interaction wins', () => {
    expect(
      evaluateAutoPublishEligibility(source(), candidate({ status: 'SAVED' }), NOW, POLICY),
    ).toEqual({ eligible: false, reason: 'CANDIDATE_NOT_NEW' });
  });

  it('rejects a DISMISSED candidate -- human interaction wins', () => {
    expect(
      evaluateAutoPublishEligibility(source(), candidate({ status: 'DISMISSED' }), NOW, POLICY),
    ).toEqual({ eligible: false, reason: 'CANDIDATE_NOT_NEW' });
  });

  it('rejects an already-CONVERTED candidate before checking status, for defense in depth', () => {
    expect(
      evaluateAutoPublishEligibility(
        source(),
        candidate({ status: 'CONVERTED', convertedArticleId: 'article-1' }),
        NOW,
        POLICY,
      ),
    ).toEqual({ eligible: false, reason: 'CANDIDATE_ALREADY_CONVERTED' });
  });
});

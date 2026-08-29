import type {
  NewsCandidateStatus,
  NewsContentType,
  NewsSourceKind,
  NewsSourceStatus,
} from '../../generated/prisma/client.js';

/**
 * M42B: deterministic trusted-source auto-publication eligibility. No AI, no
 * publisher-name special-casing -- every check here is a plain field
 * comparison against data the ingestion pipeline already validated and
 * stored. Source-level checks are evaluated before candidate-level checks
 * (ticket order), and the first failing check is returned as the rejection
 * reason so a preview run can explain exactly why a candidate didn't
 * qualify.
 */

export type AutoPublishRejectionReason =
  | 'SOURCE_NOT_ACTIVE'
  | 'SOURCE_AUTO_PUBLISH_DISABLED'
  | 'SOURCE_NOT_ARTICLE_CONTENT_TYPE'
  | 'SOURCE_MANUAL_ONLY'
  | 'SOURCE_DESCRIPTION_USE_NOT_ALLOWED'
  | 'CANDIDATE_NOT_NEW'
  | 'CANDIDATE_ALREADY_CONVERTED'
  | 'MISSING_HEADLINE'
  | 'INVALID_CANONICAL_URL'
  | 'MISSING_PUBLISHED_AT'
  | 'TOO_OLD'
  | 'MISSING_DESCRIPTION'
  | 'DESCRIPTION_TOO_SHORT';

export interface AutoPublishEligibilitySource {
  readonly status: NewsSourceStatus;
  readonly kind: NewsSourceKind;
  readonly contentType: NewsContentType;
  readonly autoPublishArticles: boolean;
  /** M42B rights-model finding: the existing CURATED-article validation
   * (`article.service.ts`'s `validateArticleFields`) requires a non-null
   * `summary`, and auto-publication has no human editor to write one (no
   * AI, no scraping). The only rights-safe text available is the source's
   * own feed description, which may only be used publicly when the source
   * record has already been marked `allowsDescriptionUse`. A source without
   * this flag cannot be auto-published at all under current rules -- this
   * is intentional, not a gap. */
  readonly allowsDescriptionUse: boolean;
}

export interface AutoPublishEligibilityCandidate {
  readonly status: NewsCandidateStatus;
  readonly convertedArticleId: string | null;
  readonly headline: string;
  readonly canonicalUrl: string;
  readonly sourceDescription: string | null;
  readonly sourcePublishedAt: Date | null;
}

export interface AutoPublishPolicy {
  /** Bounds enforced by config validation: 1-72. */
  readonly maxAgeHours: number;
  /** Real-window evidence (2026-08-29, ESPN/PFT/CBS NEW candidates): 88/90
   * descriptions were already >=40 chars; the only two under it (37 chars
   * each) were genuine fragments. 40 is not an arbitrary ticket suggestion
   * here -- it's the evidence-backed threshold. */
  readonly minDescriptionLength: number;
}

export interface AutoPublishEligibilityResult {
  readonly eligible: boolean;
  readonly reason: AutoPublishRejectionReason | null;
}

const ELIGIBLE: AutoPublishEligibilityResult = { eligible: true, reason: null };

function rejected(reason: AutoPublishRejectionReason): AutoPublishEligibilityResult {
  return { eligible: false, reason };
}

export function evaluateAutoPublishEligibility(
  source: AutoPublishEligibilitySource,
  candidate: AutoPublishEligibilityCandidate,
  now: Date,
  policy: AutoPublishPolicy,
): AutoPublishEligibilityResult {
  // -- SOURCE --
  if (source.kind === 'MANUAL_ONLY') return rejected('SOURCE_MANUAL_ONLY');
  if (source.status !== 'ACTIVE') return rejected('SOURCE_NOT_ACTIVE');
  if (!source.autoPublishArticles) return rejected('SOURCE_AUTO_PUBLISH_DISABLED');
  if (source.contentType !== 'ARTICLE') return rejected('SOURCE_NOT_ARTICLE_CONTENT_TYPE');
  if (!source.allowsDescriptionUse) return rejected('SOURCE_DESCRIPTION_USE_NOT_ALLOWED');

  // -- CANDIDATE --
  if (candidate.convertedArticleId !== null) return rejected('CANDIDATE_ALREADY_CONVERTED');
  if (candidate.status !== 'NEW') return rejected('CANDIDATE_NOT_NEW');
  if (candidate.headline.trim().length === 0) return rejected('MISSING_HEADLINE');
  if (!isValidHttpsUrl(candidate.canonicalUrl)) return rejected('INVALID_CANONICAL_URL');
  if (candidate.sourcePublishedAt === null) return rejected('MISSING_PUBLISHED_AT');
  const ageHours = (now.getTime() - candidate.sourcePublishedAt.getTime()) / (60 * 60 * 1000);
  if (ageHours > policy.maxAgeHours) return rejected('TOO_OLD');
  const description = candidate.sourceDescription?.trim() ?? '';
  if (description.length === 0) return rejected('MISSING_DESCRIPTION');
  if (description.length < policy.minDescriptionLength) return rejected('DESCRIPTION_TOO_SHORT');

  return ELIGIBLE;
}

function isValidHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

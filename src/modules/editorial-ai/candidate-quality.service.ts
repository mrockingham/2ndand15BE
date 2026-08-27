import type {
  CandidateQualityDecision,
  CandidateRelevance,
  CandidateSufficiency,
  EditorialAiConfidence,
} from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import type {
  CandidateQualityRepository,
  QualityCandidate,
  QualityEvaluationWrite,
} from './candidate-quality.repository.js';

const BATCH_MAX = 50;
const BATCH_CONCURRENCY = 4;

export interface CandidateClassificationResult {
  readonly relevance: 'NFL' | 'NOT_NFL' | 'UNCERTAIN';
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly reasons: readonly string[];
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly durationMs: number;
}

export interface CandidateClassifier {
  classify(input: {
    readonly headline: string;
    readonly canonicalUrl: string;
    readonly publisher: string;
    readonly description: string | null;
    readonly suggestedTeams: readonly string[];
  }): Promise<CandidateClassificationResult>;
}

export interface QualityOverrideInput {
  readonly relevance: CandidateRelevance;
  readonly sufficiency: CandidateSufficiency;
  readonly allowDuplicate: boolean;
  readonly reason: string;
}

export interface CandidateQualityGate {
  evaluateCandidate(
    candidateId: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<CandidateQualityResult>;
  evaluateBatch(
    candidateIds: readonly string[],
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<CandidateQualityBatchResult>;
  evaluateAll(
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<CandidateQualityBatchResult>;
  overrideCandidate(
    candidateId: string,
    input: QualityOverrideInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<CandidateQualityResult>;
  requireGenerationEligibility(
    candidateId: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<'FULL_DRAFT' | 'SHORT_BRIEF'>;
}

export interface CandidateQualityResult {
  readonly candidateId: string;
  readonly relevance: CandidateRelevance;
  readonly relevanceConfidence: EditorialAiConfidence;
  readonly sufficiency: CandidateSufficiency;
  readonly recommendedContentFormat: 'FULL_DRAFT' | 'SHORT_BRIEF' | 'LINK_ONLY' | 'NONE';
  readonly decision: CandidateQualityDecision;
  readonly qualityScore: number;
  readonly qualityFactors: QualityFactors;
  readonly reasons: readonly string[];
  readonly riskFlags: readonly string[];
  readonly duplicate: {
    readonly status: 'UNIQUE' | 'RELATED' | 'LIKELY_DUPLICATE' | 'DUPLICATE';
    readonly score: number | null;
    readonly closestCandidateId: string | null;
    readonly closestArticleId: string | null;
  };
  readonly resolvedTeams: readonly { id: string; abbreviation: string }[];
  readonly resolvedPlayers: readonly never[];
  readonly generationEligible: boolean;
  readonly evaluatedBy: 'DETERMINISTIC' | 'AI_ASSISTED' | 'MANUAL_OVERRIDE';
  readonly aiUsage: {
    readonly provider: string | null;
    readonly model: string | null;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly durationMs: number;
  };
}

export interface CandidateQualityBatchResult {
  readonly requested: number;
  readonly evaluated: number;
  readonly nflRelevant: number;
  readonly nonNfl: number;
  readonly fullDraft: number;
  readonly shortBrief: number;
  readonly linkOnly: number;
  readonly insufficient: number;
  readonly duplicates: number;
  readonly manualReview: number;
  readonly failed: number;
  readonly deterministicOnly: number;
  readonly aiAssisted: number;
  readonly classificationInputTokens: number;
  readonly classificationOutputTokens: number;
  readonly classificationDurationMs: number;
  readonly results: readonly (
    CandidateQualityResult | { readonly candidateId: string; readonly errorCode: string }
  )[];
}

interface QualityFactors {
  readonly relevance: number;
  readonly sufficiency: number;
  readonly freshness: number;
  readonly entityResolution: number;
  readonly sourcePreference: number;
  readonly rights: number;
  readonly duplicatePenalty: number;
}

export class CandidateQualityService implements CandidateQualityGate {
  constructor(
    private readonly repository: CandidateQualityRepository,
    private readonly classifier: CandidateClassifier | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async evaluateCandidate(
    candidateId: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<CandidateQualityResult> {
    const candidate = await this.repository.findCandidate(candidateId);
    if (candidate === null) throw notFound();
    const duplicate = await this.repository.findDuplicate(candidate);
    const deterministic = deterministicRelevance(candidate);
    let relevance = deterministic.relevance;
    let confidence = deterministic.confidence;
    let evaluatedBy: CandidateQualityResult['evaluatedBy'] = 'DETERMINISTIC';
    let ai: CandidateClassificationResult | null = null;
    const authorizedDescription = getAuthorizedDescription(candidate);
    const reasons = [...deterministic.reasons];
    if (relevance === 'UNCERTAIN' && this.classifier !== null) {
      ai = await this.classifier.classify({
        headline: candidate.headline,
        canonicalUrl: candidate.canonicalUrl,
        publisher: candidate.sourceNameSnapshot,
        description: authorizedDescription,
        suggestedTeams: candidate.suggestedTeams.map(({ team }) => team.abbreviation),
      });
      relevance = ai.relevance;
      confidence = ai.confidence;
      reasons.push(...ai.reasons.map((reason) => `AI: ${reason}`));
      evaluatedBy = 'AI_ASSISTED';
    }
    const sufficiency = classifySufficiency(candidate, authorizedDescription, relevance);
    const decision = decide(relevance, sufficiency, duplicate.status, false);
    const factors = qualityFactors(candidate, relevance, sufficiency, duplicate.status, this.now());
    const riskFlags = qualityRiskFlags(candidate, relevance, sufficiency, duplicate.status);
    const result = toResult(
      candidate,
      relevance,
      confidence,
      sufficiency,
      decision,
      factors,
      reasons,
      riskFlags,
      duplicate,
      evaluatedBy,
      ai,
    );
    await this.repository.saveEvaluation(
      candidateId,
      toWrite(result, false, null),
      actor,
      requestId,
      this.now(),
    );
    return result;
  }

  async evaluateBatch(
    candidateIds: readonly string[],
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<CandidateQualityBatchResult> {
    if (
      candidateIds.length === 0 ||
      candidateIds.length > BATCH_MAX ||
      new Set(candidateIds).size !== candidateIds.length
    )
      throw validation(`candidateIds must contain 1-${String(BATCH_MAX)} distinct IDs.`);
    const results: CandidateQualityBatchResult['results'][number][] = [];
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < candidateIds.length) {
        const candidateId = candidateIds[cursor++];
        if (candidateId === undefined) return;
        try {
          results.push(await this.evaluateCandidate(candidateId, actor, requestId));
        } catch (error) {
          results.push({
            candidateId,
            errorCode: error instanceof AppError ? error.code : 'CANDIDATE_QUALITY_FAILED',
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(BATCH_CONCURRENCY, candidateIds.length) }, worker),
    );
    return summarize(candidateIds, results);
  }

  async evaluateAll(
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<CandidateQualityBatchResult> {
    const ids = await this.repository.listCandidateIds();
    if (ids.length > BATCH_MAX)
      throw validation(`Hosted re-evaluation is bounded to ${String(BATCH_MAX)} candidates.`);
    return this.evaluateBatch(ids, actor, requestId);
  }

  async overrideCandidate(
    candidateId: string,
    input: QualityOverrideInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<CandidateQualityResult> {
    const candidate = await this.repository.findCandidate(candidateId);
    if (candidate === null) throw notFound();
    const duplicate = await this.repository.findDuplicate(candidate);
    const decision = decide(
      input.relevance,
      input.sufficiency,
      duplicate.status,
      input.allowDuplicate,
    );
    const factors = qualityFactors(
      candidate,
      input.relevance,
      input.sufficiency,
      duplicate.status,
      this.now(),
    );
    const result = toResult(
      candidate,
      input.relevance,
      'HIGH',
      input.sufficiency,
      decision,
      factors,
      [`Manual override: ${input.reason}`],
      qualityRiskFlags(candidate, input.relevance, input.sufficiency, duplicate.status),
      duplicate,
      'MANUAL_OVERRIDE',
      null,
    );
    await this.repository.saveEvaluation(
      candidateId,
      toWrite(result, true, input.reason),
      actor,
      requestId,
      this.now(),
      'NEWS_CANDIDATE_QUALITY_OVERRIDDEN',
    );
    return result;
  }

  async requireGenerationEligibility(
    candidateId: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<'FULL_DRAFT' | 'SHORT_BRIEF'> {
    const candidate = await this.repository.findCandidate(candidateId);
    if (candidate === null) throw notFound();
    const current = candidate.qualityEvaluation;
    const evaluation =
      current === null
        ? await this.evaluateCandidate(candidateId, actor, requestId)
        : fromStored(candidate, current);
    if (evaluation.decision === 'NFL_RELEVANT_FULL_DRAFT') return 'FULL_DRAFT';
    if (evaluation.decision === 'NFL_RELEVANT_SHORT_BRIEF') return 'SHORT_BRIEF';
    throw new AppError({
      code: 'CANDIDATE_NOT_GENERATION_ELIGIBLE',
      message: `Candidate quality decision ${evaluation.decision} blocks draft generation.`,
      statusCode: 409,
    });
  }
}

export function deterministicRelevance(candidate: QualityCandidate): {
  relevance: CandidateRelevance;
  confidence: EditorialAiConfidence;
  reasons: readonly string[];
} {
  const text = normalize(
    `${candidate.headline} ${candidate.canonicalUrl} ${candidate.sourceDescription ?? ''}`,
  );
  const nflEvidence =
    candidate.suggestedTeams.length > 0 ||
    candidate.source?.isOfficialLeague === true ||
    candidate.source?.isOfficialTeam === true ||
    /(?:^|\s)nfl(?:\s|$)|super bowl|pro bowl|national football league|\/nfl\//.test(text) ||
    candidate.suggestedTeams.some(({ team }) =>
      [team.fullName, team.name, team.abbreviation].some((value) =>
        text.includes(normalize(value)),
      ),
    );
  const nonNflEvidence =
    /(?:^|\s)(?:nba|mlb|nhl|mls|soccer|baseball|basketball|hockey)(?:\s|$)/.test(text) ||
    /ncaa|college football|college recruiting|high school|\/college-football\//.test(text);
  const nflDraftBoundary = /nfl draft|draft prospect|drafted rookie|pro day.*nfl/.test(text);
  if (nonNflEvidence && !nflEvidence && !nflDraftBoundary)
    return {
      relevance: 'NOT_NFL',
      confidence: 'HIGH',
      reasons: ['Strong non-NFL league or college-only evidence was present without NFL context.'],
    };
  if (nflEvidence || nflDraftBoundary)
    return {
      relevance: 'NFL',
      confidence: 'HIGH',
      reasons: ['Deterministic NFL source, URL, team, league, or draft-boundary evidence matched.'],
    };
  return {
    relevance: 'UNCERTAIN',
    confidence: 'LOW',
    reasons: ['No strong deterministic NFL or non-NFL evidence matched.'],
  };
}

export function classifySufficiency(
  candidate: QualityCandidate,
  authorizedDescription: string | null,
  relevance: CandidateRelevance,
): CandidateSufficiency {
  if (relevance === 'UNCERTAIN') return 'MANUAL_REVIEW';
  const headlineWords = words(candidate.headline);
  const descriptionWords = words(authorizedDescription ?? '');
  if (descriptionWords >= 100) return 'FULL_DRAFT_ELIGIBLE';
  if (descriptionWords >= 30) return 'SHORT_BRIEF_ELIGIBLE';
  if (descriptionWords >= 12 && headlineWords >= 5) return 'SHORT_BRIEF_ELIGIBLE';
  if (headlineWords >= 6 && candidate.canonicalUrl.length > 0) return 'LINK_ONLY';
  return 'INSUFFICIENT';
}

function getAuthorizedDescription(candidate: QualityCandidate): string | null {
  return candidate.source?.allowsDescriptionUse === true &&
    candidate.source.rightsProfile?.textUsage === 'SUMMARY_ALLOWED'
    ? candidate.sourceDescription
    : null;
}

function decide(
  relevance: CandidateRelevance,
  sufficiency: CandidateSufficiency,
  duplicate: 'UNIQUE' | 'RELATED' | 'LIKELY_DUPLICATE' | 'DUPLICATE',
  allowDuplicate: boolean,
): CandidateQualityDecision {
  if (relevance === 'NOT_NFL') return 'REJECT_NON_NFL';
  if (relevance === 'UNCERTAIN' || sufficiency === 'MANUAL_REVIEW') return 'NEEDS_MANUAL_REVIEW';
  if (!allowDuplicate && (duplicate === 'LIKELY_DUPLICATE' || duplicate === 'DUPLICATE'))
    return 'REJECT_DUPLICATE';
  if (sufficiency === 'FULL_DRAFT_ELIGIBLE') return 'NFL_RELEVANT_FULL_DRAFT';
  if (sufficiency === 'SHORT_BRIEF_ELIGIBLE') return 'NFL_RELEVANT_SHORT_BRIEF';
  if (sufficiency === 'LINK_ONLY') return 'NFL_RELEVANT_LINK_ONLY';
  return 'REJECT_INSUFFICIENT';
}

function qualityFactors(
  candidate: QualityCandidate,
  relevance: CandidateRelevance,
  sufficiency: CandidateSufficiency,
  duplicate: 'UNIQUE' | 'RELATED' | 'LIKELY_DUPLICATE' | 'DUPLICATE',
  now: Date,
): QualityFactors {
  const ageDays = Math.max(
    0,
    (now.getTime() - (candidate.sourcePublishedAt ?? candidate.discoveredAt).getTime()) /
      86_400_000,
  );
  const source = candidate.source;
  const sourcePreference =
    source === null
      ? 25
      : Math.round(
          (source.reliabilityWeight +
            source.metadataRichnessWeight +
            source.teamSpecificityWeight +
            source.editorialUsefulnessWeight) /
            4,
        );
  return {
    relevance: relevance === 'NFL' ? 100 : relevance === 'NOT_NFL' ? 0 : 50,
    sufficiency: {
      FULL_DRAFT_ELIGIBLE: 100,
      SHORT_BRIEF_ELIGIBLE: 70,
      LINK_ONLY: 35,
      INSUFFICIENT: 0,
      MANUAL_REVIEW: 50,
    }[sufficiency],
    freshness: ageDays <= 2 ? 100 : ageDays <= 7 ? 80 : ageDays <= 14 ? 60 : 20,
    entityResolution: candidate.suggestedTeams.length > 0 ? 100 : 40,
    sourcePreference,
    rights:
      source?.rightsProfile?.textUsage === 'SUMMARY_ALLOWED' && !source.rightsProfile.reviewRequired
        ? 100
        : source?.rightsProfile?.textUsage === 'LINK_ONLY'
          ? 20
          : 35,
    duplicatePenalty:
      duplicate === 'DUPLICATE'
        ? 100
        : duplicate === 'LIKELY_DUPLICATE'
          ? 75
          : duplicate === 'RELATED'
            ? 20
            : 0,
  };
}

function qualityRiskFlags(
  candidate: QualityCandidate,
  relevance: CandidateRelevance,
  sufficiency: CandidateSufficiency,
  duplicate: 'UNIQUE' | 'RELATED' | 'LIKELY_DUPLICATE' | 'DUPLICATE',
): string[] {
  const flags: string[] = [];
  if (relevance !== 'NFL')
    flags.push(relevance === 'NOT_NFL' ? 'NON_NFL' : 'NFL_RELEVANCE_UNCERTAIN');
  if (['LINK_ONLY', 'INSUFFICIENT'].includes(sufficiency)) flags.push('THIN_SOURCE');
  if (candidate.source?.rightsProfile?.reviewRequired !== false)
    flags.push('RIGHTS_REVIEW_REQUIRED');
  if (duplicate !== 'UNIQUE') flags.push('STORY_OVERLAP');
  return flags;
}

function toResult(
  candidate: QualityCandidate,
  relevance: CandidateRelevance,
  confidence: EditorialAiConfidence,
  sufficiency: CandidateSufficiency,
  decision: CandidateQualityDecision,
  factors: QualityFactors,
  reasons: readonly string[],
  riskFlags: readonly string[],
  duplicate: Awaited<ReturnType<CandidateQualityRepository['findDuplicate']>>,
  evaluatedBy: CandidateQualityResult['evaluatedBy'],
  ai: CandidateClassificationResult | null,
): CandidateQualityResult {
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        factors.relevance * 0.3 +
          factors.sufficiency * 0.25 +
          factors.freshness * 0.1 +
          factors.entityResolution * 0.1 +
          factors.sourcePreference * 0.1 +
          factors.rights * 0.15 -
          factors.duplicatePenalty * 0.5,
      ),
    ),
  );
  return {
    candidateId: candidate.id,
    relevance,
    relevanceConfidence: confidence,
    sufficiency,
    recommendedContentFormat:
      sufficiency === 'FULL_DRAFT_ELIGIBLE'
        ? 'FULL_DRAFT'
        : sufficiency === 'SHORT_BRIEF_ELIGIBLE'
          ? 'SHORT_BRIEF'
          : sufficiency === 'LINK_ONLY'
            ? 'LINK_ONLY'
            : 'NONE',
    decision,
    qualityScore: score,
    qualityFactors: factors,
    reasons,
    riskFlags,
    duplicate,
    resolvedTeams: candidate.suggestedTeams.map(({ team }) => ({
      id: team.id,
      abbreviation: team.abbreviation,
    })),
    resolvedPlayers: [],
    generationEligible: ['NFL_RELEVANT_FULL_DRAFT', 'NFL_RELEVANT_SHORT_BRIEF'].includes(decision),
    evaluatedBy,
    aiUsage: {
      provider: ai?.provider ?? null,
      model: ai?.model ?? null,
      inputTokens: ai?.inputTokens ?? null,
      outputTokens: ai?.outputTokens ?? null,
      durationMs: ai?.durationMs ?? 0,
    },
  };
}

function toWrite(
  result: CandidateQualityResult,
  overridden: boolean,
  overrideReason: string | null,
): QualityEvaluationWrite {
  return {
    relevance: result.relevance,
    relevanceConfidence: result.relevanceConfidence,
    sufficiency: result.sufficiency,
    decision: result.decision,
    qualityScore: result.qualityScore,
    qualityFactors: { ...result.qualityFactors },
    reasons: result.reasons,
    riskFlags: result.riskFlags,
    overlapStatus: result.duplicate.status,
    closestCandidateId: result.duplicate.closestCandidateId,
    closestArticleId: result.duplicate.closestArticleId,
    duplicateScore: result.duplicate.score,
    generationEligible: result.generationEligible,
    evaluatedBy: result.evaluatedBy,
    classifierProvider: result.aiUsage.provider,
    classifierModel: result.aiUsage.model,
    classificationInputTokens: result.aiUsage.inputTokens,
    classificationOutputTokens: result.aiUsage.outputTokens,
    classificationDurationMs: result.aiUsage.durationMs,
    overridden,
    overrideReason,
  };
}

function fromStored(
  candidate: QualityCandidate,
  stored: NonNullable<QualityCandidate['qualityEvaluation']>,
): CandidateQualityResult {
  return {
    candidateId: candidate.id,
    relevance: stored.relevance,
    relevanceConfidence: stored.relevanceConfidence,
    sufficiency: stored.sufficiency,
    recommendedContentFormat:
      stored.sufficiency === 'FULL_DRAFT_ELIGIBLE'
        ? 'FULL_DRAFT'
        : stored.sufficiency === 'SHORT_BRIEF_ELIGIBLE'
          ? 'SHORT_BRIEF'
          : stored.sufficiency === 'LINK_ONLY'
            ? 'LINK_ONLY'
            : 'NONE',
    decision: stored.decision,
    qualityScore: stored.qualityScore,
    qualityFactors: stored.qualityFactors as unknown as QualityFactors,
    reasons: stored.reasons,
    riskFlags: stored.riskFlags,
    duplicate: {
      status: stored.overlapStatus,
      score: stored.duplicateScore,
      closestCandidateId: stored.closestCandidateId,
      closestArticleId: stored.closestArticleId,
    },
    resolvedTeams: candidate.suggestedTeams.map(({ team }) => ({
      id: team.id,
      abbreviation: team.abbreviation,
    })),
    resolvedPlayers: [],
    generationEligible: stored.generationEligible,
    evaluatedBy: stored.evaluatedBy as CandidateQualityResult['evaluatedBy'],
    aiUsage: {
      provider: stored.classifierProvider,
      model: stored.classifierModel,
      inputTokens: stored.classificationInputTokens,
      outputTokens: stored.classificationOutputTokens,
      durationMs: stored.classificationDurationMs,
    },
  };
}

function summarize(
  requested: readonly string[],
  results: CandidateQualityBatchResult['results'],
): CandidateQualityBatchResult {
  const success = results.filter((row): row is CandidateQualityResult => 'decision' in row);
  const sum = (field: 'inputTokens' | 'outputTokens' | 'durationMs') =>
    success.reduce((total, row) => total + (row.aiUsage[field] ?? 0), 0);
  return {
    requested: requested.length,
    evaluated: success.length,
    nflRelevant: success.filter((row) => row.relevance === 'NFL').length,
    nonNfl: success.filter((row) => row.relevance === 'NOT_NFL').length,
    fullDraft: success.filter((row) => row.sufficiency === 'FULL_DRAFT_ELIGIBLE').length,
    shortBrief: success.filter((row) => row.sufficiency === 'SHORT_BRIEF_ELIGIBLE').length,
    linkOnly: success.filter((row) => row.sufficiency === 'LINK_ONLY').length,
    insufficient: success.filter((row) => row.sufficiency === 'INSUFFICIENT').length,
    duplicates: success.filter((row) => row.decision === 'REJECT_DUPLICATE').length,
    manualReview: success.filter((row) => row.decision === 'NEEDS_MANUAL_REVIEW').length,
    failed: results.length - success.length,
    deterministicOnly: success.filter((row) => row.evaluatedBy === 'DETERMINISTIC').length,
    aiAssisted: success.filter((row) => row.evaluatedBy === 'AI_ASSISTED').length,
    classificationInputTokens: sum('inputTokens'),
    classificationOutputTokens: sum('outputTokens'),
    classificationDurationMs: sum('durationMs'),
    results,
  };
}

function words(value: string): number {
  return value.trim().length === 0 ? 0 : value.trim().split(/\s+/).length;
}
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim();
}
function notFound(): AppError {
  return new AppError({
    code: 'NEWS_CANDIDATE_NOT_FOUND',
    message: 'The requested news candidate was not found.',
    statusCode: 404,
  });
}
function validation(message: string): AppError {
  return new AppError({ code: 'VALIDATION_ERROR', message, statusCode: 400 });
}

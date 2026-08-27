import type {
  CandidateQualityDecision,
  CandidateRelevance,
  CandidateSufficiency,
  EditorialAiConfidence,
  Prisma,
  PrismaClient,
  StoryOverlapStatus,
} from '../../generated/prisma/client.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import { sanitizeAuditSnapshot } from '../admin/audit-sanitizer.js';

export const qualityCandidateSelect = {
  id: true,
  sourceId: true,
  sourceNameSnapshot: true,
  canonicalUrl: true,
  canonicalUrlHash: true,
  sourceExternalId: true,
  headline: true,
  sourceDescription: true,
  sourceAuthor: true,
  sourcePublishedAt: true,
  discoveredAt: true,
  status: true,
  convertedArticleId: true,
  source: {
    select: {
      kind: true,
      status: true,
      isOfficialLeague: true,
      isOfficialTeam: true,
      allowsDescriptionUse: true,
      reliabilityWeight: true,
      metadataRichnessWeight: true,
      teamSpecificityWeight: true,
      editorialUsefulnessWeight: true,
      rightsProfile: {
        select: {
          textUsage: true,
          imageUsage: true,
          videoUsage: true,
          quotationPolicy: true,
          reviewRequired: true,
        },
      },
    },
  },
  suggestedTeams: {
    select: {
      team: { select: { id: true, abbreviation: true, fullName: true, city: true, name: true } },
    },
  },
  qualityEvaluation: true,
} satisfies Prisma.NewsCandidateSelect;

export type QualityCandidate = Prisma.NewsCandidateGetPayload<{
  select: typeof qualityCandidateSelect;
}>;

export interface QualityEvaluationWrite {
  readonly relevance: CandidateRelevance;
  readonly relevanceConfidence: EditorialAiConfidence;
  readonly sufficiency: CandidateSufficiency;
  readonly decision: CandidateQualityDecision;
  readonly qualityScore: number;
  readonly qualityFactors: Prisma.InputJsonValue;
  readonly reasons: readonly string[];
  readonly riskFlags: readonly string[];
  readonly overlapStatus: StoryOverlapStatus;
  readonly closestCandidateId: string | null;
  readonly closestArticleId: string | null;
  readonly duplicateScore: number | null;
  readonly generationEligible: boolean;
  readonly evaluatedBy: string;
  readonly classifierProvider: string | null;
  readonly classifierModel: string | null;
  readonly classificationInputTokens: number | null;
  readonly classificationOutputTokens: number | null;
  readonly classificationDurationMs: number;
  readonly overridden: boolean;
  readonly overrideReason: string | null;
}

export interface QualityDuplicate {
  readonly status: StoryOverlapStatus;
  readonly score: number | null;
  readonly closestCandidateId: string | null;
  readonly closestArticleId: string | null;
}

export interface CandidateQualityRepository {
  findCandidate(id: string): Promise<QualityCandidate | null>;
  listCandidateIds(): Promise<readonly string[]>;
  findDuplicate(candidate: QualityCandidate): Promise<QualityDuplicate>;
  saveEvaluation(
    candidateId: string,
    input: QualityEvaluationWrite,
    actor: AdministrativePrincipal,
    requestId: string | null,
    now: Date,
    action?: string,
  ): Promise<void>;
}

export class PrismaCandidateQualityRepository implements CandidateQualityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findCandidate(id: string): Promise<QualityCandidate | null> {
    return this.prisma.newsCandidate.findUnique({ where: { id }, select: qualityCandidateSelect });
  }

  async listCandidateIds(): Promise<readonly string[]> {
    const rows = await this.prisma.newsCandidate.findMany({
      orderBy: [{ discoveredAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return rows.map(({ id }) => id);
  }

  async findDuplicate(candidate: QualityCandidate): Promise<QualityDuplicate> {
    const exactCandidate = await this.prisma.newsCandidate.findFirst({
      where: {
        id: { not: candidate.id },
        status: { not: 'DISMISSED' },
        OR: [
          { canonicalUrlHash: candidate.canonicalUrlHash },
          ...(candidate.sourceExternalId === null
            ? []
            : [{ sourceId: candidate.sourceId, sourceExternalId: candidate.sourceExternalId }]),
        ],
      },
      select: { id: true },
    });
    if (exactCandidate !== null)
      return {
        status: 'DUPLICATE',
        score: 1,
        closestCandidateId: exactCandidate.id,
        closestArticleId: null,
      };
    const exactArticle = await this.prisma.article.findFirst({
      where: { sourceUrl: candidate.canonicalUrl, status: { not: 'ARCHIVED' } },
      select: { id: true },
    });
    if (exactArticle !== null)
      return {
        status: 'DUPLICATE',
        score: 1,
        closestCandidateId: null,
        closestArticleId: exactArticle.id,
      };
    const recent = await this.prisma.newsCandidate.findMany({
      where: { id: { not: candidate.id }, status: { not: 'DISMISSED' } },
      orderBy: { discoveredAt: 'desc' },
      take: 500,
      select: { id: true, headline: true, sourcePublishedAt: true },
    });
    let best: { id: string; score: number } | null = null;
    for (const row of recent) {
      const score = headlineSimilarity(candidate.headline, row.headline);
      const closeTime =
        candidate.sourcePublishedAt !== null &&
        row.sourcePublishedAt !== null &&
        Math.abs(candidate.sourcePublishedAt.getTime() - row.sourcePublishedAt.getTime()) <=
          72 * 3_600_000;
      if (closeTime && score >= 0.5 && (best === null || score > best.score))
        best = { id: row.id, score };
    }
    if (best === null)
      return {
        status: 'UNIQUE',
        score: null,
        closestCandidateId: null,
        closestArticleId: null,
      };
    return {
      status: best.score >= 0.75 ? 'LIKELY_DUPLICATE' : 'RELATED',
      score: Number(best.score.toFixed(4)),
      closestCandidateId: best.id,
      closestArticleId: null,
    };
  }

  saveEvaluation(
    candidateId: string,
    input: QualityEvaluationWrite,
    actor: AdministrativePrincipal,
    requestId: string | null,
    now: Date,
    action = 'NEWS_CANDIDATE_QUALITY_EVALUATED',
  ): Promise<void> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.candidateQualityEvaluation.upsert({
        where: { candidateId },
        create: {
          candidateId,
          ...input,
          reasons: [...input.reasons],
          riskFlags: [...input.riskFlags],
          evaluatedById: actor.userId,
          evaluatedBySnapshot: actor.email,
          evaluatedAt: now,
        },
        update: {
          ...input,
          reasons: [...input.reasons],
          riskFlags: [...input.riskFlags],
          evaluatedById: actor.userId,
          evaluatedBySnapshot: actor.email,
          evaluatedAt: now,
        },
      });
      await transaction.adminAuditEvent.create({
        data: {
          actorUserId: actor.userId,
          actorEmailSnapshot: actor.email,
          action,
          entityType: 'NEWS_CANDIDATE',
          entityId: candidateId,
          requestId,
          afterSnapshot: sanitizeAuditSnapshot({
            relevance: input.relevance,
            sufficiency: input.sufficiency,
            decision: input.decision,
            qualityScore: input.qualityScore,
            overlapStatus: input.overlapStatus,
            generationEligible: input.generationEligible,
            overridden: input.overridden,
          }),
        },
      });
    });
  }
}

function headlineSimilarity(left: string, right: string): number {
  const a = new Set(normalize(left).split(' ').filter(Boolean));
  const b = new Set(normalize(right).split(' ').filter(Boolean));
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / Math.max(1, a.size + b.size - shared);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

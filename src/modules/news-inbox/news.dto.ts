import type { Prisma } from '../../generated/prisma/client.js';
import { toAdminArticleDetailDto, type AdminArticleDetailDto } from '../articles/article.dto.js';

export const newsSourceInclude = {
  defaultTeam: true,
} satisfies Prisma.NewsSourceInclude;

export const newsCandidateInclude = {
  source: { select: { id: true, name: true, slug: true, publisherName: true } },
  suggestedTeams: {
    include: { team: true },
    orderBy: { team: { abbreviation: 'asc' } },
  },
  qualityEvaluation: true,
} satisfies Prisma.NewsCandidateInclude;

export type NewsSourceRecord = Prisma.NewsSourceGetPayload<{ include: typeof newsSourceInclude }>;
export type NewsCandidateRecord = Prisma.NewsCandidateGetPayload<{
  include: typeof newsCandidateInclude;
}>;
export type NewsIngestionRunRecord = Prisma.NewsIngestionRunGetPayload<Record<string, never>>;

export function toNewsSourceDto(source: NewsSourceRecord) {
  return {
    id: source.id,
    name: source.name,
    slug: source.slug,
    kind: source.kind,
    contentType: source.contentType,
    status: source.status,
    feedUrl: source.feedUrl,
    siteUrl: source.siteUrl,
    publisherName: source.publisherName,
    defaultTeam:
      source.defaultTeam === null
        ? null
        : {
            id: source.defaultTeam.id,
            abbreviation: source.defaultTeam.abbreviation,
            fullName: source.defaultTeam.fullName,
          },
    isOfficialLeague: source.isOfficialLeague,
    isOfficialTeam: source.isOfficialTeam,
    allowsDescriptionUse: source.allowsDescriptionUse,
    sourcePreference: {
      reliability: source.reliabilityWeight,
      metadataRichness: source.metadataRichnessWeight,
      teamSpecificity: source.teamSpecificityWeight,
      editorialUsefulness: source.editorialUsefulnessWeight,
    },
    notes: source.notes,
    health: {
      lastCheckedAt: source.lastCheckedAt?.toISOString() ?? null,
      lastSuccessfulAt: source.lastSuccessfulAt?.toISOString() ?? null,
      lastErrorCode: source.lastErrorCode,
      lastErrorSummary: source.lastErrorSummary,
      lastItemCount: source.lastItemCount,
      consecutiveFailureCount: source.consecutiveFailureCount,
      hasEtag: source.responseEtag !== null,
      hasModifiedValidator: source.responseModified !== null,
      runActive: source.ingestionLeaseId !== null,
    },
    createdBySnapshot: source.createdBySnapshot,
    updatedBySnapshot: source.updatedBySnapshot,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}

export function toNewsCandidateListDto(candidate: NewsCandidateRecord) {
  return {
    id: candidate.id,
    source: candidate.source,
    sourceName: candidate.sourceNameSnapshot,
    canonicalUrl: candidate.canonicalUrl,
    headline: candidate.headline,
    sourceAuthor: candidate.sourceAuthor,
    contentType: candidate.contentType,
    thumbnailUrl: candidate.mediaThumbnailUrl,
    sourcePublishedAt: candidate.sourcePublishedAt?.toISOString() ?? null,
    discoveredAt: candidate.discoveredAt.toISOString(),
    status: candidate.status,
    convertedArticleId: candidate.convertedArticleId,
    quality:
      candidate.qualityEvaluation === null
        ? null
        : {
            relevance: candidate.qualityEvaluation.relevance,
            relevanceConfidence: candidate.qualityEvaluation.relevanceConfidence,
            sufficiency: candidate.qualityEvaluation.sufficiency,
            decision: candidate.qualityEvaluation.decision,
            qualityScore: candidate.qualityEvaluation.qualityScore,
            generationEligible: candidate.qualityEvaluation.generationEligible,
            evaluatedAt: candidate.qualityEvaluation.evaluatedAt.toISOString(),
          },
    suggestedTeams: candidate.suggestedTeams.map(({ team, rule }) => ({
      id: team.id,
      abbreviation: team.abbreviation,
      fullName: team.fullName,
      rule,
    })),
    updatedAt: candidate.updatedAt.toISOString(),
  };
}

export function toNewsCandidateDetailDto(candidate: NewsCandidateRecord) {
  return {
    ...toNewsCandidateListDto(candidate),
    sourceExternalId: candidate.sourceExternalId,
    sourceDescription: candidate.sourceDescription,
    dismissalReason: candidate.dismissalReason,
    reviewedBySnapshot: candidate.reviewedBySnapshot,
    reviewedAt: candidate.reviewedAt?.toISOString() ?? null,
    qualityDetail:
      candidate.qualityEvaluation === null
        ? null
        : {
            qualityFactors: candidate.qualityEvaluation.qualityFactors,
            reasons: candidate.qualityEvaluation.reasons,
            riskFlags: candidate.qualityEvaluation.riskFlags,
            duplicate: {
              status: candidate.qualityEvaluation.overlapStatus,
              score: candidate.qualityEvaluation.duplicateScore,
              closestCandidateId: candidate.qualityEvaluation.closestCandidateId,
              closestArticleId: candidate.qualityEvaluation.closestArticleId,
            },
            evaluatedBy: candidate.qualityEvaluation.evaluatedBy,
            overridden: candidate.qualityEvaluation.overridden,
            overrideReason: candidate.qualityEvaluation.overrideReason,
          },
    createdAt: candidate.createdAt.toISOString(),
  };
}

export function toNewsIngestionRunDto(run: NewsIngestionRunRecord) {
  return {
    id: run.id,
    sourceId: run.sourceId,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    fetchedCount: run.fetchedCount,
    createdCount: run.createdCount,
    updatedCount: run.updatedCount,
    skippedCount: run.skippedCount,
    failedCount: run.failedCount,
    responseBytes: run.responseBytes,
    hasResponseEtag: run.responseEtag !== null,
    hasResponseModified: run.responseModified !== null,
    errorCode: run.errorCode,
    errorSummary: run.errorSummary,
    initiatedBySnapshot: run.initiatedBySnapshot,
  };
}

export interface CandidateConversionResult {
  readonly candidate: ReturnType<typeof toNewsCandidateDetailDto>;
  readonly article: AdminArticleDetailDto;
}

export function toConvertedArticleDto(
  article: Parameters<typeof toAdminArticleDetailDto>[0],
): AdminArticleDetailDto {
  return toAdminArticleDetailDto(article);
}

import type {
  EditorialAiReviewStatus,
  Prisma,
  PrismaClient,
  SourceMediaUsage,
  SourceQuotationPolicy,
  SourceTextUsage,
} from '../../generated/prisma/client.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import { sanitizeAuditSnapshot } from '../admin/audit-sanitizer.js';
import {
  createArticleAudit,
  createArticleInTransaction,
  revisionSnapshot,
  type ArticleWriteFields,
} from '../articles/article.repository.js';
import { articleInclude } from '../articles/article.dto.js';

export const editorialCandidateSelect = {
  id: true,
  sourceId: true,
  sourceNameSnapshot: true,
  sourceExternalId: true,
  canonicalUrl: true,
  canonicalUrlHash: true,
  headline: true,
  sourceDescription: true,
  sourceAuthor: true,
  sourcePublishedAt: true,
  discoveredAt: true,
  status: true,
  convertedArticleId: true,
  source: {
    select: {
      allowsDescriptionUse: true,
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
    select: { team: { select: { id: true, abbreviation: true, fullName: true } } },
  },
  aiMetadata: { select: { articleId: true, reviewStatus: true, overlapStatus: true } },
} satisfies Prisma.NewsCandidateSelect;

export type EditorialCandidate = Prisma.NewsCandidateGetPayload<{
  select: typeof editorialCandidateSelect;
}>;

export interface EditorialTeam {
  readonly id: string;
  readonly abbreviation: string;
  readonly fullName: string;
  readonly city: string;
  readonly name: string;
}

export interface EditorialPlayerMatch {
  readonly id: string;
  readonly displayName: string;
  readonly normalizedName: string;
  readonly latestTeamId: string | null;
}

export interface DuplicateCandidate {
  readonly id: string;
  readonly canonicalUrlHash: string;
  readonly sourceExternalId: string | null;
  readonly headline: string;
  readonly sourcePublishedAt: Date | null;
  readonly teamIds: readonly string[];
}

export interface DuplicateArticle {
  readonly id: string;
  readonly sourceUrl: string | null;
  readonly title: string;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
  readonly teamIds: readonly string[];
}

export interface DraftPersistenceInput {
  readonly candidate: EditorialCandidate;
  readonly fields: ArticleWriteFields;
  readonly teamIds: readonly string[];
  readonly playerIds: readonly string[];
  readonly metadata: {
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly generatedAt: Date;
    readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    readonly riskFlags: readonly (
      | 'THIN_SOURCE'
      | 'POSSIBLE_DUPLICATE'
      | 'SENSITIVE_INJURY'
      | 'CONTRACT_FIGURES'
      | 'LEGAL_DISCIPLINARY'
      | 'TRADE_RUMOR'
      | 'UNSOURCED_CLAIM'
      | 'QUOTE_INCLUDED'
      | 'MEDIA_RIGHTS_UNCLEAR'
      | 'PLAYER_IDENTITY_UNCERTAIN'
      | 'SOURCE_OVERLAP'
    )[];
    readonly category: Prisma.ArticleAiMetadataCreateInput['category'];
    readonly topicTags: readonly string[];
    readonly mediaSearchTerms: readonly string[];
    readonly primaryTeamId: string | null;
    readonly unresolvedEntities: Prisma.InputJsonValue;
    readonly overlapStatus: Prisma.ArticleAiMetadataCreateInput['overlapStatus'];
    readonly closestCandidateId: string | null;
    readonly closestArticleId: string | null;
    readonly duplicateScore: number | null;
    readonly sourceOverlapScore: number;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly estimatedCostMicros: number | null;
    readonly sourcePreparationMs: number;
    readonly aiDurationMs: number;
    readonly entityResolutionMs: number;
    readonly duplicateDetectionMs: number;
    readonly databaseDurationMs: number;
    readonly totalDurationMs: number;
  };
}

export interface EditorialCoverageRow {
  readonly id: string;
  readonly abbreviation: string;
  readonly publishedCount: number;
  readonly draftCount: number;
  readonly candidateCount: number;
  readonly recentPublishedCount: number;
  readonly videoArticleCount: number;
}

export interface EditorialAiRepository {
  findCandidate(id: string): Promise<EditorialCandidate | null>;
  findAiDraft(articleId: string): Promise<{
    readonly version: number;
    readonly status: string;
    readonly candidate: EditorialCandidate;
  } | null>;
  listTeams(): Promise<readonly EditorialTeam[]>;
  findPlayers(normalizedNames: readonly string[]): Promise<readonly EditorialPlayerMatch[]>;
  findDuplicateCandidates(candidateId: string): Promise<readonly DuplicateCandidate[]>;
  findDuplicateArticles(): Promise<readonly DuplicateArticle[]>;
  slugExists(slug: string): Promise<boolean>;
  createDraft(
    input: DraftPersistenceInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<{ readonly articleId: string; readonly slug: string; readonly version: number }>;
  regenerateDraft(
    articleId: string,
    expectedVersion: number,
    input: DraftPersistenceInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<{ readonly version: number } | null>;
  listCoverage(now: Date, recentSince: Date): Promise<readonly EditorialCoverageRow[]>;
  getCoverageTotals(now: Date): Promise<{
    readonly totalPublished: number;
    readonly totalDrafts: number;
    readonly totalCandidates: number;
  }>;
  setReviewStatus(
    articleId: string,
    status: EditorialAiReviewStatus,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<boolean>;
  attachMedia(
    articleId: string,
    mediaId: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<boolean>;
  createMediaCandidate(
    articleId: string,
    input: MediaCandidateWrite,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<MediaCandidateRecord | null>;
  getSourceRights(sourceId: string): Promise<SourceRightsRecord | null>;
  upsertSourceRights(
    sourceId: string,
    input: SourceRightsWrite,
    actor: AdministrativePrincipal,
    requestId: string | null,
    now: Date,
  ): Promise<SourceRightsRecord | null>;
}

export interface MediaCandidateWrite {
  readonly type: 'YOUTUBE' | 'VIDEO_EMBED' | 'IMAGE' | 'EXTERNAL_LINK';
  readonly platform: string;
  readonly externalId: string | null;
  readonly url: string;
  readonly title: string;
  readonly publisher: string | null;
  readonly thumbnailUrl: string | null;
  readonly publishedAt: Date | null;
  readonly embedAllowed: boolean;
  readonly rightsStatus: SourceMediaUsage;
  readonly relevanceScore: number;
}

export interface MediaCandidateRecord extends MediaCandidateWrite {
  readonly id: string;
  readonly articleId: string;
  readonly status: 'SUGGESTED' | 'ATTACHED' | 'REJECTED';
  readonly isPrimary: boolean;
}

export interface SourceRightsWrite {
  readonly textUsage: SourceTextUsage;
  readonly imageUsage: SourceMediaUsage;
  readonly videoUsage: SourceMediaUsage;
  readonly quotationPolicy: SourceQuotationPolicy;
  readonly reviewRequired: boolean;
  readonly notes: string | null;
}

export interface SourceRightsRecord extends SourceRightsWrite {
  readonly sourceId: string;
  readonly reviewedBySnapshot: string | null;
  readonly reviewedAt: Date | null;
}

export class PrismaEditorialAiRepository implements EditorialAiRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findCandidate(id: string): Promise<EditorialCandidate | null> {
    return this.prisma.newsCandidate.findUnique({
      where: { id },
      select: editorialCandidateSelect,
    });
  }

  async findAiDraft(articleId: string) {
    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
      select: {
        version: true,
        status: true,
        aiMetadata: { select: { candidate: { select: editorialCandidateSelect } } },
      },
    });
    return article?.aiMetadata === null || article === null
      ? null
      : {
          version: article.version,
          status: article.status,
          candidate: article.aiMetadata.candidate,
        };
  }

  listTeams(): Promise<readonly EditorialTeam[]> {
    return this.prisma.team.findMany({
      where: { league: 'NFL', isActive: true },
      orderBy: { abbreviation: 'asc' },
      select: { id: true, abbreviation: true, fullName: true, city: true, name: true },
    });
  }

  findPlayers(normalizedNames: readonly string[]): Promise<readonly EditorialPlayerMatch[]> {
    if (normalizedNames.length === 0) return Promise.resolve([]);
    return this.prisma.player.findMany({
      where: { normalizedName: { in: [...new Set(normalizedNames)] } },
      select: { id: true, displayName: true, normalizedName: true, latestTeamId: true },
      take: 200,
    });
  }

  async findDuplicateCandidates(candidateId: string): Promise<readonly DuplicateCandidate[]> {
    const records = await this.prisma.newsCandidate.findMany({
      where: { id: { not: candidateId }, status: { not: 'DISMISSED' } },
      orderBy: { discoveredAt: 'desc' },
      take: 500,
      select: {
        id: true,
        canonicalUrlHash: true,
        sourceExternalId: true,
        headline: true,
        sourcePublishedAt: true,
        suggestedTeams: { select: { teamId: true } },
      },
    });
    return records.map((record) => ({
      ...record,
      teamIds: record.suggestedTeams.map(({ teamId }) => teamId),
    }));
  }

  async findDuplicateArticles(): Promise<readonly DuplicateArticle[]> {
    const records = await this.prisma.article.findMany({
      where: { status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        sourceUrl: true,
        title: true,
        publishedAt: true,
        createdAt: true,
        teams: { select: { teamId: true } },
      },
    });
    return records.map((record) => ({
      ...record,
      teamIds: record.teams.map(({ teamId }) => teamId),
    }));
  }

  async slugExists(slug: string): Promise<boolean> {
    return (await this.prisma.article.count({ where: { slug } })) > 0;
  }

  createDraft(
    input: DraftPersistenceInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const databaseStarted = performance.now();
      const current = await transaction.newsCandidate.findUnique({
        where: { id: input.candidate.id },
        select: { status: true, convertedArticleId: true },
      });
      if (current === null) throw new Error('Candidate is no longer available');
      if (current.convertedArticleId !== null || current.status === 'DISMISSED')
        throw new Error('Candidate is no longer available');
      const article = await createArticleInTransaction(
        transaction,
        input.fields,
        input.teamIds,
        actor,
        'AI draft generated; human review required.',
        requestId,
      );
      if (input.playerIds.length > 0)
        await transaction.articlePlayer.createMany({
          data: input.playerIds.map((playerId) => ({ articleId: article.id, playerId })),
        });
      await transaction.articleAiMetadata.create({
        data: {
          articleId: article.id,
          candidateId: input.candidate.id,
          ...input.metadata,
          riskFlags: [...input.metadata.riskFlags],
          topicTags: [...input.metadata.topicTags],
          mediaSearchTerms: [...input.metadata.mediaSearchTerms],
          reviewStatus: 'NEEDS_REVIEW',
        },
      });
      await transaction.newsCandidate.update({
        where: { id: input.candidate.id },
        data: {
          status: 'CONVERTED',
          convertedArticleId: article.id,
          reviewedById: actor.userId,
          reviewedBySnapshot: actor.email,
          reviewedAt: input.metadata.generatedAt,
        },
      });
      await transaction.adminAuditEvent.create({
        data: {
          actorUserId: actor.userId,
          actorEmailSnapshot: actor.email,
          action: 'ARTICLE_AI_DRAFT_GENERATED',
          entityType: 'ARTICLE',
          entityId: article.id,
          requestId,
          afterSnapshot: sanitizeAuditSnapshot({
            candidateId: input.candidate.id,
            promptVersion: input.metadata.promptVersion,
            provider: input.metadata.provider,
            model: input.metadata.model,
            confidence: input.metadata.confidence,
            riskFlags: input.metadata.riskFlags,
            reviewStatus: 'NEEDS_REVIEW',
          }),
        },
      });
      const databaseDurationMs = Math.max(0, Math.round(performance.now() - databaseStarted));
      await transaction.articleAiMetadata.update({
        where: { articleId: article.id },
        data: {
          databaseDurationMs,
          totalDurationMs: input.metadata.totalDurationMs + databaseDurationMs,
        },
      });
      return { articleId: article.id, slug: article.slug, version: article.version };
    });
  }

  regenerateDraft(
    articleId: string,
    expectedVersion: number,
    input: DraftPersistenceInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.article.findUnique({
        where: { id: articleId },
        include: articleInclude,
      });
      if (before === null) return null;
      if (before.version !== expectedVersion || before.status !== 'DRAFT') return null;
      if ((await transaction.articleAiMetadata.count({ where: { articleId } })) !== 1) return null;
      const updated = await transaction.article.updateMany({
        where: { id: articleId, version: expectedVersion, status: 'DRAFT' },
        data: {
          ...input.fields,
          version: { increment: 1 },
          updatedById: actor.userId,
          updatedBySnapshot: actor.email,
        },
      });
      if (updated.count !== 1) return null;
      await transaction.articleTeam.deleteMany({ where: { articleId } });
      if (input.teamIds.length > 0)
        await transaction.articleTeam.createMany({
          data: input.teamIds.map((teamId) => ({ articleId, teamId })),
        });
      await transaction.articlePlayer.deleteMany({ where: { articleId } });
      if (input.playerIds.length > 0)
        await transaction.articlePlayer.createMany({
          data: input.playerIds.map((playerId) => ({ articleId, playerId })),
        });
      const after = await transaction.article.findUniqueOrThrow({
        where: { id: articleId },
        include: articleInclude,
      });
      await transaction.articleRevision.create({
        data: {
          articleId,
          revisionNumber: after.version,
          editorUserId: actor.userId,
          editorSnapshot: actor.email,
          snapshot: revisionSnapshot(after),
          changeSummary: 'AI draft regenerated; human review required.',
        },
      });
      await transaction.articleAiMetadata.update({
        where: { articleId },
        data: {
          ...input.metadata,
          riskFlags: [...input.metadata.riskFlags],
          topicTags: [...input.metadata.topicTags],
          mediaSearchTerms: [...input.metadata.mediaSearchTerms],
          reviewStatus: 'NEEDS_REVIEW',
        },
      });
      await createArticleAudit(
        transaction,
        actor,
        requestId,
        'ARTICLE_AI_DRAFT_REGENERATED',
        after,
        before,
        after,
      );
      return { version: after.version };
    });
  }

  async listCoverage(now: Date, recentSince: Date): Promise<readonly EditorialCoverageRow[]> {
    const [teams, published, recent, drafts, candidates, videoRows] = await Promise.all([
      this.listTeams(),
      this.prisma.articleTeam.groupBy({
        by: ['teamId'],
        where: {
          article: {
            OR: [
              { status: 'PUBLISHED', publishedAt: { lte: now } },
              { status: 'SCHEDULED', scheduledFor: { lte: now } },
            ],
          },
        },
        _count: { _all: true },
      }),
      this.prisma.articleTeam.groupBy({
        by: ['teamId'],
        where: {
          article: {
            OR: [
              { status: 'PUBLISHED', publishedAt: { gte: recentSince, lte: now } },
              { status: 'SCHEDULED', scheduledFor: { gte: recentSince, lte: now } },
            ],
          },
        },
        _count: { _all: true },
      }),
      this.prisma.articleTeam.groupBy({
        by: ['teamId'],
        where: {
          article: {
            status: 'DRAFT',
            aiMetadata: {
              is: {
                reviewStatus: { not: 'REJECTED' },
                overlapStatus: { notIn: ['LIKELY_DUPLICATE', 'DUPLICATE'] },
              },
            },
          },
        },
        _count: { _all: true },
      }),
      this.prisma.newsCandidateTeam.groupBy({
        by: ['teamId'],
        where: { candidate: { status: { in: ['NEW', 'REVIEWING', 'SAVED'] } } },
        _count: { _all: true },
      }),
      this.prisma.articleMediaCandidate.findMany({
        where: {
          status: 'ATTACHED',
          type: { in: ['YOUTUBE', 'VIDEO_EMBED'] },
          article: {
            OR: [
              { status: 'PUBLISHED', publishedAt: { lte: now } },
              { status: 'SCHEDULED', scheduledFor: { lte: now } },
            ],
          },
        },
        select: { articleId: true, article: { select: { teams: { select: { teamId: true } } } } },
      }),
    ]);
    const map = (rows: readonly { teamId: string; _count: { _all: number } }[]) =>
      new Map(rows.map((row) => [row.teamId, row._count._all]));
    const video = new Map<string, Set<string>>();
    for (const row of videoRows)
      for (const { teamId } of row.article.teams) {
        const ids = video.get(teamId) ?? new Set<string>();
        ids.add(row.articleId);
        video.set(teamId, ids);
      }
    const p = map(published),
      r = map(recent),
      d = map(drafts),
      c = map(candidates);
    return teams.map((team) => ({
      id: team.id,
      abbreviation: team.abbreviation,
      publishedCount: p.get(team.id) ?? 0,
      draftCount: d.get(team.id) ?? 0,
      candidateCount: c.get(team.id) ?? 0,
      recentPublishedCount: r.get(team.id) ?? 0,
      videoArticleCount: video.get(team.id)?.size ?? 0,
    }));
  }

  async getCoverageTotals(now: Date) {
    const [totalPublished, totalDrafts, totalCandidates] = await Promise.all([
      this.prisma.article.count({
        where: {
          OR: [
            { status: 'PUBLISHED', publishedAt: { lte: now } },
            { status: 'SCHEDULED', scheduledFor: { lte: now } },
          ],
        },
      }),
      this.prisma.article.count({
        where: {
          status: 'DRAFT',
          aiMetadata: {
            is: {
              reviewStatus: { not: 'REJECTED' },
              overlapStatus: { notIn: ['LIKELY_DUPLICATE', 'DUPLICATE'] },
            },
          },
        },
      }),
      this.prisma.newsCandidate.count({
        where: { status: { in: ['NEW', 'REVIEWING', 'SAVED'] } },
      }),
    ]);
    return { totalPublished, totalDrafts, totalCandidates };
  }

  async setReviewStatus(
    articleId: string,
    status: EditorialAiReviewStatus,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.articleAiMetadata.findUnique({
        where: { articleId },
        select: { reviewStatus: true },
      });
      if (before === null || before.reviewStatus === status) return false;
      await transaction.articleAiMetadata.update({
        where: { articleId },
        data: { reviewStatus: status },
      });
      await transaction.adminAuditEvent.create({
        data: {
          actorUserId: actor.userId,
          actorEmailSnapshot: actor.email,
          action: status === 'APPROVED' ? 'ARTICLE_AI_DRAFT_APPROVED' : 'ARTICLE_AI_DRAFT_REJECTED',
          entityType: 'ARTICLE',
          entityId: articleId,
          requestId,
          beforeSnapshot: { reviewStatus: before.reviewStatus },
          afterSnapshot: { reviewStatus: status },
        },
      });
      return true;
    });
  }

  async attachMedia(
    articleId: string,
    mediaId: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const media = await transaction.articleMediaCandidate.findFirst({
        where: { id: mediaId, articleId },
      });
      if (media === null) return false;
      if (
        media.status !== 'SUGGESTED' ||
        !media.embedAllowed ||
        !['OWNED', 'EMBED_ALLOWED'].includes(media.rightsStatus)
      )
        return false;
      await transaction.articleMediaCandidate.updateMany({
        where: { articleId, isPrimary: true },
        data: { isPrimary: false },
      });
      await transaction.articleMediaCandidate.update({
        where: { id: mediaId },
        data: { status: 'ATTACHED', isPrimary: true },
      });
      await transaction.adminAuditEvent.create({
        data: {
          actorUserId: actor.userId,
          actorEmailSnapshot: actor.email,
          action: 'ARTICLE_MEDIA_ATTACHED',
          entityType: 'ARTICLE',
          entityId: articleId,
          requestId,
          afterSnapshot: { mediaCandidateId: mediaId, type: media.type, platform: media.platform },
        },
      });
      return true;
    });
  }

  async createMediaCandidate(
    articleId: string,
    input: MediaCandidateWrite,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<MediaCandidateRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const article = await transaction.article.findUnique({
        where: { id: articleId },
        select: { id: true, sourceCandidate: { select: { id: true } } },
      });
      if (article === null) return null;
      const media = await transaction.articleMediaCandidate.create({
        data: { articleId, candidateId: article.sourceCandidate?.id ?? null, ...input },
      });
      await transaction.adminAuditEvent.create({
        data: {
          actorUserId: actor.userId,
          actorEmailSnapshot: actor.email,
          action: 'ARTICLE_MEDIA_SUGGESTED',
          entityType: 'ARTICLE',
          entityId: articleId,
          requestId,
          afterSnapshot: sanitizeAuditSnapshot({
            mediaCandidateId: media.id,
            type: media.type,
            platform: media.platform,
            rightsStatus: media.rightsStatus,
            embedAllowed: media.embedAllowed,
          }),
        },
      });
      return media;
    });
  }

  async getSourceRights(sourceId: string): Promise<SourceRightsRecord | null> {
    const profile = await this.prisma.sourceRightsProfile.findUnique({ where: { sourceId } });
    return profile;
  }

  async upsertSourceRights(
    sourceId: string,
    input: SourceRightsWrite,
    actor: AdministrativePrincipal,
    requestId: string | null,
    now: Date,
  ): Promise<SourceRightsRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      if ((await transaction.newsSource.count({ where: { id: sourceId } })) !== 1) return null;
      const profile = await transaction.sourceRightsProfile.upsert({
        where: { sourceId },
        create: {
          sourceId,
          ...input,
          reviewedById: actor.userId,
          reviewedBySnapshot: actor.email,
          reviewedAt: now,
        },
        update: {
          ...input,
          reviewedById: actor.userId,
          reviewedBySnapshot: actor.email,
          reviewedAt: now,
        },
      });
      await transaction.adminAuditEvent.create({
        data: {
          actorUserId: actor.userId,
          actorEmailSnapshot: actor.email,
          action: 'SOURCE_RIGHTS_REVIEWED',
          entityType: 'NEWS_SOURCE',
          entityId: sourceId,
          requestId,
          afterSnapshot: sanitizeAuditSnapshot({
            textUsage: input.textUsage,
            imageUsage: input.imageUsage,
            videoUsage: input.videoUsage,
            quotationPolicy: input.quotationPolicy,
            reviewRequired: input.reviewRequired,
          }),
        },
      });
      return profile;
    });
  }
}

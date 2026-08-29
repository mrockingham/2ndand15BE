import { randomUUID } from 'node:crypto';

import type {
  NewsCandidateStatus,
  NewsIngestionRunStatus,
  NewsSourceStatus,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import { sanitizeAuditSnapshot } from '../admin/audit-sanitizer.js';
import {
  createArticleInTransaction,
  type ArticleWriteFields,
} from '../articles/article.repository.js';
import {
  autoPublishCandidateInclude,
  newsCandidateInclude,
  newsSourceInclude,
  type AutoPublishCandidateRecord,
  type NewsCandidateRecord,
  type NewsIngestionRunRecord,
  type NewsSourceRecord,
} from './news.dto.js';
import type {
  ManualCandidateCreateInput,
  NewsCandidateListQuery,
  NewsSourceCreateInput,
  NewsSourceListQuery,
  NewsSourceUpdateInput,
} from './news.schemas.js';
import type { NormalizedFeedEntry } from './feed-parser.js';

export interface TeamSuggestionWrite {
  readonly teamId: string;
  readonly rule: string;
}

export interface CandidatePage {
  readonly candidates: readonly NewsCandidateRecord[];
  readonly nextCursor: string | null;
}

export interface SourcePage {
  readonly sources: readonly NewsSourceRecord[];
  readonly nextCursor: string | null;
}

export interface IngestionLease {
  readonly id: string;
  readonly run: NewsIngestionRunRecord;
  readonly source: NewsSourceRecord;
}

export interface IngestionCompletion {
  readonly status: Exclude<NewsIngestionRunStatus, 'RUNNING'>;
  readonly fetchedCount: number;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly responseBytes: number | null;
  readonly responseEtag: string | null;
  readonly responseModified: string | null;
  readonly errorCode: string | null;
  readonly errorSummary: string | null;
}

export interface CandidateUpsertResult {
  readonly candidate: NewsCandidateRecord;
  readonly action: 'created' | 'updated' | 'skipped';
}

export interface CandidateConversionWrite {
  readonly fields: ArticleWriteFields;
  readonly teamIds: readonly string[];
  readonly changeSummary: string | null;
  /** M42B: omitted (default) for the human conversion path -- the created
   * article stays DRAFT, exactly as before. The auto-publish path passes
   * this to make the article PUBLISHED atomically at creation. */
  readonly publish?: { readonly status: 'PUBLISHED'; readonly publishedAt: Date } | null;
}

export interface NewsInboxRepository {
  listSources(query: NewsSourceListQuery): Promise<SourcePage>;
  findSource(id: string): Promise<NewsSourceRecord | null>;
  findSourceBySlug(slug: string): Promise<NewsSourceRecord | null>;
  createSource(
    input: NewsSourceCreateInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<NewsSourceRecord>;
  updateSource(
    id: string,
    input: NewsSourceUpdateInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<NewsSourceRecord | null>;
  setSourceStatus(
    id: string,
    status: NewsSourceStatus,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<NewsSourceRecord | null>;
  listRuns(sourceId: string, limit: number): Promise<readonly NewsIngestionRunRecord[]>;
  createSourceAudit(
    source: NewsSourceRecord,
    action: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
    summary?: unknown,
  ): Promise<void>;
  acquireIngestionLease(
    sourceId: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
    now: Date,
  ): Promise<IngestionLease | null>;
  completeIngestion(
    lease: IngestionLease,
    result: IngestionCompletion,
    completedAt: Date,
  ): Promise<NewsIngestionRunRecord>;
  listSuggestionTeams(): Promise<readonly { id: string; fullName: string; abbreviation: string }[]>;
  /** M30D: the newest `sourcePublishedAt` ever persisted for this source, used as the
   * steady-state late/out-of-order watermark. Derives from existing candidate rows --
   * no new schema state. */
  getMaxCandidatePublishedAt(sourceId: string): Promise<Date | null>;
  /** M30D: whether this source has ever written a real candidate. Deliberately not
   * based on `lastSuccessfulAt` -- that field is also set by a no-write `testSource`
   * dry run (pre-existing behavior), so a source that was only ever tested, never
   * really ingested, must still count as never-initialized. */
  hasAnyCandidates(sourceId: string): Promise<boolean>;
  /** M30D: read-only existence check by the same identity priority `upsertFeedCandidate`
   * uses (external ID, then canonical URL hash), so the late/out-of-order guard can tell
   * an already-known item from a genuinely new one without writing anything. */
  candidateExists(
    sourceId: string,
    externalId: string | null,
    canonicalUrlHash: string,
  ): Promise<boolean>;
  upsertFeedCandidate(
    source: NewsSourceRecord,
    entry: NormalizedFeedEntry,
    suggestions: readonly TeamSuggestionWrite[],
    discoveredAt: Date,
  ): Promise<CandidateUpsertResult>;
  listCandidates(query: NewsCandidateListQuery): Promise<CandidatePage>;
  /** M42B: bounded candidate pool for the auto-publish pass and its dry-run
   * preview. Pre-filters at the DB level only on the *structural* source
   * facts that never depend on the trust decision being evaluated
   * (status=ACTIVE, contentType=ARTICLE, kind!=MANUAL_ONLY) and
   * candidate.status=NEW. Deliberately does NOT filter on
   * `autoPublishArticles` here -- the preview CLI must be able to show
   * "how many candidates would be eligible if this source were trusted"
   * for a source that isn't flagged yet (ticket §R), so every remaining
   * SOURCE/CANDIDATE rule (including `autoPublishArticles` itself) is
   * evaluated per-row by `evaluateAutoPublishEligibility` in application
   * code -- for both preview (show all, with reasons) and the real run
   * (keep only the eligible ones). */
  listAutoPublishCandidatePool(limit: number): Promise<readonly AutoPublishCandidateRecord[]>;
  findCandidate(id: string): Promise<NewsCandidateRecord | null>;
  createManualCandidate(
    input: ManualCandidateCreateInput,
    canonicalUrl: string,
    canonicalUrlHash: string,
    suggestions: readonly TeamSuggestionWrite[],
    actor: AdministrativePrincipal,
    requestId: string | null,
    now: Date,
  ): Promise<NewsCandidateRecord | null>;
  updateCandidateStatus(
    id: string,
    expected: readonly NewsCandidateStatus[],
    status: NewsCandidateStatus,
    reason: string | null,
    actor: AdministrativePrincipal,
    requestId: string | null,
    now: Date,
  ): Promise<NewsCandidateRecord | null>;
  convertCandidate(
    id: string,
    expectedStatus: readonly NewsCandidateStatus[],
    write: CandidateConversionWrite,
    actor: AdministrativePrincipal,
    requestId: string | null,
    now: Date,
    /** M42B: `'NEWS_CANDIDATE_CONVERTED'` for the human editor path (the
     * default, unchanged). Auto-publish passes `'NEWS_CANDIDATE_AUTO_PUBLISHED'`
     * plus a reason so the audit trail never looks like a human converted
     * the candidate. */
    auditAction?: string,
    auditReason?: string | null,
  ): Promise<{
    candidate: NewsCandidateRecord;
    article: Awaited<ReturnType<typeof createArticleInTransaction>>;
  } | null>;
}

export class PrismaNewsInboxRepository implements NewsInboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listSources(query: NewsSourceListQuery): Promise<SourcePage> {
    const sources = await this.prisma.newsSource.findMany({
      where: {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.contentType === undefined ? {} : { contentType: query.contentType }),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      include: newsSourceInclude,
    });
    const hasMore = sources.length > query.limit;
    const page = hasMore ? sources.slice(0, query.limit) : sources;
    return { sources: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  }

  findSource(id: string): Promise<NewsSourceRecord | null> {
    return this.prisma.newsSource.findUnique({ where: { id }, include: newsSourceInclude });
  }

  findSourceBySlug(slug: string): Promise<NewsSourceRecord | null> {
    return this.prisma.newsSource.findUnique({ where: { slug }, include: newsSourceInclude });
  }

  createSource(
    input: NewsSourceCreateInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<NewsSourceRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const source = await transaction.newsSource.create({
        data: {
          ...input,
          createdById: actor.userId,
          updatedById: actor.userId,
          createdBySnapshot: actor.email,
          updatedBySnapshot: actor.email,
        },
        include: newsSourceInclude,
      });
      await createAudit(
        transaction,
        actor,
        requestId,
        'NEWS_SOURCE_CREATED',
        'NEWS_SOURCE',
        source.id,
        null,
        compactSource(source),
      );
      return source;
    });
  }

  updateSource(
    id: string,
    input: NewsSourceUpdateInput,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<NewsSourceRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.newsSource.findUnique({
        where: { id },
        include: newsSourceInclude,
      });
      if (before === null) return null;
      const after = await transaction.newsSource.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.slug === undefined ? {} : { slug: input.slug }),
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.feedUrl === undefined ? {} : { feedUrl: input.feedUrl }),
          ...(input.siteUrl === undefined ? {} : { siteUrl: input.siteUrl }),
          ...(input.publisherName === undefined ? {} : { publisherName: input.publisherName }),
          ...(input.defaultTeamId === undefined ? {} : { defaultTeamId: input.defaultTeamId }),
          ...(input.isOfficialLeague === undefined
            ? {}
            : { isOfficialLeague: input.isOfficialLeague }),
          ...(input.isOfficialTeam === undefined ? {} : { isOfficialTeam: input.isOfficialTeam }),
          ...(input.allowsDescriptionUse === undefined
            ? {}
            : { allowsDescriptionUse: input.allowsDescriptionUse }),
          ...(input.autoPublishArticles === undefined
            ? {}
            : { autoPublishArticles: input.autoPublishArticles }),
          ...(input.reliabilityWeight === undefined
            ? {}
            : { reliabilityWeight: input.reliabilityWeight }),
          ...(input.metadataRichnessWeight === undefined
            ? {}
            : { metadataRichnessWeight: input.metadataRichnessWeight }),
          ...(input.teamSpecificityWeight === undefined
            ? {}
            : { teamSpecificityWeight: input.teamSpecificityWeight }),
          ...(input.editorialUsefulnessWeight === undefined
            ? {}
            : { editorialUsefulnessWeight: input.editorialUsefulnessWeight }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          updatedById: actor.userId,
          updatedBySnapshot: actor.email,
        },
        include: newsSourceInclude,
      });
      await createAudit(
        transaction,
        actor,
        requestId,
        'NEWS_SOURCE_UPDATED',
        'NEWS_SOURCE',
        id,
        compactSource(before),
        compactSource(after),
      );
      return after;
    });
  }

  setSourceStatus(
    id: string,
    status: NewsSourceStatus,
    actor: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<NewsSourceRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.newsSource.findUnique({
        where: { id },
        include: newsSourceInclude,
      });
      if (before === null) return null;
      const after = await transaction.newsSource.update({
        where: { id },
        data: { status, updatedById: actor.userId, updatedBySnapshot: actor.email },
        include: newsSourceInclude,
      });
      const action =
        status === 'PAUSED'
          ? 'NEWS_SOURCE_PAUSED'
          : status === 'ACTIVE'
            ? 'NEWS_SOURCE_RESUMED'
            : 'NEWS_SOURCE_UPDATED';
      await createAudit(
        transaction,
        actor,
        requestId,
        action,
        'NEWS_SOURCE',
        id,
        compactSource(before),
        compactSource(after),
      );
      return after;
    });
  }

  listRuns(sourceId: string, limit: number): Promise<readonly NewsIngestionRunRecord[]> {
    return this.prisma.newsIngestionRun.findMany({
      where: { sourceId },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  createSourceAudit(
    source: NewsSourceRecord,
    action: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
    summary: unknown = {},
  ): Promise<void> {
    return createAudit(
      this.prisma,
      actor,
      requestId,
      action,
      'NEWS_SOURCE',
      source.id,
      null,
      summary,
    );
  }

  acquireIngestionLease(
    sourceId: string,
    actor: AdministrativePrincipal,
    requestId: string | null,
    now: Date,
  ): Promise<IngestionLease | null> {
    const leaseId = randomUUID();
    const staleBefore = new Date(now.getTime() - 15 * 60_000);
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.newsSource.findUnique({
        where: { id: sourceId },
        select: { ingestionLeaseId: true, ingestionLeaseStartedAt: true },
      });
      if (current === null) return null;
      if (
        current.ingestionLeaseId !== null &&
        current.ingestionLeaseStartedAt !== null &&
        current.ingestionLeaseStartedAt >= staleBefore
      ) {
        return null;
      }
      if (current.ingestionLeaseId !== null) {
        await transaction.newsIngestionRun.updateMany({
          where: { sourceId, status: 'RUNNING' },
          data: {
            status: 'FAILED',
            completedAt: now,
            failedCount: 1,
            errorCode: 'NEWS_INGESTION_LEASE_EXPIRED',
            errorSummary: 'The prior ingestion lease expired before completion.',
          },
        });
      }
      const claimed = await transaction.newsSource.updateMany({
        where: {
          id: sourceId,
          OR: [{ ingestionLeaseId: null }, { ingestionLeaseStartedAt: { lt: staleBefore } }],
        },
        data: { ingestionLeaseId: leaseId, ingestionLeaseStartedAt: now, lastCheckedAt: now },
      });
      if (claimed.count !== 1) return null;
      const source = await transaction.newsSource.findUniqueOrThrow({
        where: { id: sourceId },
        include: newsSourceInclude,
      });
      const run = await transaction.newsIngestionRun.create({
        data: {
          sourceId,
          status: 'RUNNING',
          startedAt: now,
          initiatedById: actor.userId,
          initiatedBySnapshot: actor.email,
          requestId,
        },
      });
      await createAudit(
        transaction,
        actor,
        requestId,
        'NEWS_INGESTION_INITIATED',
        'NEWS_INGESTION_RUN',
        run.id,
        null,
        { sourceId, sourceSlug: source.slug, runId: run.id },
      );
      return { id: leaseId, run, source };
    });
  }

  completeIngestion(
    lease: IngestionLease,
    result: IngestionCompletion,
    completedAt: Date,
  ): Promise<NewsIngestionRunRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const run = await transaction.newsIngestionRun.update({
        where: { id: lease.run.id },
        data: { ...result, completedAt },
      });
      const failed = result.status === 'FAILED';
      await transaction.newsSource.updateMany({
        where: { id: lease.source.id, ingestionLeaseId: lease.id },
        data: {
          ingestionLeaseId: null,
          ingestionLeaseStartedAt: null,
          lastCheckedAt: completedAt,
          lastItemCount: result.fetchedCount,
          ...(failed
            ? {
                lastErrorCode: result.errorCode,
                lastErrorSummary: result.errorSummary,
                consecutiveFailureCount: { increment: 1 },
                ...(lease.source.status === 'ACTIVE' || lease.source.status === 'ERROR'
                  ? { status: 'ERROR' as const }
                  : {}),
              }
            : {
                lastSuccessfulAt: completedAt,
                lastErrorCode: result.errorCode,
                lastErrorSummary: result.errorSummary,
                consecutiveFailureCount: 0,
                responseEtag: result.responseEtag,
                responseModified: result.responseModified,
                ...(lease.source.status === 'ERROR' ? { status: 'ACTIVE' as const } : {}),
              }),
        },
      });
      return run;
    });
  }

  listSuggestionTeams(): Promise<
    readonly { id: string; fullName: string; abbreviation: string }[]
  > {
    return this.prisma.team.findMany({
      where: { league: 'NFL', isActive: true },
      select: { id: true, fullName: true, abbreviation: true },
    });
  }

  async getMaxCandidatePublishedAt(sourceId: string): Promise<Date | null> {
    const result = await this.prisma.newsCandidate.aggregate({
      where: { sourceId },
      _max: { sourcePublishedAt: true },
    });
    return result._max.sourcePublishedAt;
  }

  async hasAnyCandidates(sourceId: string): Promise<boolean> {
    const existing = await this.prisma.newsCandidate.findFirst({
      where: { sourceId },
      select: { id: true },
    });
    return existing !== null;
  }

  async candidateExists(
    sourceId: string,
    externalId: string | null,
    canonicalUrlHash: string,
  ): Promise<boolean> {
    if (externalId !== null) {
      const byExternalId = await this.prisma.newsCandidate.findFirst({
        where: { sourceId, sourceExternalId: externalId },
        select: { id: true },
      });
      if (byExternalId !== null) return true;
    }
    const byHash = await this.prisma.newsCandidate.findUnique({
      where: { canonicalUrlHash },
      select: { id: true },
    });
    return byHash !== null;
  }

  upsertFeedCandidate(
    source: NewsSourceRecord,
    entry: NormalizedFeedEntry,
    suggestions: readonly TeamSuggestionWrite[],
    discoveredAt: Date,
  ): Promise<CandidateUpsertResult> {
    return this.prisma.$transaction(async (transaction) => {
      const byExternalId =
        entry.externalId === null
          ? null
          : await transaction.newsCandidate.findFirst({
              where: { sourceId: source.id, sourceExternalId: entry.externalId },
              include: newsCandidateInclude,
            });
      const existing =
        byExternalId ??
        (await transaction.newsCandidate.findUnique({
          where: { canonicalUrlHash: entry.canonicalUrlHash },
          include: newsCandidateInclude,
        }));
      if (existing !== null) {
        const changed =
          existing.headline !== entry.headline ||
          existing.canonicalUrl !== entry.canonicalUrl ||
          existing.sourceDescription !== entry.description ||
          existing.sourceAuthor !== entry.author ||
          existing.sourcePublishedAt?.getTime() !== entry.publishedAt?.getTime() ||
          existing.contentType !== source.contentType ||
          existing.mediaThumbnailUrl !== entry.thumbnailUrl;
        if (!changed) return { candidate: existing, action: 'skipped' };
        const candidate = await transaction.newsCandidate.update({
          where: { id: existing.id },
          data: {
            headline: entry.headline,
            canonicalUrl: entry.canonicalUrl,
            canonicalUrlHash: entry.canonicalUrlHash,
            sourceDescription: entry.description,
            sourceAuthor: entry.author,
            sourcePublishedAt: entry.publishedAt,
            contentType: source.contentType,
            mediaThumbnailUrl: entry.thumbnailUrl,
            ...(existing.sourceExternalId === null ? { sourceExternalId: entry.externalId } : {}),
            ...(existing.status === 'NEW'
              ? {
                  suggestedTeams: {
                    deleteMany: {},
                    create: suggestions.map(({ teamId, rule }) => ({ teamId, rule })),
                  },
                }
              : {}),
          },
          include: newsCandidateInclude,
        });
        return { candidate, action: 'updated' };
      }
      const candidate = await transaction.newsCandidate.create({
        data: {
          sourceId: source.id,
          sourceNameSnapshot: source.publisherName,
          sourceExternalId: entry.externalId,
          canonicalUrl: entry.canonicalUrl,
          canonicalUrlHash: entry.canonicalUrlHash,
          headline: entry.headline,
          sourceDescription: entry.description,
          sourceAuthor: entry.author,
          sourcePublishedAt: entry.publishedAt,
          contentType: source.contentType,
          mediaThumbnailUrl: entry.thumbnailUrl,
          discoveredAt,
          suggestedTeams: {
            create: suggestions.map(({ teamId, rule }) => ({ teamId, rule })),
          },
        },
        include: newsCandidateInclude,
      });
      return { candidate, action: 'created' };
    });
  }

  listAutoPublishCandidatePool(limit: number): Promise<readonly AutoPublishCandidateRecord[]> {
    return this.prisma.newsCandidate.findMany({
      where: {
        status: 'NEW',
        source: { status: 'ACTIVE', contentType: 'ARTICLE', kind: { not: 'MANUAL_ONLY' } },
      },
      orderBy: [{ sourcePublishedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      include: autoPublishCandidateInclude,
    });
  }

  async listCandidates(query: NewsCandidateListQuery): Promise<CandidatePage> {
    const candidates = await this.prisma.newsCandidate.findMany({
      where: {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.sourceId === undefined ? {} : { sourceId: query.sourceId }),
        ...(query.teamId === undefined
          ? {}
          : { suggestedTeams: { some: { teamId: query.teamId } } }),
        ...(query.publishedFrom === undefined && query.publishedTo === undefined
          ? {}
          : {
              sourcePublishedAt: {
                ...(query.publishedFrom === undefined
                  ? {}
                  : { gte: new Date(query.publishedFrom) }),
                ...(query.publishedTo === undefined ? {} : { lte: new Date(query.publishedTo) }),
              },
            }),
        ...(query.search === undefined
          ? {}
          : {
              OR: [
                { headline: { contains: query.search, mode: 'insensitive' as const } },
                { sourceNameSnapshot: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }),
      },
      orderBy: [{ discoveredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      include: newsCandidateInclude,
    });
    const hasMore = candidates.length > query.limit;
    const page = hasMore ? candidates.slice(0, query.limit) : candidates;
    return { candidates: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  }

  findCandidate(id: string): Promise<NewsCandidateRecord | null> {
    return this.prisma.newsCandidate.findUnique({ where: { id }, include: newsCandidateInclude });
  }

  createManualCandidate(
    input: ManualCandidateCreateInput,
    canonicalUrl: string,
    canonicalUrlHash: string,
    suggestions: readonly TeamSuggestionWrite[],
    actor: AdministrativePrincipal,
    requestId: string | null,
    now: Date,
  ): Promise<NewsCandidateRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const duplicate = await transaction.newsCandidate.findUnique({ where: { canonicalUrlHash } });
      if (duplicate !== null) return null;
      const candidate = await transaction.newsCandidate.create({
        data: {
          sourceId: input.sourceId,
          sourceNameSnapshot: input.sourceName,
          canonicalUrl,
          canonicalUrlHash,
          headline: input.headline,
          sourceDescription: input.sourceDescription,
          sourceAuthor: input.sourceAuthor,
          sourcePublishedAt:
            input.sourcePublishedAt === null ? null : new Date(input.sourcePublishedAt),
          discoveredAt: now,
          reviewedById: actor.userId,
          reviewedBySnapshot: actor.email,
          reviewedAt: now,
          suggestedTeams: {
            create: suggestions.map(({ teamId, rule }) => ({ teamId, rule })),
          },
        },
        include: newsCandidateInclude,
      });
      await createAudit(
        transaction,
        actor,
        requestId,
        'NEWS_CANDIDATE_MANUALLY_SUBMITTED',
        'NEWS_CANDIDATE',
        candidate.id,
        null,
        compactCandidate(candidate),
      );
      return candidate;
    });
  }

  updateCandidateStatus(
    id: string,
    expected: readonly NewsCandidateStatus[],
    status: NewsCandidateStatus,
    reason: string | null,
    actor: AdministrativePrincipal,
    requestId: string | null,
    now: Date,
  ): Promise<NewsCandidateRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.newsCandidate.findUnique({
        where: { id },
        include: newsCandidateInclude,
      });
      if (before === null || !expected.includes(before.status)) return null;
      const updated = await transaction.newsCandidate.updateMany({
        where: { id, status: before.status },
        data: {
          status,
          dismissalReason: reason,
          reviewedById: actor.userId,
          reviewedBySnapshot: actor.email,
          reviewedAt: now,
        },
      });
      if (updated.count !== 1) return null;
      const after = await transaction.newsCandidate.findUniqueOrThrow({
        where: { id },
        include: newsCandidateInclude,
      });
      const action =
        status === 'DISMISSED' ? 'NEWS_CANDIDATE_DISMISSED' : 'NEWS_CANDIDATE_STATE_CHANGED';
      await createAudit(
        transaction,
        actor,
        requestId,
        action,
        'NEWS_CANDIDATE',
        id,
        compactCandidate(before),
        compactCandidate(after),
        reason,
      );
      return after;
    });
  }

  convertCandidate(
    id: string,
    expectedStatus: readonly NewsCandidateStatus[],
    write: CandidateConversionWrite,
    actor: AdministrativePrincipal,
    requestId: string | null,
    now: Date,
    auditAction = 'NEWS_CANDIDATE_CONVERTED',
    auditReason: string | null = null,
  ): Promise<{
    candidate: NewsCandidateRecord;
    article: Awaited<ReturnType<typeof createArticleInTransaction>>;
  } | null> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.newsCandidate.findUnique({
        where: { id },
        include: newsCandidateInclude,
      });
      if (before === null) return null;
      if (before.convertedArticleId !== null || !expectedStatus.includes(before.status))
        return null;
      const activeTeams = await transaction.team.count({
        where: { id: { in: [...write.teamIds] }, league: 'NFL', isActive: true },
      });
      if (activeTeams !== write.teamIds.length) return null;
      const slugExists = await transaction.article.findUnique({
        where: { slug: write.fields.slug },
        select: { id: true },
      });
      if (slugExists !== null) return null;
      const article = await createArticleInTransaction(
        transaction,
        write.fields,
        write.teamIds,
        actor,
        write.changeSummary,
        requestId,
        write.publish ?? null,
      );
      const updated = await transaction.newsCandidate.updateMany({
        where: { id, status: before.status, convertedArticleId: null },
        data: {
          status: 'CONVERTED',
          convertedArticleId: article.id,
          dismissalReason: null,
          reviewedById: actor.userId,
          reviewedBySnapshot: actor.email,
          reviewedAt: now,
        },
      });
      if (updated.count !== 1) throw new Error('Concurrent candidate conversion');
      const candidate = await transaction.newsCandidate.findUniqueOrThrow({
        where: { id },
        include: newsCandidateInclude,
      });
      await createAudit(
        transaction,
        actor,
        requestId,
        auditAction,
        'NEWS_CANDIDATE',
        id,
        compactCandidate(before),
        { ...compactCandidate(candidate), articleId: article.id },
        auditReason,
      );
      return { candidate, article };
    });
  }
}

async function createAudit(
  transaction: Pick<PrismaClient, 'adminAuditEvent'> | Prisma.TransactionClient,
  actor: AdministrativePrincipal,
  requestId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  reason: string | null = null,
): Promise<void> {
  await transaction.adminAuditEvent.create({
    data: {
      actorUserId: actor.userId,
      actorEmailSnapshot: actor.email,
      action,
      entityType,
      entityId,
      requestId,
      reason,
      ...(before === null ? {} : { beforeSnapshot: sanitizeAuditSnapshot(before) }),
      afterSnapshot: sanitizeAuditSnapshot(after),
    },
  });
}

function compactSource(source: NewsSourceRecord): Prisma.InputJsonObject {
  return sanitizeAuditSnapshot({
    slug: source.slug,
    name: source.name,
    kind: source.kind,
    status: source.status,
    publisherName: source.publisherName,
    defaultTeamId: source.defaultTeamId,
    isOfficialLeague: source.isOfficialLeague,
    isOfficialTeam: source.isOfficialTeam,
    allowsDescriptionUse: source.allowsDescriptionUse,
    autoPublishArticles: source.autoPublishArticles,
    hasFeedUrl: source.feedUrl !== null,
  });
}

function compactCandidate(candidate: NewsCandidateRecord): Prisma.InputJsonObject {
  return sanitizeAuditSnapshot({
    sourceId: candidate.sourceId,
    sourceName: candidate.sourceNameSnapshot,
    headline: candidate.headline,
    canonicalUrlHash: candidate.canonicalUrlHash,
    status: candidate.status,
    convertedArticleId: candidate.convertedArticleId,
    suggestedTeamIds: candidate.suggestedTeams.map(({ teamId }) => teamId),
  });
}

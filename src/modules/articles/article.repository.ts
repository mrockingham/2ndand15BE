import { createHash } from 'node:crypto';

import type {
  ArticleStatus,
  ArticleType,
  NewsContentType,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import { sanitizeAuditSnapshot } from '../admin/audit-sanitizer.js';
import { articleInclude, type ArticleRecord, type ArticleRevisionRecord } from './article.dto.js';
import type {
  AdminArticleListQuery,
  PublicArticleListQuery,
  RevisionListQuery,
} from './article.schemas.js';

export interface ArticleWriteFields {
  readonly type: ArticleType;
  readonly title: string;
  readonly slug: string;
  readonly summary: string | null;
  readonly body: string | null;
  readonly contentType: NewsContentType;
  readonly mediaThumbnailUrl: string | null;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
  readonly sourcePublishedAt: Date | null;
  readonly sourceIsOfficialTeam: boolean;
  readonly heroImageUrl: string | null;
  readonly heroImageAlt: string | null;
  readonly heroImageAttribution: string | null;
  readonly heroImageAttributionUrl: string | null;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly isFeatured: boolean;
  readonly featuredPriority: number | null;
  readonly featuredStartsAt: Date | null;
  readonly featuredEndsAt: Date | null;
}

export interface ArticleMutation {
  readonly fields?: Partial<ArticleWriteFields>;
  readonly status?: ArticleStatus;
  readonly publishedAt?: Date | null;
  readonly scheduledFor?: Date | null;
  readonly teamIds?: readonly string[];
  readonly action: string;
  readonly changeSummary: string | null;
}

export interface ArticlePage {
  readonly articles: readonly ArticleRecord[];
  readonly nextCursor: string | null;
}

export interface RevisionPage {
  readonly revisions: readonly ArticleRevisionRecord[];
  readonly nextCursor: string | null;
}

export interface ArticleRepository {
  findById(id: string): Promise<ArticleRecord | null>;
  findBySlug(slug: string): Promise<ArticleRecord | null>;
  findPublicBySlug(slug: string, now: Date): Promise<ArticleRecord | null>;
  listAdmin(query: AdminArticleListQuery): Promise<ArticlePage>;
  listPublicCandidates(
    query: PublicArticleListQuery,
    now: Date,
    maximum: number,
  ): Promise<readonly ArticleRecord[]>;
  findActiveTeamIds(teamIds: readonly string[]): Promise<readonly string[]>;
  findActiveTeamIdByAbbreviation(abbreviation: string): Promise<string | null>;
  create(
    fields: ArticleWriteFields,
    teamIds: readonly string[],
    principal: AdministrativePrincipal,
    changeSummary: string | null,
    requestId: string | null,
  ): Promise<ArticleRecord>;
  mutate(
    id: string,
    expectedVersion: number,
    mutation: ArticleMutation,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ArticleRecord | null>;
  listRevisions(articleId: string, query: RevisionListQuery): Promise<RevisionPage>;
  findRevision(articleId: string, revisionId: string): Promise<ArticleRevisionRecord | null>;
  delete(
    id: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<boolean>;
}

export class PrismaArticleRepository implements ArticleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<ArticleRecord | null> {
    return this.prisma.article.findUnique({ where: { id }, include: articleInclude });
  }

  findBySlug(slug: string): Promise<ArticleRecord | null> {
    return this.prisma.article.findUnique({ where: { slug }, include: articleInclude });
  }

  findPublicBySlug(slug: string, now: Date): Promise<ArticleRecord | null> {
    return this.prisma.article.findFirst({
      where: { slug, ...publicVisibilityWhere(now) },
      include: articleInclude,
    });
  }

  async listAdmin(query: AdminArticleListQuery): Promise<ArticlePage> {
    const articles = await this.prisma.article.findMany({
      where: {
        ...(query.status === undefined
          ? { status: { not: 'ARCHIVED' as const } }
          : { status: query.status }),
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.contentType === undefined ? {} : { contentType: query.contentType }),
        ...(query.featured === undefined ? {} : { isFeatured: query.featured }),
        ...(query.authorId === undefined ? {} : { createdById: query.authorId }),
        ...(query.teamId === undefined ? {} : { teams: { some: { teamId: query.teamId } } }),
        ...(query.search === undefined
          ? {}
          : {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' as const } },
                { summary: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      include: articleInclude,
    });
    const hasMore = articles.length > query.limit;
    const page = hasMore ? articles.slice(0, query.limit) : articles;
    return { articles: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  }

  listPublicCandidates(
    query: PublicArticleListQuery,
    now: Date,
    maximum: number,
  ): Promise<readonly ArticleRecord[]> {
    return this.prisma.article.findMany({
      where: {
        ...publicVisibilityWhere(now),
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.contentType === undefined ? {} : { contentType: query.contentType }),
        ...(query.featured === undefined ? {} : { isFeatured: query.featured }),
        ...(query.teamId === undefined ? {} : { teams: { some: { teamId: query.teamId } } }),
        ...(query.search === undefined
          ? {}
          : {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' as const } },
                { summary: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: maximum + 1,
      include: articleInclude,
    });
  }

  async findActiveTeamIds(teamIds: readonly string[]): Promise<readonly string[]> {
    if (teamIds.length === 0) return [];
    const teams = await this.prisma.team.findMany({
      where: { id: { in: [...teamIds] }, league: 'NFL', isActive: true },
      select: { id: true },
    });
    return teams.map(({ id }) => id);
  }

  async findActiveTeamIdByAbbreviation(abbreviation: string): Promise<string | null> {
    const team = await this.prisma.team.findUnique({
      where: { league_abbreviation: { league: 'NFL', abbreviation } },
      select: { id: true, isActive: true },
    });
    return team?.isActive === true ? team.id : null;
  }

  create(
    fields: ArticleWriteFields,
    teamIds: readonly string[],
    principal: AdministrativePrincipal,
    changeSummary: string | null,
    requestId: string | null,
  ): Promise<ArticleRecord> {
    return this.prisma.$transaction((transaction) =>
      createArticleInTransaction(transaction, fields, teamIds, principal, changeSummary, requestId),
    );
  }

  mutate(
    id: string,
    expectedVersion: number,
    mutation: ArticleMutation,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<ArticleRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.article.findUnique({
        where: { id },
        include: articleInclude,
      });
      if (before?.version !== expectedVersion) return null;

      const update = await transaction.article.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...mutation.fields,
          ...(mutation.status === undefined ? {} : { status: mutation.status }),
          ...(mutation.publishedAt === undefined ? {} : { publishedAt: mutation.publishedAt }),
          ...(mutation.scheduledFor === undefined ? {} : { scheduledFor: mutation.scheduledFor }),
          version: { increment: 1 },
          updatedById: principal.userId,
          updatedBySnapshot: principal.email,
        },
      });
      if (update.count !== 1) return null;
      if (mutation.teamIds !== undefined) {
        await transaction.articleTeam.deleteMany({ where: { articleId: id } });
        if (mutation.teamIds.length > 0) {
          await transaction.articleTeam.createMany({
            data: mutation.teamIds.map((teamId) => ({ articleId: id, teamId })),
          });
        }
      }
      const after = await transaction.article.findUniqueOrThrow({
        where: { id },
        include: articleInclude,
      });
      await transaction.articleRevision.create({
        data: {
          articleId: id,
          revisionNumber: after.version,
          editorUserId: principal.userId,
          editorSnapshot: principal.email,
          snapshot: revisionSnapshot(after),
          changeSummary: mutation.changeSummary,
        },
      });
      await createArticleAudit(
        transaction,
        principal,
        requestId,
        mutation.action,
        after,
        before,
        after,
      );
      return after;
    });
  }

  async delete(
    id: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const article = await transaction.article.findUnique({
        where: { id },
        include: articleInclude,
      });
      if (article === null) return false;
      // Permanent deletion is terminal -- unlike `mutate`, there's no
      // optimistic-concurrency check here (no "after" state a concurrent
      // editor could clobber). A second delete of the same id simply finds
      // nothing and returns false, which the service maps to 404 -- callers
      // can safely retry a delete without special-casing "already gone".
      //
      // NewsCandidate.convertedArticleId has onDelete: Restrict, and the DB's
      // news_candidates_conversion_check requires status and
      // convertedArticleId to agree (CONVERTED iff non-null) -- both must be
      // reset together, in this same transaction, before the Article row can
      // be removed. The candidate goes back to NEW: its converted article no
      // longer exists, so it's legitimately available for review again.
      await transaction.newsCandidate.updateMany({
        where: { convertedArticleId: id },
        data: { status: 'NEW', convertedArticleId: null },
      });
      // ArticleRevision already cascades on Article delete at the DB level;
      // deleting explicitly first keeps the transaction's intent legible and
      // matches this module's other dependent-row cleanup (e.g. `mutate`'s
      // articleTeam handling above).
      await transaction.articleRevision.deleteMany({ where: { articleId: id } });
      await transaction.article.delete({ where: { id } });
      await transaction.adminAuditEvent.create({
        data: {
          actorUserId: principal.userId,
          actorEmailSnapshot: principal.email,
          action: 'ARTICLE_DELETED',
          entityType: 'ARTICLE',
          entityId: id,
          requestId,
          beforeSnapshot: compactAuditSnapshot(article),
        },
      });
      return true;
    });
  }

  async listRevisions(articleId: string, query: RevisionListQuery): Promise<RevisionPage> {
    const revisions = await this.prisma.articleRevision.findMany({
      where: { articleId },
      orderBy: [{ revisionNumber: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
    });
    const hasMore = revisions.length > query.limit;
    const page = hasMore ? revisions.slice(0, query.limit) : revisions;
    return { revisions: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  }

  findRevision(articleId: string, revisionId: string): Promise<ArticleRevisionRecord | null> {
    return this.prisma.articleRevision.findFirst({ where: { id: revisionId, articleId } });
  }
}

export async function createArticleInTransaction(
  transaction: Prisma.TransactionClient,
  fields: ArticleWriteFields,
  teamIds: readonly string[],
  principal: AdministrativePrincipal,
  changeSummary: string | null,
  requestId: string | null,
  /** M42B: every existing caller (human candidate conversion, direct article
   * creation) omits this and gets the original DRAFT-only behavior
   * unchanged -- a human still takes a separate, distinct `publish()` action
   * later. Only the auto-publish path passes `{ status: 'PUBLISHED',
   * publishedAt }` so a trusted candidate becomes publicly visible in the
   * same atomic transaction that creates it and marks the candidate
   * CONVERTED, with no intermediate DRAFT state a human could stumble on
   * half-published. */
  publish: { readonly status: ArticleStatus; readonly publishedAt: Date } | null = null,
): Promise<ArticleRecord> {
  const article = await transaction.article.create({
    data: {
      ...fields,
      status: publish?.status ?? 'DRAFT',
      publishedAt: publish?.publishedAt ?? null,
      createdById: principal.userId,
      updatedById: principal.userId,
      createdBySnapshot: principal.email,
      updatedBySnapshot: principal.email,
      teams: { create: teamIds.map((teamId) => ({ teamId })) },
    },
    include: articleInclude,
  });
  await transaction.articleRevision.create({
    data: {
      articleId: article.id,
      revisionNumber: article.version,
      editorUserId: principal.userId,
      editorSnapshot: principal.email,
      snapshot: revisionSnapshot(article),
      changeSummary,
    },
  });
  await createArticleAudit(
    transaction,
    principal,
    requestId,
    'ARTICLE_CREATED',
    article,
    null,
    article,
  );
  return article;
}

function publicVisibilityWhere(now: Date): Prisma.ArticleWhereInput {
  return {
    OR: [
      { status: 'PUBLISHED', publishedAt: { lte: now } },
      { status: 'SCHEDULED', scheduledFor: { lte: now } },
    ],
  };
}

export function revisionSnapshot(article: ArticleRecord): Prisma.InputJsonObject {
  return sanitizeAuditSnapshot({
    type: article.type,
    status: article.status,
    version: article.version,
    title: article.title,
    slug: article.slug,
    summary: article.summary,
    body: article.body,
    contentType: article.contentType,
    mediaThumbnailUrl: article.mediaThumbnailUrl,
    sourceName: article.sourceName,
    sourceUrl: article.sourceUrl,
    sourcePublishedAt: article.sourcePublishedAt,
    sourceIsOfficialTeam: article.sourceIsOfficialTeam,
    heroImageUrl: article.heroImageUrl,
    heroImageAlt: article.heroImageAlt,
    heroImageAttribution: article.heroImageAttribution,
    heroImageAttributionUrl: article.heroImageAttributionUrl,
    seoTitle: article.seoTitle,
    seoDescription: article.seoDescription,
    isFeatured: article.isFeatured,
    featuredPriority: article.featuredPriority,
    featuredStartsAt: article.featuredStartsAt,
    featuredEndsAt: article.featuredEndsAt,
    publishedAt: article.publishedAt,
    scheduledFor: article.scheduledFor,
    teamIds: article.teams.map(({ teamId }) => teamId),
  });
}

export async function createArticleAudit(
  transaction: Prisma.TransactionClient,
  principal: AdministrativePrincipal,
  requestId: string | null,
  action: string,
  identity: ArticleRecord,
  before: ArticleRecord | null,
  after: ArticleRecord,
): Promise<void> {
  await transaction.adminAuditEvent.create({
    data: {
      actorUserId: principal.userId,
      actorEmailSnapshot: principal.email,
      action,
      entityType: 'ARTICLE',
      entityId: identity.id,
      requestId,
      ...(before === null ? {} : { beforeSnapshot: compactAuditSnapshot(before) }),
      afterSnapshot: compactAuditSnapshot(after),
    },
  });
}

function compactAuditSnapshot(article: ArticleRecord): Prisma.InputJsonObject {
  return sanitizeAuditSnapshot({
    version: article.version,
    status: article.status,
    type: article.type,
    slug: article.slug,
    title: article.title,
    bodySha256:
      article.body === null ? null : createHash('sha256').update(article.body).digest('hex'),
    bodyLength: article.body?.length ?? 0,
    isFeatured: article.isFeatured,
    featuredPriority: article.featuredPriority,
    publishedAt: article.publishedAt,
    scheduledFor: article.scheduledFor,
    teamIds: article.teams.map(({ teamId }) => teamId),
  });
}

export function effectivePublishedAt(article: ArticleRecord): Date | null {
  return article.status === 'SCHEDULED' ? article.scheduledFor : article.publishedAt;
}

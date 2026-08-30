import { AppError } from '../../common/errors/app-error.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import {
  toAdminArticleDetailDto,
  toAdminArticleListDto,
  toPublicArticleDetailDto,
  toPublicArticleListDto,
  toRevisionDto,
  type AdminArticleDetailDto,
  type AdminArticleListDto,
  type ArticleRecord,
  type PublicArticleDetailDto,
  type PublicArticleListDto,
} from './article.dto.js';
import {
  effectivePublishedAt,
  type ArticleMutation,
  type ArticleRepository,
  type ArticleWriteFields,
} from './article.repository.js';
import type {
  AdminArticleListQuery,
  ArticleCreateInput,
  ArticleScheduleInput,
  ArticleTeamsUpdateInput,
  ArticleUpdateInput,
  ArticleVersionActionInput,
  PublicArticleListQuery,
  RevisionListQuery,
} from './article.schemas.js';

const PUBLIC_CANDIDATE_LIMIT = 500;
const RESERVED_SLUGS = new Set([
  'admin',
  'articles',
  'auth',
  'docs',
  'featured',
  'games',
  'health',
  'edit',
  'new',
  'teams',
  'users',
]);
const TEAM_ALIASES: Readonly<Record<string, string>> = { WSH: 'WAS', JAC: 'JAX' };

export interface ArticlePage<T> {
  readonly articles: readonly T[];
  readonly nextCursor: string | null;
}

export interface PublicArticleReader {
  list(query: PublicArticleListQuery): Promise<ArticlePage<PublicArticleListDto>>;
  listFeatured(query: PublicArticleListQuery): Promise<ArticlePage<PublicArticleListDto>>;
  listForTeam(
    teamId: string,
    query: PublicArticleListQuery,
  ): Promise<ArticlePage<PublicArticleListDto>>;
  getBySlug(slug: string): Promise<PublicArticleDetailDto>;
}

export interface EditorialArticleService {
  listAdmin(query: AdminArticleListQuery): Promise<ArticlePage<AdminArticleListDto>>;
  getAdmin(id: string): Promise<AdminArticleDetailDto>;
  create(
    input: ArticleCreateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto>;
  update(
    id: string,
    input: ArticleUpdateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto>;
  replaceTeams(
    id: string,
    input: ArticleTeamsUpdateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto>;
  publish(
    id: string,
    input: ArticleVersionActionInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto>;
  unpublish(
    id: string,
    input: ArticleVersionActionInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto>;
  schedule(
    id: string,
    input: ArticleScheduleInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto>;
  archive(
    id: string,
    input: ArticleVersionActionInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto>;
  restore(
    id: string,
    input: ArticleVersionActionInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto>;
  listRevisions(
    id: string,
    query: RevisionListQuery,
  ): Promise<{
    readonly revisions: readonly ReturnType<typeof toRevisionDto>[];
    readonly nextCursor: string | null;
  }>;
  getRevision(id: string, revisionId: string): Promise<ReturnType<typeof toRevisionDto>>;
  deleteArticle(
    id: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<void>;
}

export class ArticleService implements PublicArticleReader, EditorialArticleService {
  constructor(
    private readonly repository: ArticleRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(query: PublicArticleListQuery): Promise<ArticlePage<PublicArticleListDto>> {
    return this.listPublic(query);
  }

  async listFeatured(query: PublicArticleListQuery): Promise<ArticlePage<PublicArticleListDto>> {
    return this.listPublic({ ...query, featured: true });
  }

  async listForTeam(
    teamId: string,
    query: PublicArticleListQuery,
  ): Promise<ArticlePage<PublicArticleListDto>> {
    if ((await this.repository.findActiveTeamIds([teamId])).length !== 1) {
      throw articleNotFound('The requested team was not found.');
    }
    return this.listPublic({ ...query, teamId, team: undefined });
  }

  async getBySlug(slug: string): Promise<PublicArticleDetailDto> {
    const article = await this.repository.findPublicBySlug(slug, this.now());
    const publishedAt = article === null ? null : effectivePublishedAt(article);
    if (article === null || publishedAt === null) throw articleNotFound();
    return toPublicArticleDetailDto(article, publishedAt);
  }

  async listAdmin(query: AdminArticleListQuery): Promise<ArticlePage<AdminArticleListDto>> {
    const page = await this.repository.listAdmin(query);
    return { articles: page.articles.map(toAdminArticleListDto), nextCursor: page.nextCursor };
  }

  async getAdmin(id: string): Promise<AdminArticleDetailDto> {
    return toAdminArticleDetailDto(await this.requireArticle(id));
  }

  async create(
    input: ArticleCreateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto> {
    requireDistinctTeams(input.teamIds);
    await this.requireActiveTeams(input.teamIds);
    const fields = prepareArticleCreate(input);
    if ((await this.repository.findBySlug(fields.slug)) !== null) throw slugConflict();
    return toAdminArticleDetailDto(
      await this.repository.create(
        fields,
        input.teamIds,
        principal,
        input.changeSummary ?? null,
        requestId,
      ),
    );
  }

  async update(
    id: string,
    input: ArticleUpdateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto> {
    const article = await this.requireEditableArticle(id, input.expectedVersion);
    let fields = mergeUpdateFields(article, input);
    if (input.slug !== undefined) {
      if (article.publishedAt !== null && normalizeSlug(input.slug) !== article.slug) {
        throw new AppError({
          code: 'PUBLISHED_ARTICLE_SLUG_IMMUTABLE',
          message: 'A slug cannot be changed after an article has been published.',
          statusCode: 409,
        });
      }
      fields = { ...fields, slug: normalizeSlug(input.slug) };
    }
    validateArticleFields(fields);
    if (sameFields(article, fields)) throw noChangesError();
    if (fields.slug !== article.slug && (await this.repository.findBySlug(fields.slug)) !== null) {
      throw slugConflict();
    }
    return this.mutate(
      article,
      input.expectedVersion,
      {
        fields,
        action: featuredChanged(article, fields) ? 'ARTICLE_FEATURED_CHANGED' : 'ARTICLE_UPDATED',
        changeSummary: input.changeSummary ?? null,
      },
      principal,
      requestId,
    );
  }

  async replaceTeams(
    id: string,
    input: ArticleTeamsUpdateInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto> {
    const article = await this.requireEditableArticle(id, input.expectedVersion);
    requireDistinctTeams(input.teamIds);
    await this.requireActiveTeams(input.teamIds);
    const current = article.teams.map(({ teamId }) => teamId).sort();
    const next = [...input.teamIds].sort();
    if (JSON.stringify(current) === JSON.stringify(next)) throw noChangesError();
    return this.mutate(
      article,
      input.expectedVersion,
      {
        teamIds: next,
        action: 'ARTICLE_TEAMS_CHANGED',
        changeSummary: input.changeSummary ?? null,
      },
      principal,
      requestId,
    );
  }

  async publish(
    id: string,
    input: ArticleVersionActionInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto> {
    const article = await this.requireEditableArticle(id, input.expectedVersion);
    if (article.status === 'PUBLISHED') throw transitionConflict('already published');
    validateArticleFields(articleToFields(article));
    return this.mutate(
      article,
      input.expectedVersion,
      {
        status: 'PUBLISHED',
        publishedAt: article.publishedAt ?? this.now(),
        scheduledFor: null,
        action: 'ARTICLE_PUBLISHED',
        changeSummary: input.changeSummary ?? null,
      },
      principal,
      requestId,
    );
  }

  async unpublish(
    id: string,
    input: ArticleVersionActionInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto> {
    const article = await this.requireEditableArticle(id, input.expectedVersion);
    if (!['PUBLISHED', 'SCHEDULED'].includes(article.status)) {
      throw transitionConflict('not published or scheduled');
    }
    return this.mutate(
      article,
      input.expectedVersion,
      {
        status: 'UNPUBLISHED',
        scheduledFor: null,
        action: 'ARTICLE_UNPUBLISHED',
        changeSummary: input.changeSummary ?? null,
      },
      principal,
      requestId,
    );
  }

  async schedule(
    id: string,
    input: ArticleScheduleInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto> {
    const article = await this.requireEditableArticle(id, input.expectedVersion);
    if (!['DRAFT', 'UNPUBLISHED', 'SCHEDULED'].includes(article.status)) {
      throw transitionConflict('not schedulable');
    }
    const scheduledFor = new Date(input.scheduledFor);
    if (scheduledFor <= this.now()) {
      throw new AppError({
        code: 'ARTICLE_SCHEDULE_MUST_BE_FUTURE',
        message: 'Scheduled publication must be in the future.',
        statusCode: 400,
      });
    }
    validateArticleFields(articleToFields(article));
    return this.mutate(
      article,
      input.expectedVersion,
      {
        status: 'SCHEDULED',
        scheduledFor,
        action: 'ARTICLE_SCHEDULED',
        changeSummary: input.changeSummary ?? null,
      },
      principal,
      requestId,
    );
  }

  async archive(
    id: string,
    input: ArticleVersionActionInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto> {
    const article = await this.requireEditableArticle(id, input.expectedVersion);
    return this.mutate(
      article,
      input.expectedVersion,
      {
        status: 'ARCHIVED',
        scheduledFor: null,
        action: 'ARTICLE_ARCHIVED',
        changeSummary: input.changeSummary ?? null,
      },
      principal,
      requestId,
    );
  }

  async restore(
    id: string,
    input: ArticleVersionActionInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto> {
    const article = await this.requireArticle(id);
    this.requireVersion(article, input.expectedVersion);
    if (article.status !== 'ARCHIVED') throw transitionConflict('not archived');
    return this.mutate(
      article,
      input.expectedVersion,
      {
        status: 'UNPUBLISHED',
        scheduledFor: null,
        action: 'ARTICLE_RESTORED',
        changeSummary: input.changeSummary ?? null,
      },
      principal,
      requestId,
    );
  }

  async listRevisions(id: string, query: RevisionListQuery) {
    await this.requireArticle(id);
    const page = await this.repository.listRevisions(id, query);
    return { revisions: page.revisions.map(toRevisionDto), nextCursor: page.nextCursor };
  }

  async getRevision(id: string, revisionId: string) {
    await this.requireArticle(id);
    const revision = await this.repository.findRevision(id, revisionId);
    if (revision === null) {
      throw new AppError({
        code: 'ARTICLE_REVISION_NOT_FOUND',
        message: 'The requested article revision was not found.',
        statusCode: 404,
      });
    }
    return toRevisionDto(revision);
  }

  async deleteArticle(
    id: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<void> {
    const deleted = await this.repository.delete(id, principal, requestId);
    if (!deleted) throw articleNotFound();
  }

  private async listPublic(
    query: PublicArticleListQuery,
  ): Promise<ArticlePage<PublicArticleListDto>> {
    let resolvedQuery = query;
    if (query.team !== undefined) {
      const abbreviation = TEAM_ALIASES[query.team] ?? query.team;
      const teamId = await this.repository.findActiveTeamIdByAbbreviation(abbreviation);
      if (teamId === null) throw articleNotFound('The requested team was not found.');
      resolvedQuery = { ...query, teamId, team: undefined };
    }
    const now = this.now();
    const candidates = await this.repository.listPublicCandidates(
      resolvedQuery,
      now,
      PUBLIC_CANDIDATE_LIMIT,
    );
    if (candidates.length > PUBLIC_CANDIDATE_LIMIT) {
      throw new AppError({
        code: 'ARTICLE_QUERY_TOO_BROAD',
        message: 'Narrow the article query before requesting this result set.',
        statusCode: 400,
      });
    }
    const visible = candidates
      .map((article) => ({ article, publishedAt: effectivePublishedAt(article) }))
      .filter(
        (entry): entry is { article: ArticleRecord; publishedAt: Date } =>
          entry.publishedAt !== null &&
          (resolvedQuery.publishedFrom === undefined ||
            entry.publishedAt >= new Date(resolvedQuery.publishedFrom)) &&
          (resolvedQuery.publishedTo === undefined ||
            entry.publishedAt <= new Date(resolvedQuery.publishedTo)) &&
          (resolvedQuery.featured !== true || featuredIsActive(entry.article, now)),
      )
      .sort((left, right) => comparePublicArticles(left, right, resolvedQuery.featured === true));
    const cursorIndex =
      resolvedQuery.cursor === undefined
        ? -1
        : visible.findIndex(({ article }) => article.id === resolvedQuery.cursor);
    if (resolvedQuery.cursor !== undefined && cursorIndex < 0) {
      throw new AppError({
        code: 'ARTICLE_CURSOR_INVALID',
        message: 'The article cursor is not valid for this query.',
        statusCode: 400,
      });
    }
    const start = cursorIndex + 1;
    const page = visible.slice(start, start + resolvedQuery.limit + 1);
    const hasMore = page.length > resolvedQuery.limit;
    const selected = hasMore ? page.slice(0, resolvedQuery.limit) : page;
    return {
      articles: selected.map(({ article, publishedAt }) =>
        toPublicArticleListDto(article, publishedAt),
      ),
      nextCursor: hasMore ? (selected.at(-1)?.article.id ?? null) : null,
    };
  }

  private async requireArticle(id: string): Promise<ArticleRecord> {
    const article = await this.repository.findById(id);
    if (article === null) throw articleNotFound();
    return article;
  }

  private async requireEditableArticle(id: string, version: number): Promise<ArticleRecord> {
    const article = await this.requireArticle(id);
    this.requireVersion(article, version);
    if (article.status === 'ARCHIVED') {
      throw new AppError({
        code: 'ARTICLE_ARCHIVED',
        message: 'Restore the archived article before editing it.',
        statusCode: 409,
      });
    }
    return article;
  }

  private requireVersion(article: ArticleRecord, expected: number): void {
    if (article.version !== expected) throw concurrencyConflict();
  }

  private async requireActiveTeams(teamIds: readonly string[]): Promise<void> {
    const activeIds = await this.repository.findActiveTeamIds(teamIds);
    if (activeIds.length !== teamIds.length) {
      throw new AppError({
        code: 'ACTIVE_TEAM_NOT_FOUND',
        message: 'Every article team tag must identify an active NFL team.',
        statusCode: 404,
      });
    }
  }

  private async mutate(
    article: ArticleRecord,
    expectedVersion: number,
    mutation: ArticleMutation,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminArticleDetailDto> {
    const result = await this.repository.mutate(
      article.id,
      expectedVersion,
      mutation,
      principal,
      requestId,
    );
    if (result === null) throw concurrencyConflict();
    return toAdminArticleDetailDto(result);
  }
}

export function prepareArticleCreate(input: ArticleCreateInput): ArticleWriteFields {
  const fields = { ...toCreateFields(input), slug: normalizeSlug(input.slug ?? input.title) };
  validateArticleFields(fields);
  return fields;
}

function toCreateFields(input: ArticleCreateInput): ArticleWriteFields {
  return {
    type: input.type,
    title: input.title,
    slug: '',
    summary: input.summary,
    body: input.body,
    contentType: input.contentType,
    mediaThumbnailUrl: input.mediaThumbnailUrl,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    sourcePublishedAt: input.sourcePublishedAt === null ? null : new Date(input.sourcePublishedAt),
    sourceIsOfficialTeam: input.sourceIsOfficialTeam,
    heroImageUrl: input.heroImageUrl,
    heroImageAlt: input.heroImageAlt,
    heroImageAttribution: input.heroImageAttribution,
    heroImageAttributionUrl: input.heroImageAttributionUrl,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    isFeatured: input.isFeatured,
    featuredPriority: input.featuredPriority,
    featuredStartsAt: input.featuredStartsAt === null ? null : new Date(input.featuredStartsAt),
    featuredEndsAt: input.featuredEndsAt === null ? null : new Date(input.featuredEndsAt),
  };
}

function mergeUpdateFields(article: ArticleRecord, input: ArticleUpdateInput): ArticleWriteFields {
  const date = (value: string | null | undefined, fallback: Date | null) =>
    value === undefined ? fallback : value === null ? null : new Date(value);
  return {
    type: input.type ?? article.type,
    title: input.title ?? article.title,
    slug: article.slug,
    summary: input.summary === undefined ? article.summary : input.summary,
    body: input.body === undefined ? article.body : input.body,
    contentType: input.contentType ?? article.contentType,
    mediaThumbnailUrl:
      input.mediaThumbnailUrl === undefined ? article.mediaThumbnailUrl : input.mediaThumbnailUrl,
    sourceName: input.sourceName === undefined ? article.sourceName : input.sourceName,
    sourceUrl: input.sourceUrl === undefined ? article.sourceUrl : input.sourceUrl,
    sourcePublishedAt: date(input.sourcePublishedAt, article.sourcePublishedAt),
    sourceIsOfficialTeam: input.sourceIsOfficialTeam ?? article.sourceIsOfficialTeam,
    heroImageUrl: input.heroImageUrl === undefined ? article.heroImageUrl : input.heroImageUrl,
    heroImageAlt: input.heroImageAlt === undefined ? article.heroImageAlt : input.heroImageAlt,
    heroImageAttribution:
      input.heroImageAttribution === undefined
        ? article.heroImageAttribution
        : input.heroImageAttribution,
    heroImageAttributionUrl:
      input.heroImageAttributionUrl === undefined
        ? article.heroImageAttributionUrl
        : input.heroImageAttributionUrl,
    seoTitle: input.seoTitle === undefined ? article.seoTitle : input.seoTitle,
    seoDescription:
      input.seoDescription === undefined ? article.seoDescription : input.seoDescription,
    isFeatured: input.isFeatured ?? article.isFeatured,
    featuredPriority:
      input.featuredPriority === undefined ? article.featuredPriority : input.featuredPriority,
    featuredStartsAt: date(input.featuredStartsAt, article.featuredStartsAt),
    featuredEndsAt: date(input.featuredEndsAt, article.featuredEndsAt),
  };
}

function articleToFields(article: ArticleRecord): ArticleWriteFields {
  return {
    type: article.type,
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
  };
}

export function normalizeSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (slug.length === 0 || slug.length > 160 || RESERVED_SLUGS.has(slug)) {
    throw new AppError({
      code: 'ARTICLE_SLUG_INVALID',
      message: 'The article slug is empty, unsafe, reserved, or too long.',
      statusCode: 400,
    });
  }
  return slug;
}

function validateArticleFields(fields: ArticleWriteFields): void {
  if ((fields.heroImageUrl === null) !== (fields.heroImageAlt === null)) {
    throw validationError('Hero image URL and alt text must be supplied together.');
  }
  if (
    fields.featuredStartsAt !== null &&
    fields.featuredEndsAt !== null &&
    fields.featuredEndsAt <= fields.featuredStartsAt
  ) {
    throw validationError('The featured end must be after the featured start.');
  }
  if (
    !fields.isFeatured &&
    (fields.featuredPriority !== null ||
      fields.featuredStartsAt !== null ||
      fields.featuredEndsAt !== null)
  ) {
    throw validationError('Featured priority and windows require isFeatured=true.');
  }
  if (fields.type === 'ORIGINAL' && (fields.summary === null || fields.body === null)) {
    throw validationError('Original articles require a summary and original Markdown body.');
  }
  if (fields.type === 'ANNOUNCEMENT' && fields.body === null) {
    throw validationError('Announcements require an original Markdown body.');
  }
  if (
    fields.type === 'CURATED' &&
    (fields.summary === null || fields.sourceName === null || fields.sourceUrl === null)
  ) {
    throw validationError(
      'Curated articles require a source name, HTTP(S) URL, and original summary.',
    );
  }
  if (fields.type === 'CURATED' && (fields.body?.length ?? 0) > 2_000) {
    throw validationError(
      'Curated commentary is limited to 2,000 characters; copied articles are prohibited.',
    );
  }
}

function sameFields(article: ArticleRecord, fields: ArticleWriteFields): boolean {
  const current = articleToFields(article);
  return Object.entries(fields).every(([key, value]) => {
    const previous = current[key as keyof ArticleWriteFields];
    return previous instanceof Date && value instanceof Date
      ? previous.getTime() === value.getTime()
      : previous === value;
  });
}

function featuredChanged(article: ArticleRecord, fields: ArticleWriteFields): boolean {
  return (
    article.isFeatured !== fields.isFeatured ||
    article.featuredPriority !== fields.featuredPriority ||
    article.featuredStartsAt?.getTime() !== fields.featuredStartsAt?.getTime() ||
    article.featuredEndsAt?.getTime() !== fields.featuredEndsAt?.getTime()
  );
}

function featuredIsActive(article: ArticleRecord, now: Date): boolean {
  if (!article.isFeatured) return true;
  return (
    (article.featuredStartsAt === null || article.featuredStartsAt <= now) &&
    (article.featuredEndsAt === null || article.featuredEndsAt > now)
  );
}

function comparePublicArticles(
  left: { article: ArticleRecord; publishedAt: Date },
  right: { article: ArticleRecord; publishedAt: Date },
  featured: boolean,
): number {
  if (featured) {
    const priority =
      (left.article.featuredPriority ?? 1_001) - (right.article.featuredPriority ?? 1_001);
    if (priority !== 0) return priority;
  }
  const time = right.publishedAt.getTime() - left.publishedAt.getTime();
  return time !== 0 ? time : right.article.id.localeCompare(left.article.id);
}

function requireDistinctTeams(teamIds: readonly string[]): void {
  if (new Set(teamIds).size !== teamIds.length) {
    throw validationError('Duplicate team tags are not allowed.');
  }
}

function articleNotFound(message = 'The requested article was not found.'): AppError {
  return new AppError({ code: 'ARTICLE_NOT_FOUND', message, statusCode: 404 });
}

function slugConflict(): AppError {
  return new AppError({
    code: 'ARTICLE_SLUG_CONFLICT',
    message: 'An article already uses this slug.',
    statusCode: 409,
  });
}

function concurrencyConflict(): AppError {
  return new AppError({
    code: 'ARTICLE_VERSION_CONFLICT',
    message: 'The article changed after it was loaded. Refresh it before saving again.',
    statusCode: 409,
  });
}

function transitionConflict(reason: string): AppError {
  return new AppError({
    code: 'ARTICLE_STATUS_CONFLICT',
    message: `The article is ${reason}.`,
    statusCode: 409,
  });
}

function noChangesError(): AppError {
  return new AppError({
    code: 'ARTICLE_NO_CHANGES',
    message: 'The requested change does not alter the article.',
    statusCode: 409,
  });
}

function validationError(message: string): AppError {
  return new AppError({ code: 'ARTICLE_VALIDATION_ERROR', message, statusCode: 400 });
}

import type { Prisma } from '../../generated/prisma/client.js';

export const articleInclude = {
  teams: {
    include: { team: true },
    orderBy: { team: { abbreviation: 'asc' } },
  },
} satisfies Prisma.ArticleInclude;

export type ArticleRecord = Prisma.ArticleGetPayload<{ include: typeof articleInclude }>;
export type ArticleRevisionRecord = Prisma.ArticleRevisionGetPayload<Record<string, never>>;

export interface ArticleTeamDto {
  readonly id: string;
  readonly abbreviation: string;
  readonly fullName: string;
}

export interface PublicArticleListDto {
  readonly id: string;
  readonly slug: string;
  readonly type: 'ORIGINAL' | 'CURATED' | 'ANNOUNCEMENT';
  readonly title: string;
  readonly summary: string | null;
  readonly contentType: 'ARTICLE' | 'VIDEO' | 'HIGHLIGHT';
  readonly mediaThumbnailUrl: string | null;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
  readonly sourcePublishedAt: string | null;
  readonly heroImageUrl: string | null;
  readonly heroImageAlt: string | null;
  readonly isFeatured: boolean;
  readonly publishedAt: string;
  readonly teams: readonly ArticleTeamDto[];
}

export interface PublicArticleDetailDto extends PublicArticleListDto {
  readonly body: string | null;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly heroImageAttribution: string | null;
  readonly heroImageAttributionUrl: string | null;
}

export interface AdminArticleListDto {
  readonly id: string;
  readonly slug: string;
  readonly type: ArticleRecord['type'];
  readonly status: ArticleRecord['status'];
  readonly version: number;
  readonly title: string;
  readonly summary: string | null;
  readonly contentType: ArticleRecord['contentType'];
  readonly mediaThumbnailUrl: string | null;
  readonly isFeatured: boolean;
  readonly featuredPriority: number | null;
  readonly publishedAt: string | null;
  readonly scheduledFor: string | null;
  readonly teams: readonly ArticleTeamDto[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminArticleDetailDto extends AdminArticleListDto {
  readonly body: string | null;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
  readonly sourcePublishedAt: string | null;
  readonly heroImageUrl: string | null;
  readonly heroImageAlt: string | null;
  readonly heroImageAttribution: string | null;
  readonly heroImageAttributionUrl: string | null;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly featuredStartsAt: string | null;
  readonly featuredEndsAt: string | null;
}

export function toPublicArticleListDto(
  article: ArticleRecord,
  effectivePublishedAt: Date,
): PublicArticleListDto {
  return {
    id: article.id,
    slug: article.slug,
    type: article.type,
    title: article.title,
    summary: article.summary,
    contentType: article.contentType,
    mediaThumbnailUrl: article.mediaThumbnailUrl,
    sourceName: article.sourceName,
    sourceUrl: article.sourceUrl,
    sourcePublishedAt: article.sourcePublishedAt?.toISOString() ?? null,
    heroImageUrl: article.heroImageUrl,
    heroImageAlt: article.heroImageAlt,
    isFeatured: article.isFeatured,
    publishedAt: effectivePublishedAt.toISOString(),
    teams: toTeamDtos(article),
  };
}

export function toPublicArticleDetailDto(
  article: ArticleRecord,
  effectivePublishedAt: Date,
): PublicArticleDetailDto {
  return {
    ...toPublicArticleListDto(article, effectivePublishedAt),
    body: article.body,
    seoTitle: article.seoTitle,
    seoDescription: article.seoDescription,
    heroImageAttribution: article.heroImageAttribution,
    heroImageAttributionUrl: article.heroImageAttributionUrl,
  };
}

export function toAdminArticleListDto(article: ArticleRecord): AdminArticleListDto {
  return {
    id: article.id,
    slug: article.slug,
    type: article.type,
    status: article.status,
    version: article.version,
    title: article.title,
    summary: article.summary,
    contentType: article.contentType,
    mediaThumbnailUrl: article.mediaThumbnailUrl,
    isFeatured: article.isFeatured,
    featuredPriority: article.featuredPriority,
    publishedAt: article.publishedAt?.toISOString() ?? null,
    scheduledFor: article.scheduledFor?.toISOString() ?? null,
    teams: toTeamDtos(article),
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
  };
}

export function toAdminArticleDetailDto(article: ArticleRecord): AdminArticleDetailDto {
  return {
    ...toAdminArticleListDto(article),
    body: article.body,
    sourceName: article.sourceName,
    sourceUrl: article.sourceUrl,
    sourcePublishedAt: article.sourcePublishedAt?.toISOString() ?? null,
    heroImageUrl: article.heroImageUrl,
    heroImageAlt: article.heroImageAlt,
    heroImageAttribution: article.heroImageAttribution,
    heroImageAttributionUrl: article.heroImageAttributionUrl,
    seoTitle: article.seoTitle,
    seoDescription: article.seoDescription,
    featuredStartsAt: article.featuredStartsAt?.toISOString() ?? null,
    featuredEndsAt: article.featuredEndsAt?.toISOString() ?? null,
  };
}

export function toRevisionDto(revision: ArticleRevisionRecord) {
  return {
    id: revision.id,
    articleId: revision.articleId,
    revisionNumber: revision.revisionNumber,
    editorSnapshot: revision.editorSnapshot,
    snapshot: revision.snapshot,
    changeSummary: revision.changeSummary,
    createdAt: revision.createdAt.toISOString(),
  };
}

function toTeamDtos(article: ArticleRecord): ArticleTeamDto[] {
  return article.teams.map(({ team }) => ({
    id: team.id,
    abbreviation: team.abbreviation,
    fullName: team.fullName,
  }));
}

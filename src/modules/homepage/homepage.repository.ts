import { AppError } from '../../common/errors/app-error.js';
import type { AuditActor } from '../../common/audit/audit-actor.js';
import { sanitizeAuditSnapshot } from '../admin/audit-sanitizer.js';
import { type ArticleRecord, articleInclude } from '../articles/article.dto.js';
import { publicGameInclude, type GameWithTeams } from '../games/game.dto.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { HeroRichTextDocument } from './homepage-rich-text.js';
import { heroRichTextDocumentSchema } from './homepage-rich-text.js';
import {
  MAX_HERO_SLIDES,
  MAX_TOP_STORIES,
  MAX_HOMEPAGE_HIGHLIGHT_PLACEMENTS,
  type CreateHeroSlideInput,
  type HighlightCandidatesQuery,
  type UpdateHeroSlideInput,
  type UpdateHighlightSettingsInput,
} from './homepage.schemas.js';

export type HomepageHeroContentSlotValue =
  | 'TOP_LEFT'
  | 'TOP_CENTER'
  | 'TOP_RIGHT'
  | 'MIDDLE_LEFT'
  | 'MIDDLE_CENTER'
  | 'MIDDLE_RIGHT'
  | 'BOTTOM_LEFT'
  | 'BOTTOM_CENTER'
  | 'BOTTOM_RIGHT';

export type HomepageHeroCtaVariantValue = 'PRIMARY' | 'SECONDARY';

export interface HomepageHeroContentBlockRecord {
  readonly id: string;
  readonly slot: HomepageHeroContentSlotValue;
  readonly content: HeroRichTextDocument;
}

export interface HomepageHeroCtaRecord {
  readonly id: string;
  readonly position: number;
  readonly label: string;
  readonly url: string;
  readonly variant: HomepageHeroCtaVariantValue;
}

export interface HomepageHeroSlideRecord {
  readonly id: string;
  readonly position: number;
  readonly isActive: boolean;
  readonly imageUrl: string;
  readonly imageAlt: string | null;
  readonly imageBrightness: number;
  readonly imageContrast: number;
  readonly imageSaturation: number;
  readonly overlayOpacity: number;
  readonly focalPointX: number;
  readonly focalPointY: number;
  readonly imageScale: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly contentBlocks: readonly HomepageHeroContentBlockRecord[];
  readonly ctas: readonly HomepageHeroCtaRecord[];
}

export interface HomepageTopStoryRecord {
  readonly id: string;
  readonly articleId: string;
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type HomepageHighlightSourceTypeValue = 'GAME_HIGHLIGHT' | 'CURATED_GAME_VIDEO';

export interface HomepageHighlightPlacementRecord {
  readonly id: string;
  readonly sourceType: HomepageHighlightSourceTypeValue;
  readonly sourceId: string;
  readonly gameId: string;
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface HomepageHighlightSettingsRecord {
  readonly displayLimit: number;
  readonly fillWithAutomatic: boolean;
}

export interface HomepageHighlightCandidateRecord {
  readonly sourceType: HomepageHighlightSourceTypeValue;
  readonly sourceId: string;
  readonly gameId: string;
  readonly title: string;
  readonly thumbnailUrl: string | null;
  readonly game: GameWithTeams;
}

export interface HomepageHighlightCandidateListResult {
  readonly candidates: readonly HomepageHighlightCandidateRecord[];
  readonly nextCursor: string | null;
}

export interface HomepageCurrentWeekContext {
  readonly season: number;
  readonly week: number;
  readonly seasonType: 'PRE' | 'REG' | 'POST';
}

export interface HomepageRepository {
  listHeroSlides(): Promise<readonly HomepageHeroSlideRecord[]>;
  listActiveHeroSlides(): Promise<readonly HomepageHeroSlideRecord[]>;
  findHeroSlide(slideId: string): Promise<HomepageHeroSlideRecord | null>;
  createHeroSlide(input: CreateHeroSlideInput, actor: AuditActor): Promise<HomepageHeroSlideRecord>;
  updateHeroSlide(
    slideId: string,
    input: UpdateHeroSlideInput,
    actor: AuditActor,
  ): Promise<HomepageHeroSlideRecord>;
  deleteHeroSlide(slideId: string, actor: AuditActor): Promise<HomepageHeroSlideRecord>;
  reorderHeroSlides(
    slideIds: readonly string[],
    actor: AuditActor,
  ): Promise<readonly HomepageHeroSlideRecord[]>;

  listTopStories(): Promise<readonly HomepageTopStoryRecord[]>;
  findTopStory(articleId: string): Promise<HomepageTopStoryRecord | null>;
  addTopStory(articleId: string, actor: AuditActor): Promise<HomepageTopStoryRecord>;
  removeTopStory(articleId: string, actor: AuditActor): Promise<HomepageTopStoryRecord | null>;
  reorderTopStories(
    articleIds: readonly string[],
    actor: AuditActor,
  ): Promise<readonly HomepageTopStoryRecord[]>;

  /** Every matching article regardless of status -- used for admin curation
   * (existence checks, admin listings) where an operator must be able to see
   * and manage a curation row even for a DRAFT/SCHEDULED/ARCHIVED article
   * (e.g. curating ahead of a scheduled publish, or fixing a row that
   * pointed at an article since unpublished). Never used for a public
   * response -- see `findPublicArticlesByIds`. */
  findArticlesByIds(articleIds: readonly string[]): Promise<readonly ArticleRecord[]>;

  /** Only genuinely publicly-visible articles -- same visibility rule as
   * `article.repository.ts`'s `publicVisibilityWhere` (PUBLISHED and already
   * past `publishedAt`, or SCHEDULED and already past `scheduledFor`).
   * Curating an article that is later unpublished/archived/rescheduled
   * silently drops it from this result -- the caller never has to check. */
  findPublicArticlesByIds(articleIds: readonly string[]): Promise<readonly ArticleRecord[]>;

  /** Bounded, most-recent-first FINAL games that have at least one
   * game-specific media item (curated or automatic) -- never the global
   * video alone, and never a season-wide scan. */
  findRecentGamesWithMedia(limit: number): Promise<readonly GameWithTeams[]>;

  /** Bounded pool of the most recently updated, genuinely public articles
   * (same visibility rule as `findPublicArticlesByIds`), used only as the
   * candidate pool for Top Stories' automatic fallback (M42A) -- callers
   * still compute `effectivePublishedAt` and re-sort themselves, matching
   * `article.service.ts`'s existing `listPublic` pattern, since a SCHEDULED
   * article's true publish moment lives in `scheduledFor` rather than
   * `publishedAt`. */
  findRecentPublicArticles(limit: number): Promise<readonly ArticleRecord[]>;

  // M37A: Homepage highlight curation
  listActiveHighlightPlacements(): Promise<readonly HomepageHighlightPlacementRecord[]>;
  findHighlightPlacement(placementId: string): Promise<HomepageHighlightPlacementRecord | null>;
  findHighlightPlacementBySource(
    sourceType: HomepageHighlightSourceTypeValue,
    sourceId: string,
  ): Promise<HomepageHighlightPlacementRecord | null>;
  createHighlightPlacement(
    input: { sourceType: HomepageHighlightSourceTypeValue; sourceId: string; gameId: string },
    actor: AuditActor,
  ): Promise<HomepageHighlightPlacementRecord>;
  deleteHighlightPlacement(
    placementId: string,
    actor: AuditActor,
  ): Promise<HomepageHighlightPlacementRecord | null>;
  reorderHighlightPlacements(
    placementIds: readonly string[],
    actor: AuditActor,
  ): Promise<readonly HomepageHighlightPlacementRecord[]>;
  getHighlightSettings(): Promise<HomepageHighlightSettingsRecord>;
  updateHighlightSettings(
    input: UpdateHighlightSettingsInput,
    actor: AuditActor,
  ): Promise<HomepageHighlightSettingsRecord>;
  /** Existence + owning-game lookup used when adding a placement -- never a
   * provider id, just confirms the internal media row is real. */
  findGameHighlightSource(id: string): Promise<{ readonly gameId: string } | null>;
  findCuratedVideoSource(id: string): Promise<{ readonly gameId: string } | null>;
  findGamesWithTeamsByIds(gameIds: readonly string[]): Promise<readonly GameWithTeams[]>;
  listHighlightCandidates(
    query: HighlightCandidatesQuery,
  ): Promise<HomepageHighlightCandidateListResult>;

  // M37A: Insight Rail
  /** Schedule-driven current-week resolution: the nearest not-yet-final game,
   * else the most recent FINAL game. `null` only if the season has no games
   * with a `week` at all. */
  findCurrentWeekContext(): Promise<HomepageCurrentWeekContext | null>;
}

const heroSlideInclude = {
  contentBlocks: true,
  ctas: { orderBy: { position: 'asc' as const } },
} satisfies Prisma.HomepageHeroSlideInclude;

type HeroSlideRow = Prisma.HomepageHeroSlideGetPayload<{ include: typeof heroSlideInclude }>;

function toHeroSlideRecord(row: HeroSlideRow): HomepageHeroSlideRecord {
  return {
    id: row.id,
    position: row.position,
    isActive: row.isActive,
    imageUrl: row.imageUrl,
    imageAlt: row.imageAlt,
    imageBrightness: row.imageBrightness,
    imageContrast: row.imageContrast,
    imageSaturation: row.imageSaturation,
    overlayOpacity: row.overlayOpacity,
    focalPointX: row.focalPointX,
    focalPointY: row.focalPointY,
    imageScale: row.imageScale,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    contentBlocks: row.contentBlocks.map((block) => ({
      id: block.id,
      slot: block.slot,
      // Written only via `heroRichTextDocumentSchema.parse()` in this same
      // repository, so re-validating here documents the invariant without
      // trusting the JSONB column's shape blindly.
      content: heroRichTextDocumentSchema.parse(block.content),
    })),
    ctas: row.ctas.map((cta) => ({
      id: cta.id,
      position: cta.position,
      label: cta.label,
      url: cta.url,
      variant: cta.variant,
    })),
  };
}

function heroSlideLimitReachedError(): AppError {
  return new AppError({
    code: 'HOMEPAGE_HERO_SLIDE_LIMIT_REACHED',
    message: `The homepage Hero carousel may have at most ${String(MAX_HERO_SLIDES)} slides.`,
    statusCode: 409,
  });
}

function heroSlideReorderMismatchError(): AppError {
  return new AppError({
    code: 'HOMEPAGE_HERO_SLIDE_REORDER_MISMATCH',
    message: 'slideIds must include exactly every current Hero slide, each once.',
    statusCode: 422,
  });
}

function topStoryLimitReachedError(): AppError {
  return new AppError({
    code: 'HOMEPAGE_TOP_STORY_LIMIT_REACHED',
    message: `The homepage may have at most ${String(MAX_TOP_STORIES)} Top Stories.`,
    statusCode: 409,
  });
}

function topStoryReorderMismatchError(): AppError {
  return new AppError({
    code: 'HOMEPAGE_TOP_STORY_REORDER_MISMATCH',
    message: 'articleIds must include exactly every current Top Story, each once.',
    statusCode: 422,
  });
}

function highlightPlacementLimitReachedError(): AppError {
  return new AppError({
    code: 'HOMEPAGE_HIGHLIGHT_LIMIT_REACHED',
    message: `The homepage may have at most ${String(MAX_HOMEPAGE_HIGHLIGHT_PLACEMENTS)} curated highlights.`,
    statusCode: 409,
  });
}

function highlightPlacementDuplicateError(): AppError {
  return new AppError({
    code: 'HOMEPAGE_HIGHLIGHT_DUPLICATE',
    message: 'This media item is already curated on the homepage.',
    statusCode: 409,
  });
}

function highlightPlacementReorderMismatchError(): AppError {
  return new AppError({
    code: 'HOMEPAGE_HIGHLIGHT_REORDER_MISMATCH',
    message: 'placementIds must include exactly every current highlight placement, each once.',
    statusCode: 422,
  });
}

export class PrismaHomepageRepository implements HomepageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listHeroSlides(): Promise<readonly HomepageHeroSlideRecord[]> {
    const rows = await this.prisma.homepageHeroSlide.findMany({
      include: heroSlideInclude,
      orderBy: { position: 'asc' },
    });
    return rows.map(toHeroSlideRecord);
  }

  async listActiveHeroSlides(): Promise<readonly HomepageHeroSlideRecord[]> {
    const rows = await this.prisma.homepageHeroSlide.findMany({
      where: { isActive: true },
      include: heroSlideInclude,
      orderBy: { position: 'asc' },
    });
    return rows.map(toHeroSlideRecord);
  }

  async findHeroSlide(slideId: string): Promise<HomepageHeroSlideRecord | null> {
    const row = await this.prisma.homepageHeroSlide.findUnique({
      where: { id: slideId },
      include: heroSlideInclude,
    });
    return row === null ? null : toHeroSlideRecord(row);
  }

  createHeroSlide(
    input: CreateHeroSlideInput,
    actor: AuditActor,
  ): Promise<HomepageHeroSlideRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const count = await transaction.homepageHeroSlide.count();
      if (count >= MAX_HERO_SLIDES) throw heroSlideLimitReachedError();
      const created = await transaction.homepageHeroSlide.create({
        data: {
          position: count,
          isActive: input.isActive,
          imageUrl: input.imageUrl,
          imageAlt: input.imageAlt,
          imageBrightness: input.imageBrightness,
          imageContrast: input.imageContrast,
          imageSaturation: input.imageSaturation,
          overlayOpacity: input.overlayOpacity,
          focalPointX: input.focalPointX,
          focalPointY: input.focalPointY,
          imageScale: input.imageScale,
          createdById: actor.userId,
          updatedById: actor.userId,
          createdBySnapshot: actor.emailSnapshot,
          updatedBySnapshot: actor.emailSnapshot,
          contentBlocks: {
            create: input.contentBlocks.map((block) => ({
              slot: block.slot,
              content: block.content,
            })),
          },
          ctas: {
            create: input.ctas.map((cta, index) => ({
              position: index,
              label: cta.label,
              url: cta.url,
              variant: cta.variant,
            })),
          },
        },
        include: heroSlideInclude,
      });
      await createAudit(
        transaction,
        actor,
        'HOMEPAGE_HERO_SLIDE_CREATED',
        'HOMEPAGE_HERO_SLIDE',
        created.id,
        null,
        created,
      );
      return toHeroSlideRecord(created);
    });
  }

  updateHeroSlide(
    slideId: string,
    input: UpdateHeroSlideInput,
    actor: AuditActor,
  ): Promise<HomepageHeroSlideRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.homepageHeroSlide.findUniqueOrThrow({
        where: { id: slideId },
        include: heroSlideInclude,
      });
      if (input.contentBlocks !== undefined) {
        await transaction.homepageHeroContentBlock.deleteMany({ where: { heroSlideId: slideId } });
      }
      if (input.ctas !== undefined) {
        await transaction.homepageHeroCta.deleteMany({ where: { heroSlideId: slideId } });
      }
      const after = await transaction.homepageHeroSlide.update({
        where: { id: slideId },
        data: {
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
          ...(input.imageAlt === undefined ? {} : { imageAlt: input.imageAlt }),
          ...(input.imageBrightness === undefined
            ? {}
            : { imageBrightness: input.imageBrightness }),
          ...(input.imageContrast === undefined ? {} : { imageContrast: input.imageContrast }),
          ...(input.imageSaturation === undefined
            ? {}
            : { imageSaturation: input.imageSaturation }),
          ...(input.overlayOpacity === undefined ? {} : { overlayOpacity: input.overlayOpacity }),
          ...(input.focalPointX === undefined ? {} : { focalPointX: input.focalPointX }),
          ...(input.focalPointY === undefined ? {} : { focalPointY: input.focalPointY }),
          ...(input.imageScale === undefined ? {} : { imageScale: input.imageScale }),
          updatedById: actor.userId,
          updatedBySnapshot: actor.emailSnapshot,
          ...(input.contentBlocks === undefined
            ? {}
            : {
                contentBlocks: {
                  create: input.contentBlocks.map((block) => ({
                    slot: block.slot,
                    content: block.content,
                  })),
                },
              }),
          ...(input.ctas === undefined
            ? {}
            : {
                ctas: {
                  create: input.ctas.map((cta, index) => ({
                    position: index,
                    label: cta.label,
                    url: cta.url,
                    variant: cta.variant,
                  })),
                },
              }),
        },
        include: heroSlideInclude,
      });
      await createAudit(
        transaction,
        actor,
        'HOMEPAGE_HERO_SLIDE_UPDATED',
        'HOMEPAGE_HERO_SLIDE',
        slideId,
        before,
        after,
      );
      return toHeroSlideRecord(after);
    });
  }

  deleteHeroSlide(slideId: string, actor: AuditActor): Promise<HomepageHeroSlideRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const deleted = await transaction.homepageHeroSlide.delete({
        where: { id: slideId },
        include: heroSlideInclude,
      });
      const remaining = await transaction.homepageHeroSlide.findMany({
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      await reassignHeroSlidePositions(
        transaction,
        remaining.map((row) => row.id),
        actor,
      );
      await createAudit(
        transaction,
        actor,
        'HOMEPAGE_HERO_SLIDE_DELETED',
        'HOMEPAGE_HERO_SLIDE',
        slideId,
        deleted,
        null,
      );
      return toHeroSlideRecord(deleted);
    });
  }

  reorderHeroSlides(
    slideIds: readonly string[],
    actor: AuditActor,
  ): Promise<readonly HomepageHeroSlideRecord[]> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.homepageHeroSlide.findMany({ select: { id: true } });
      const existingIds = new Set(existing.map((row) => row.id));
      const providedIds = new Set(slideIds);
      const isExactMatch =
        slideIds.length === existing.length &&
        providedIds.size === slideIds.length &&
        [...existingIds].every((id) => providedIds.has(id));
      if (!isExactMatch) throw heroSlideReorderMismatchError();

      const before = await transaction.homepageHeroSlide.findMany({
        include: heroSlideInclude,
        orderBy: { position: 'asc' },
      });
      await reassignHeroSlidePositions(transaction, slideIds, actor);
      const after = await transaction.homepageHeroSlide.findMany({
        include: heroSlideInclude,
        orderBy: { position: 'asc' },
      });
      await createAudit(
        transaction,
        actor,
        'HOMEPAGE_HERO_SLIDE_REORDERED',
        'HOMEPAGE_HERO_SLIDE',
        null,
        before,
        after,
      );
      return after.map(toHeroSlideRecord);
    });
  }

  async listTopStories(): Promise<readonly HomepageTopStoryRecord[]> {
    return this.prisma.homepageTopStory.findMany({ orderBy: { position: 'asc' } });
  }

  findTopStory(articleId: string): Promise<HomepageTopStoryRecord | null> {
    return this.prisma.homepageTopStory.findUnique({ where: { articleId } });
  }

  addTopStory(articleId: string, actor: AuditActor): Promise<HomepageTopStoryRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.homepageTopStory.findUnique({ where: { articleId } });
      if (existing !== null) return existing;
      const count = await transaction.homepageTopStory.count();
      if (count >= MAX_TOP_STORIES) throw topStoryLimitReachedError();
      const created = await transaction.homepageTopStory.create({
        data: {
          articleId,
          position: count,
          createdById: actor.userId,
          updatedById: actor.userId,
          createdBySnapshot: actor.emailSnapshot,
          updatedBySnapshot: actor.emailSnapshot,
        },
      });
      await createAudit(
        transaction,
        actor,
        'HOMEPAGE_TOP_STORY_MARKED',
        'HOMEPAGE_TOP_STORY',
        created.id,
        null,
        created,
      );
      return created;
    });
  }

  removeTopStory(articleId: string, actor: AuditActor): Promise<HomepageTopStoryRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.homepageTopStory.findUnique({ where: { articleId } });
      if (existing === null) return null;
      const deleted = await transaction.homepageTopStory.delete({ where: { articleId } });
      const remaining = await transaction.homepageTopStory.findMany({
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      await reassignTopStoryPositions(
        transaction,
        remaining.map((row) => row.id),
        actor,
      );
      await createAudit(
        transaction,
        actor,
        'HOMEPAGE_TOP_STORY_UNMARKED',
        'HOMEPAGE_TOP_STORY',
        deleted.id,
        deleted,
        null,
      );
      return deleted;
    });
  }

  reorderTopStories(
    articleIds: readonly string[],
    actor: AuditActor,
  ): Promise<readonly HomepageTopStoryRecord[]> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.homepageTopStory.findMany();
      const byArticleId = new Map(existing.map((row) => [row.articleId, row]));
      const providedIds = new Set(articleIds);
      const isExactMatch =
        articleIds.length === existing.length &&
        providedIds.size === articleIds.length &&
        [...byArticleId.keys()].every((articleId) => providedIds.has(articleId));
      if (!isExactMatch) throw topStoryReorderMismatchError();

      const orderedIds = articleIds.map((articleId) => {
        const row = byArticleId.get(articleId);
        if (row === undefined) throw topStoryReorderMismatchError();
        return row.id;
      });
      await reassignTopStoryPositions(transaction, orderedIds, actor);
      const after = await transaction.homepageTopStory.findMany({ orderBy: { position: 'asc' } });
      await createAudit(
        transaction,
        actor,
        'HOMEPAGE_TOP_STORY_REORDERED',
        'HOMEPAGE_TOP_STORY',
        null,
        existing,
        after,
      );
      return after;
    });
  }

  findArticlesByIds(articleIds: readonly string[]): Promise<readonly ArticleRecord[]> {
    if (articleIds.length === 0) return Promise.resolve([]);
    return this.prisma.article.findMany({
      where: { id: { in: [...articleIds] } },
      include: articleInclude,
    });
  }

  findPublicArticlesByIds(articleIds: readonly string[]): Promise<readonly ArticleRecord[]> {
    if (articleIds.length === 0) return Promise.resolve([]);
    return this.prisma.article.findMany({
      where: {
        id: { in: [...articleIds] },
        OR: [
          { status: 'PUBLISHED', publishedAt: { lte: new Date() } },
          { status: 'SCHEDULED', scheduledFor: { lte: new Date() } },
        ],
      },
      include: articleInclude,
    });
  }

  findRecentPublicArticles(limit: number): Promise<readonly ArticleRecord[]> {
    return this.prisma.article.findMany({
      where: {
        OR: [
          { status: 'PUBLISHED', publishedAt: { lte: new Date() } },
          { status: 'SCHEDULED', scheduledFor: { lte: new Date() } },
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: articleInclude,
    });
  }

  findRecentGamesWithMedia(limit: number): Promise<readonly GameWithTeams[]> {
    return this.prisma.game.findMany({
      where: {
        status: 'FINAL',
        OR: [{ curatedVideos: { some: {} } }, { highlights: { some: {} } }],
      },
      include: publicGameInclude,
      orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  async listActiveHighlightPlacements(): Promise<readonly HomepageHighlightPlacementRecord[]> {
    return this.prisma.homepageHighlightPlacement.findMany({ orderBy: { position: 'asc' } });
  }

  findHighlightPlacement(placementId: string): Promise<HomepageHighlightPlacementRecord | null> {
    return this.prisma.homepageHighlightPlacement.findUnique({ where: { id: placementId } });
  }

  findHighlightPlacementBySource(
    sourceType: HomepageHighlightSourceTypeValue,
    sourceId: string,
  ): Promise<HomepageHighlightPlacementRecord | null> {
    return this.prisma.homepageHighlightPlacement.findUnique({
      where: { sourceType_sourceId: { sourceType, sourceId } },
    });
  }

  createHighlightPlacement(
    input: { sourceType: HomepageHighlightSourceTypeValue; sourceId: string; gameId: string },
    actor: AuditActor,
  ): Promise<HomepageHighlightPlacementRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const count = await transaction.homepageHighlightPlacement.count();
      if (count >= MAX_HOMEPAGE_HIGHLIGHT_PLACEMENTS) throw highlightPlacementLimitReachedError();
      const existing = await transaction.homepageHighlightPlacement.findUnique({
        where: {
          sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId },
        },
      });
      if (existing !== null) throw highlightPlacementDuplicateError();
      const created = await transaction.homepageHighlightPlacement.create({
        data: {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          gameId: input.gameId,
          position: count,
          createdById: actor.userId,
          updatedById: actor.userId,
          createdBySnapshot: actor.emailSnapshot,
          updatedBySnapshot: actor.emailSnapshot,
        },
      });
      await createAudit(
        transaction,
        actor,
        'HOMEPAGE_HIGHLIGHT_ADDED',
        'HOMEPAGE_HIGHLIGHT_PLACEMENT',
        created.id,
        null,
        created,
      );
      return created;
    });
  }

  deleteHighlightPlacement(
    placementId: string,
    actor: AuditActor,
  ): Promise<HomepageHighlightPlacementRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.homepageHighlightPlacement.findUnique({
        where: { id: placementId },
      });
      if (existing === null) return null;
      const deleted = await transaction.homepageHighlightPlacement.delete({
        where: { id: placementId },
      });
      const remaining = await transaction.homepageHighlightPlacement.findMany({
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      await reassignHighlightPlacementPositions(
        transaction,
        remaining.map((row) => row.id),
        actor,
      );
      await createAudit(
        transaction,
        actor,
        'HOMEPAGE_HIGHLIGHT_REMOVED',
        'HOMEPAGE_HIGHLIGHT_PLACEMENT',
        deleted.id,
        deleted,
        null,
      );
      return deleted;
    });
  }

  reorderHighlightPlacements(
    placementIds: readonly string[],
    actor: AuditActor,
  ): Promise<readonly HomepageHighlightPlacementRecord[]> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.homepageHighlightPlacement.findMany({
        select: { id: true },
      });
      const existingIds = new Set(existing.map((row) => row.id));
      const providedIds = new Set(placementIds);
      const isExactMatch =
        placementIds.length === existing.length &&
        providedIds.size === placementIds.length &&
        [...existingIds].every((id) => providedIds.has(id));
      if (!isExactMatch) throw highlightPlacementReorderMismatchError();

      const before = await transaction.homepageHighlightPlacement.findMany({
        orderBy: { position: 'asc' },
      });
      await reassignHighlightPlacementPositions(transaction, placementIds, actor);
      const after = await transaction.homepageHighlightPlacement.findMany({
        orderBy: { position: 'asc' },
      });
      await createAudit(
        transaction,
        actor,
        'HOMEPAGE_HIGHLIGHTS_REORDERED',
        'HOMEPAGE_HIGHLIGHT_PLACEMENT',
        null,
        before,
        after,
      );
      return after;
    });
  }

  async getHighlightSettings(): Promise<HomepageHighlightSettingsRecord> {
    const row = await this.prisma.homepageHighlightSettings.findFirst();
    return row ?? { displayLimit: 5, fillWithAutomatic: true };
  }

  updateHighlightSettings(
    input: UpdateHighlightSettingsInput,
    actor: AuditActor,
  ): Promise<HomepageHighlightSettingsRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.homepageHighlightSettings.findFirst();
      const data = {
        ...(input.displayLimit === undefined ? {} : { displayLimit: input.displayLimit }),
        ...(input.fillWithAutomatic === undefined
          ? {}
          : { fillWithAutomatic: input.fillWithAutomatic }),
        updatedById: actor.userId,
        updatedBySnapshot: actor.emailSnapshot,
      };
      const after =
        before === null
          ? await transaction.homepageHighlightSettings.create({
              data: {
                displayLimit: input.displayLimit ?? 5,
                fillWithAutomatic: input.fillWithAutomatic ?? true,
                updatedById: actor.userId,
                updatedBySnapshot: actor.emailSnapshot,
              },
            })
          : await transaction.homepageHighlightSettings.update({
              where: { id: before.id },
              data,
            });
      await createAudit(
        transaction,
        actor,
        'HOMEPAGE_HIGHLIGHT_SETTINGS_UPDATED',
        'HOMEPAGE_HIGHLIGHT_SETTINGS',
        after.id,
        before,
        after,
      );
      return after;
    });
  }

  findGameHighlightSource(id: string): Promise<{ readonly gameId: string } | null> {
    return this.prisma.gameHighlight.findUnique({ where: { id }, select: { gameId: true } });
  }

  findCuratedVideoSource(id: string): Promise<{ readonly gameId: string } | null> {
    return this.prisma.gameCuratedVideo.findUnique({ where: { id }, select: { gameId: true } });
  }

  findGamesWithTeamsByIds(gameIds: readonly string[]): Promise<readonly GameWithTeams[]> {
    if (gameIds.length === 0) return Promise.resolve([]);
    return this.prisma.game.findMany({
      where: { id: { in: [...gameIds] } },
      include: publicGameInclude,
    });
  }

  async listHighlightCandidates(
    query: HighlightCandidatesQuery,
  ): Promise<HomepageHighlightCandidateListResult> {
    const takePerType = query.limit + 1;
    const dateWhere =
      query.dateFrom === undefined && query.dateTo === undefined
        ? {}
        : {
            startTime: {
              ...(query.dateFrom === undefined ? {} : { gte: query.dateFrom }),
              ...(query.dateTo === undefined ? {} : { lte: query.dateTo }),
            },
          };
    const gameWhere = { ...(query.gameId === undefined ? {} : { id: query.gameId }), ...dateWhere };

    const [highlightRows, curatedRows] = await Promise.all([
      query.mediaType === 'CURATED_GAME_VIDEO'
        ? Promise.resolve([])
        : this.prisma.gameHighlight.findMany({
            where: { game: gameWhere },
            include: { game: { include: publicGameInclude } },
            orderBy: [{ publishedAt: 'desc' }, { firstSeenAt: 'desc' }],
            take: takePerType,
          }),
      query.mediaType === 'GAME_HIGHLIGHT'
        ? Promise.resolve([])
        : this.prisma.gameCuratedVideo.findMany({
            where: { game: gameWhere },
            include: { game: { include: publicGameInclude } },
            orderBy: [{ createdAt: 'desc' }],
            take: takePerType,
          }),
    ]);

    const candidates: HomepageHighlightCandidateRecord[] = [
      ...highlightRows.map((row): HomepageHighlightCandidateRecord => ({
        sourceType: 'GAME_HIGHLIGHT',
        sourceId: row.id,
        gameId: row.gameId,
        title: row.title,
        thumbnailUrl: row.thumbnailUrl,
        game: row.game,
      })),
      ...curatedRows.map((row): HomepageHighlightCandidateRecord => ({
        sourceType: 'CURATED_GAME_VIDEO',
        sourceId: row.id,
        gameId: row.gameId,
        title: row.title,
        thumbnailUrl: row.thumbnailUrl,
        game: row.game,
      })),
    ].sort(
      (left, right) =>
        (right.game.startTime?.getTime() ?? 0) - (left.game.startTime?.getTime() ?? 0) ||
        left.sourceId.localeCompare(right.sourceId),
    );

    const cursorKey = (candidate: HomepageHighlightCandidateRecord): string =>
      `${candidate.sourceType}:${candidate.sourceId}`;
    const startIndex =
      query.cursor === undefined
        ? 0
        : candidates.findIndex((candidate) => cursorKey(candidate) === query.cursor) + 1;
    const page = candidates.slice(startIndex, startIndex + query.limit);
    const hasMore = candidates.length > startIndex + query.limit;
    const last = page.at(-1);
    return { candidates: page, nextCursor: hasMore && last !== undefined ? cursorKey(last) : null };
  }

  async findCurrentWeekContext(): Promise<HomepageCurrentWeekContext | null> {
    const upcoming = await this.prisma.game.findFirst({
      where: {
        status: { in: ['SCHEDULED', 'PREGAME', 'IN_PROGRESS', 'HALFTIME'] },
        week: { not: null },
      },
      orderBy: [{ startTime: 'asc' }],
      select: { season: true, week: true, seasonType: true },
    });
    if (upcoming?.week != null) {
      return { season: upcoming.season, week: upcoming.week, seasonType: upcoming.seasonType };
    }

    const recentFinal = await this.prisma.game.findFirst({
      where: { status: 'FINAL', week: { not: null } },
      orderBy: [{ startTime: 'desc' }],
      select: { season: true, week: true, seasonType: true },
    });
    if (recentFinal?.week != null) {
      return {
        season: recentFinal.season,
        week: recentFinal.week,
        seasonType: recentFinal.seasonType,
      };
    }

    return null;
  }
}

/** Same two-phase (negative-then-final) reassignment as
 * `game-media-curation.repository.ts`'s `reassignPositions` -- the
 * `position` unique constraint is checked per-statement, so writing final
 * positions directly can collide with another row's still-current position
 * mid-transaction (e.g. swapping positions 0 and 1). */
async function reassignHeroSlidePositions(
  transaction: Prisma.TransactionClient,
  orderedIds: readonly string[],
  actor: AuditActor,
): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await transaction.homepageHeroSlide.update({ where: { id }, data: { position: -(index + 1) } });
  }
  for (const [index, id] of orderedIds.entries()) {
    await transaction.homepageHeroSlide.update({
      where: { id },
      data: { position: index, updatedById: actor.userId, updatedBySnapshot: actor.emailSnapshot },
    });
  }
}

async function reassignTopStoryPositions(
  transaction: Prisma.TransactionClient,
  orderedIds: readonly string[],
  actor: AuditActor,
): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await transaction.homepageTopStory.update({ where: { id }, data: { position: -(index + 1) } });
  }
  for (const [index, id] of orderedIds.entries()) {
    await transaction.homepageTopStory.update({
      where: { id },
      data: { position: index, updatedById: actor.userId, updatedBySnapshot: actor.emailSnapshot },
    });
  }
}

async function reassignHighlightPlacementPositions(
  transaction: Prisma.TransactionClient,
  orderedIds: readonly string[],
  actor: AuditActor,
): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await transaction.homepageHighlightPlacement.update({
      where: { id },
      data: { position: -(index + 1) },
    });
  }
  for (const [index, id] of orderedIds.entries()) {
    await transaction.homepageHighlightPlacement.update({
      where: { id },
      data: { position: index, updatedById: actor.userId, updatedBySnapshot: actor.emailSnapshot },
    });
  }
}

/** Matches the `createAudit` helper duplicated per-module across
 * `admin.repository.ts`, `game-media-curation.repository.ts`, and
 * `global-game-media.repository.ts`. */
async function createAudit(
  transaction: Pick<PrismaClient, 'adminAuditEvent'> | Prisma.TransactionClient,
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
): Promise<void> {
  await transaction.adminAuditEvent.create({
    data: {
      actorUserId: actor.userId,
      actorEmailSnapshot: actor.emailSnapshot,
      action,
      entityType,
      entityId,
      ...(before === null ? {} : { beforeSnapshot: sanitizeAuditSnapshot(before) }),
      ...(after === null ? {} : { afterSnapshot: sanitizeAuditSnapshot(after) }),
      requestId: actor.requestId,
    },
  });
}

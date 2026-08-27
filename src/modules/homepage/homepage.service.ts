import { AppError } from '../../common/errors/app-error.js';
import type { AuditActor } from '../../common/audit/audit-actor.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import type { PublicGameMediaDto } from '../game-media-curation/game-media-curation.dto.js';
import {
  toAdminHeroListDto,
  toAdminHeroSlideDto,
  toAdminTopStoryDto,
  toPublicHeroSlideDto,
  toPublicHomepageHighlightDto,
  toPublicTopStoryDto,
  type AdminHeroListDto,
  type AdminHeroSlideDto,
  type AdminTopStoryDto,
  type PublicHomepageDto,
  type PublicHomepageHighlightDto,
  type PublicHomepageLeaderDto,
  type PublicHomepageLeadersDto,
} from './homepage.dto.js';
import type {
  CreateHeroSlideInput,
  ReorderHeroSlidesInput,
  ReorderTopStoriesInput,
  UpdateHeroSlideInput,
} from './homepage.schemas.js';
import type { HomepageRepository, HomepageTopStoryRecord } from './homepage.repository.js';

/**
 * M35A: the one method this service needs from `GameMediaCurationService`,
 * defined locally so this module never imports that whole service surface --
 * mirrors the `GameMediaHighlightsReader`/`HighlightSyncPort` convention.
 */
export interface HomepageGameMediaReader {
  getPublicGameMedia(gameId: string): Promise<PublicGameMediaDto>;
}

/** Narrow slice of `StatsHubReader` -- both methods return `unknown` in that
 * module's own public contract (the controller forwards the response body
 * as-is), so this service validates the real shape defensively at the
 * boundary rather than trusting a blind cast (see `readLeaderRows`/
 * `readAvailableSeasons`). */
export interface HomepageStatsReader {
  getSeasonLeaders(query: {
    readonly season: number;
    readonly seasonType: 'REG';
    readonly metric: string;
    readonly limit: number;
  }): Promise<unknown>;
  getMetadata(): Promise<unknown>;
}

export interface HomepageServiceOptions {
  readonly repository: HomepageRepository;
  readonly gameMedia: HomepageGameMediaReader;
  readonly stats: HomepageStatsReader;
  /** Used only if no season has any imported stats at all (see
   * `resolveLeaderSeason`) -- never used to silently mix in un-imported
   * current-season data. */
  readonly fallbackSeason: number;
}

// M35A spec: "recommended 4-8" -- fixed, not open-ended, matching the
// `MAX_CURATED_VIDEOS_PER_GAME` convention of a small constant rather than a
// configurable knob for a bound this narrow.
const HOMEPAGE_HIGHLIGHTS_LIMIT = 8;
const HOMEPAGE_LEADER_LIMIT = 3;

export interface HomepageServiceContract {
  // Admin: Hero
  listHeroSlides(): Promise<AdminHeroListDto>;
  getHeroSlide(slideId: string): Promise<AdminHeroSlideDto>;
  createHeroSlide(
    input: CreateHeroSlideInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminHeroSlideDto>;
  updateHeroSlide(
    slideId: string,
    input: UpdateHeroSlideInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminHeroSlideDto>;
  deleteHeroSlide(
    slideId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminHeroListDto>;
  reorderHeroSlides(
    input: ReorderHeroSlidesInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminHeroListDto>;

  // Admin: Top Stories
  listTopStories(): Promise<readonly AdminTopStoryDto[]>;
  markTopStory(
    articleId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminTopStoryDto>;
  unmarkTopStory(
    articleId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<void>;
  reorderTopStories(
    input: ReorderTopStoriesInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<readonly AdminTopStoryDto[]>;

  // Public
  getPublicHomepage(): Promise<PublicHomepageDto>;
}

function toActor(principal: AdministrativePrincipal, requestId: string | null): AuditActor {
  return { userId: principal.userId, emailSnapshot: principal.email, requestId };
}

function heroSlideNotFoundError(): AppError {
  return new AppError({
    code: 'HOMEPAGE_HERO_SLIDE_NOT_FOUND',
    message: 'The requested Hero slide was not found.',
    statusCode: 404,
  });
}

function articleNotFoundError(): AppError {
  return new AppError({
    code: 'ARTICLE_NOT_FOUND',
    message: 'The requested article was not found.',
    statusCode: 404,
  });
}

export class HomepageService implements HomepageServiceContract {
  constructor(private readonly options: HomepageServiceOptions) {}

  async listHeroSlides(): Promise<AdminHeroListDto> {
    return toAdminHeroListDto(await this.options.repository.listHeroSlides());
  }

  async getHeroSlide(slideId: string): Promise<AdminHeroSlideDto> {
    return toAdminHeroSlideDto(await this.requireHeroSlide(slideId));
  }

  async createHeroSlide(
    input: CreateHeroSlideInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminHeroSlideDto> {
    const created = await this.options.repository.createHeroSlide(
      input,
      toActor(principal, requestId),
    );
    return toAdminHeroSlideDto(created);
  }

  async updateHeroSlide(
    slideId: string,
    input: UpdateHeroSlideInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminHeroSlideDto> {
    await this.requireHeroSlide(slideId);
    const updated = await this.options.repository.updateHeroSlide(
      slideId,
      input,
      toActor(principal, requestId),
    );
    return toAdminHeroSlideDto(updated);
  }

  async deleteHeroSlide(
    slideId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminHeroListDto> {
    await this.requireHeroSlide(slideId);
    await this.options.repository.deleteHeroSlide(slideId, toActor(principal, requestId));
    return this.listHeroSlides();
  }

  async reorderHeroSlides(
    input: ReorderHeroSlidesInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminHeroListDto> {
    const reordered = await this.options.repository.reorderHeroSlides(
      input.slideIds,
      toActor(principal, requestId),
    );
    return toAdminHeroListDto(reordered);
  }

  async listTopStories(): Promise<readonly AdminTopStoryDto[]> {
    const topStories = await this.options.repository.listTopStories();
    return this.attachArticles(topStories);
  }

  async markTopStory(
    articleId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminTopStoryDto> {
    // Existence-only check, deliberately not the public-visibility filter --
    // an operator may curate a DRAFT/SCHEDULED article ahead of its publish
    // time; the public read (`getPublicTopStories`) is what actually enforces
    // eligibility at render time (M35A spec §18).
    const [article] = await this.options.repository.findArticlesByIds([articleId]);
    if (article === undefined) throw articleNotFoundError();
    const topStory = await this.options.repository.addTopStory(
      articleId,
      toActor(principal, requestId),
    );
    return toAdminTopStoryDto(topStory, article);
  }

  async unmarkTopStory(
    articleId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<void> {
    await this.options.repository.removeTopStory(articleId, toActor(principal, requestId));
  }

  async reorderTopStories(
    input: ReorderTopStoriesInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<readonly AdminTopStoryDto[]> {
    const reordered = await this.options.repository.reorderTopStories(
      input.articleIds,
      toActor(principal, requestId),
    );
    return this.attachArticles(reordered);
  }

  async getPublicHomepage(): Promise<PublicHomepageDto> {
    const [heroSlides, topStories, highlights, leaders] = await Promise.all([
      this.getPublicHeroSlides(),
      this.getPublicTopStories(),
      this.getHighlights(),
      this.getLeaders(),
    ]);
    return { heroSlides, topStories, highlights, leaders };
  }

  private async getPublicHeroSlides() {
    const slides = await this.options.repository.listActiveHeroSlides();
    return slides.map(toPublicHeroSlideDto);
  }

  private async getPublicTopStories() {
    const topStories = await this.options.repository.listTopStories();
    if (topStories.length === 0) return [];
    const articles = await this.options.repository.findPublicArticlesByIds(
      topStories.map((row) => row.articleId),
    );
    const articleById = new Map(articles.map((article) => [article.id, article]));
    // A curated article that has since become publicly ineligible (archived,
    // unpublished, rescheduled) is silently dropped here -- never rendered
    // with a broken/invalid reference (M35A spec §18).
    return topStories
      .map((topStory) => {
        const article = articleById.get(topStory.articleId);
        return article === undefined ? null : toPublicTopStoryDto(topStory, article);
      })
      .filter((dto): dto is NonNullable<typeof dto> => dto !== null);
  }

  private async getHighlights(): Promise<readonly PublicHomepageHighlightDto[]> {
    const games = await this.options.repository.findRecentGamesWithMedia(HOMEPAGE_HIGHLIGHTS_LIMIT);
    const items = await Promise.all(
      games.map(async (game) => {
        const media = await this.options.gameMedia.getPublicGameMedia(game.id);
        // `findRecentGamesWithMedia` only ever returns games with at least
        // one curated video or automatic highlight, so this is never the
        // global-only case -- the first entry is always CURATED or
        // AUTOMATIC, never GLOBAL. The explicit filter is a second,
        // defense-in-depth guarantee that the global video is never
        // duplicated across every game on the homepage (M35A spec §20).
        const item = media.displayVideos.find((video) => video.mediaType !== 'GLOBAL');
        return item === undefined ? null : toPublicHomepageHighlightDto(game, item);
      }),
    );
    return items.filter((item): item is PublicHomepageHighlightDto => item !== null);
  }

  private async getLeaders(): Promise<PublicHomepageLeadersDto> {
    const season = await this.resolveLeaderSeason();
    const [passing, rushing, receiving] = await Promise.all([
      this.getLeaderCategory(season, 'passing_yards'),
      this.getLeaderCategory(season, 'rushing_yards'),
      this.getLeaderCategory(season, 'receiving_yards'),
    ]);
    return { season, seasonType: 'REG', passing, rushing, receiving };
  }

  private async getLeaderCategory(
    season: number,
    metric: string,
  ): Promise<readonly PublicHomepageLeaderDto[]> {
    const raw = await this.options.stats.getSeasonLeaders({
      season,
      seasonType: 'REG',
      metric,
      limit: HOMEPAGE_LEADER_LIMIT,
    });
    return readLeaderRows(raw).map((row) => ({
      rank: row.rank,
      player: row.player,
      team: row.teamContext.type === 'SINGLE' ? (row.teamContext.teams[0] ?? null) : null,
      value: row.metricValue,
    }));
  }

  /**
   * "Latest completed REG season available" (M35A spec §24) -- never the
   * live/current `CURRENT_NFL_SEASON`, since stats-hub's own coverage notes
   * are explicit that only imported historical seasons have real data (no
   * live current-season player statistics exist yet). Falls back to
   * `fallbackSeason` only when stats-hub reports no imported seasons at all,
   * in which case every leader category legitimately returns empty --
   * never fabricated.
   */
  private async resolveLeaderSeason(): Promise<number> {
    const seasons = readAvailableSeasons(await this.options.stats.getMetadata());
    if (seasons.length === 0) return this.options.fallbackSeason;
    return Math.max(...seasons);
  }

  private async attachArticles(
    topStories: readonly HomepageTopStoryRecord[],
  ): Promise<readonly AdminTopStoryDto[]> {
    if (topStories.length === 0) return [];
    // Unfiltered lookup -- an admin must be able to see/manage a curation row
    // even when its article is no longer publicly eligible (see
    // `findArticlesByIds` doc comment); the public read filters separately.
    const articles = await this.options.repository.findArticlesByIds(
      topStories.map((row) => row.articleId),
    );
    const articleById = new Map(articles.map((article) => [article.id, article]));
    return topStories
      .map((topStory) => {
        const article = articleById.get(topStory.articleId);
        return article === undefined ? null : toAdminTopStoryDto(topStory, article);
      })
      .filter((dto): dto is AdminTopStoryDto => dto !== null);
  }

  private async requireHeroSlide(slideId: string) {
    const slide = await this.options.repository.findHeroSlide(slideId);
    if (slide === null) throw heroSlideNotFoundError();
    return slide;
  }
}

interface LeaderRowLike {
  readonly rank: number;
  readonly metricValue: number;
  readonly player: {
    readonly id: string;
    readonly displayName: string;
    readonly position: string | null;
    readonly positionGroup: string | null;
    readonly headshotUrl: string | null;
  };
  readonly teamContext: {
    readonly type: 'NONE' | 'SINGLE' | 'MULTI';
    readonly teams: readonly {
      readonly id: string;
      readonly abbreviation: string;
      readonly fullName: string;
    }[];
  };
}

function readLeaderRows(value: unknown): readonly LeaderRowLike[] {
  if (typeof value !== 'object' || value === null || !('data' in value)) return [];
  const { data } = value;
  return Array.isArray(data) ? (data as readonly LeaderRowLike[]) : [];
}

function readAvailableSeasons(value: unknown): readonly number[] {
  if (typeof value !== 'object' || value === null || !('data' in value)) return [];
  const { data } = value;
  if (typeof data !== 'object' || data === null || !('availableSeasons' in data)) return [];
  const { availableSeasons } = data;
  return Array.isArray(availableSeasons)
    ? availableSeasons.filter((s): s is number => typeof s === 'number')
    : [];
}

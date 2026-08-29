import { AppError } from '../../common/errors/app-error.js';
import type { AuditActor } from '../../common/audit/audit-actor.js';
import { selectAutomaticTopStories } from './automatic-top-stories.js';
import { MAX_TOP_STORIES } from './homepage.schemas.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import type { PublicGameMediaDto } from '../game-media-curation/game-media-curation.dto.js';
import type { AiHubWeeklyInsightsService } from '../ai-hub/weekly-insights.service.js';
import type { InsightCard } from '../ai-hub/weekly-insights.js';
import {
  toAdminHeroListDto,
  toAdminHeroSlideDto,
  toAdminTopStoryDto,
  toAdminHomepageHighlightDto,
  toHomepageHighlightCandidateDto,
  toHomepageHighlightSettingsDto,
  toAutomaticTopStoryDto,
  toPublicHeroSlideDto,
  toPublicHomepageHighlightDto,
  toPublicTopStoryDto,
  type AdminHeroListDto,
  type AdminHeroSlideDto,
  type AdminTopStoryDto,
  type AdminHomepageHighlightDto,
  type HomepageAiHubSnapshotDto,
  type HomepageHighlightCandidateDto,
  type HomepageHighlightSettingsDto,
  type HomepageInsightPickDto,
  type HomepageInsightsDto,
  type HomepageWeeklyLeaderDto,
  type HomepageWeeklyLeadersDto,
  type PublicHomepageDto,
  type PublicHomepageHighlightDto,
  type PublicHomepageLeaderDto,
  type PublicHomepageLeadersDto,
} from './homepage.dto.js';
import type {
  AddHighlightPlacementInput,
  CreateHeroSlideInput,
  HighlightCandidatesQuery,
  ReorderHeroSlidesInput,
  ReorderHighlightPlacementsInput,
  ReorderTopStoriesInput,
  UpdateHeroSlideInput,
  UpdateHighlightSettingsInput,
} from './homepage.schemas.js';
import type {
  HomepageCurrentWeekContext,
  HomepageHighlightPlacementRecord,
  HomepageRepository,
  HomepageTopStoryRecord,
} from './homepage.repository.js';

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
  /** M37A: Insight Rail weekly leaders -- same "returns unknown, validate
   * defensively" contract as the other two methods (see `readWeeklyLeaderRows`). */
  getWeeklyLeaders(query: {
    readonly season: number;
    readonly week: number;
    readonly seasonType: 'REG' | 'POST';
    readonly metric: string;
    readonly limit: number;
  }): Promise<unknown>;
}

export interface HomepageServiceOptions {
  readonly repository: HomepageRepository;
  readonly gameMedia: HomepageGameMediaReader;
  readonly stats: HomepageStatsReader;
  /** M37A: Insight Rail AI Hub snapshot. `getWeeklyInsights` is a pure DB
   * read (no OpenAI call) that throws `WEEKLY_INSIGHTS_NOT_FOUND` (404) when
   * nothing is stored for the requested week -- `getAiHubSnapshot` catches
   * that specific case and degrades to `null` rather than propagating it. */
  readonly aiHub: AiHubWeeklyInsightsService;
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
// M42A: soft target for the combined curated + automatic Top Stories list --
// reuses the existing MAX_TOP_STORIES curation cap so the two numbers can
// never drift apart -- and the bounded recent-article pool the automatic
// pass selects from.
const HOMEPAGE_TOP_STORIES_TARGET = MAX_TOP_STORIES;
const HOMEPAGE_TOP_STORIES_AUTOMATIC_POOL_SIZE = 40;
const WEEKLY_LEADERS_MAX_BACKWARD_STEPS = 4;

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

  // Admin: Homepage highlight curation (M37A)
  listHighlightPlacements(): Promise<{
    readonly placements: readonly AdminHomepageHighlightDto[];
    readonly settings: HomepageHighlightSettingsDto;
  }>;
  listHighlightCandidates(query: HighlightCandidatesQuery): Promise<{
    readonly candidates: readonly HomepageHighlightCandidateDto[];
    readonly nextCursor: string | null;
  }>;
  addHighlightPlacement(
    input: AddHighlightPlacementInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminHomepageHighlightDto>;
  removeHighlightPlacement(
    placementId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<void>;
  reorderHighlightPlacements(
    input: ReorderHighlightPlacementsInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<readonly AdminHomepageHighlightDto[]>;
  updateHighlightSettings(
    input: UpdateHighlightSettingsInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<HomepageHighlightSettingsDto>;

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

function highlightSourceNotFoundError(): AppError {
  return new AppError({
    code: 'HOMEPAGE_HIGHLIGHT_SOURCE_NOT_FOUND',
    message: 'The referenced highlight or curated video was not found.',
    statusCode: 404,
  });
}

function highlightPlacementNotFoundError(): AppError {
  return new AppError({
    code: 'HOMEPAGE_HIGHLIGHT_PLACEMENT_NOT_FOUND',
    message: 'The requested homepage highlight placement was not found.',
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
    const [heroSlides, topStories, highlights, leaders, insights] = await Promise.all([
      this.getPublicHeroSlides(),
      this.getPublicTopStories(),
      this.getHighlights(),
      this.getLeaders(),
      this.getInsights(),
    ]);
    return { heroSlides, topStories, highlights, leaders, insights };
  }

  // -- Admin: Homepage highlight curation (M37A) --------------------------

  async listHighlightPlacements(): Promise<{
    readonly placements: readonly AdminHomepageHighlightDto[];
    readonly settings: HomepageHighlightSettingsDto;
  }> {
    const [settings, placements] = await Promise.all([
      this.options.repository.getHighlightSettings(),
      this.options.repository.listActiveHighlightPlacements(),
    ]);
    return {
      placements: await this.resolveAdminHighlightDtos(placements),
      settings: toHomepageHighlightSettingsDto(settings),
    };
  }

  async listHighlightCandidates(query: HighlightCandidatesQuery): Promise<{
    readonly candidates: readonly HomepageHighlightCandidateDto[];
    readonly nextCursor: string | null;
  }> {
    const [result, activePlacements] = await Promise.all([
      this.options.repository.listHighlightCandidates(query),
      this.options.repository.listActiveHighlightPlacements(),
    ]);
    const selectedKeys = new Set(
      activePlacements.map((placement) => `${placement.sourceType}:${placement.sourceId}`),
    );
    return {
      candidates: result.candidates.map((candidate) =>
        toHomepageHighlightCandidateDto(
          candidate,
          selectedKeys.has(`${candidate.sourceType}:${candidate.sourceId}`),
        ),
      ),
      nextCursor: result.nextCursor,
    };
  }

  async addHighlightPlacement(
    input: AddHighlightPlacementInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminHomepageHighlightDto> {
    const source =
      input.sourceType === 'GAME_HIGHLIGHT'
        ? await this.options.repository.findGameHighlightSource(input.sourceId)
        : await this.options.repository.findCuratedVideoSource(input.sourceId);
    if (source === null) throw highlightSourceNotFoundError();

    const created = await this.options.repository.createHighlightPlacement(
      { sourceType: input.sourceType, sourceId: input.sourceId, gameId: source.gameId },
      toActor(principal, requestId),
    );
    const [dto] = await this.resolveAdminHighlightDtos([created]);
    if (dto === undefined) throw highlightSourceNotFoundError();
    return dto;
  }

  async removeHighlightPlacement(
    placementId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<void> {
    const deleted = await this.options.repository.deleteHighlightPlacement(
      placementId,
      toActor(principal, requestId),
    );
    if (deleted === null) throw highlightPlacementNotFoundError();
  }

  async reorderHighlightPlacements(
    input: ReorderHighlightPlacementsInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<readonly AdminHomepageHighlightDto[]> {
    const reordered = await this.options.repository.reorderHighlightPlacements(
      input.placementIds,
      toActor(principal, requestId),
    );
    return this.resolveAdminHighlightDtos(reordered);
  }

  async updateHighlightSettings(
    input: UpdateHighlightSettingsInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<HomepageHighlightSettingsDto> {
    const updated = await this.options.repository.updateHighlightSettings(
      input,
      toActor(principal, requestId),
    );
    return toHomepageHighlightSettingsDto(updated);
  }

  /** Batches the game lookup for a set of placements (never N+1 game
   * queries), then resolves each placement's current preview via the same
   * `getPublicGameMedia` composition the public read path uses -- single
   * source of truth for "does this media item still exist and is it still
   * eligible." A placement whose game has vanished (shouldn't happen; cascade
   * delete removes the placement row with it) is dropped defensively rather
   * than thrown. */
  private async resolveAdminHighlightDtos(
    placements: readonly HomepageHighlightPlacementRecord[],
  ): Promise<readonly AdminHomepageHighlightDto[]> {
    if (placements.length === 0) return [];
    const games = await this.options.repository.findGamesWithTeamsByIds(
      placements.map((placement) => placement.gameId),
    );
    const gameById = new Map(games.map((game) => [game.id, game]));
    const dtos = await Promise.all(
      placements.map(async (placement) => {
        const game = gameById.get(placement.gameId);
        if (game === undefined) return null;
        const media = await this.options.gameMedia.getPublicGameMedia(placement.gameId);
        const item = media.displayVideos.find((video) => video.id === placement.sourceId);
        const preview =
          item === undefined || item.mediaType === 'GLOBAL'
            ? null
            : { title: item.title, thumbnailUrl: item.thumbnailUrl };
        return toAdminHomepageHighlightDto(placement, game, preview);
      }),
    );
    return dtos.filter((dto): dto is AdminHomepageHighlightDto => dto !== null);
  }

  private async getPublicHeroSlides() {
    const slides = await this.options.repository.listActiveHeroSlides();
    return slides.map(toPublicHeroSlideDto);
  }

  /**
   * M42A: curated rows remain authoritative, in `position` order, with
   * ordering and content entirely untouched by this change (M35A spec §18
   * still applies -- a curated article that has since become publicly
   * ineligible is silently dropped, never rendered broken). Only when the
   * curated list falls short of `HOMEPAGE_TOP_STORIES_TARGET` is it padded
   * with automatic picks, appended after every curated row, drawn from a
   * bounded recent-article pool and biased toward ARTICLE content and
   * source diversity by `selectAutomaticTopStories` -- mirroring the same
   * curated-first-then-automatic-fill pattern `getHighlights` already uses.
   */
  private async getPublicTopStories() {
    const topStories = await this.options.repository.listTopStories();
    const articles =
      topStories.length === 0
        ? []
        : await this.options.repository.findPublicArticlesByIds(
            topStories.map((row) => row.articleId),
          );
    const articleById = new Map(articles.map((article) => [article.id, article]));
    const curated = topStories
      .map((topStory) => {
        const article = articleById.get(topStory.articleId);
        return article === undefined ? null : toPublicTopStoryDto(topStory, article);
      })
      .filter((dto): dto is NonNullable<typeof dto> => dto !== null);

    if (curated.length >= HOMEPAGE_TOP_STORIES_TARGET) return curated;

    const excludedArticleIds = new Set(curated.map((dto) => dto.article.id));
    const pool = await this.options.repository.findRecentPublicArticles(
      HOMEPAGE_TOP_STORIES_AUTOMATIC_POOL_SIZE,
    );
    const automaticPicks = selectAutomaticTopStories(
      pool,
      excludedArticleIds,
      HOMEPAGE_TOP_STORIES_TARGET - curated.length,
    );
    const automatic = automaticPicks.map((article, index) =>
      toAutomaticTopStoryDto(article, curated.length + index),
    );
    return [...curated, ...automatic];
  }

  /**
   * M37A: admin-curated placements first (in `position` order), bounded and
   * padded up to `displayLimit` with automatic recency-based fallback when
   * `fillWithAutomatic` is enabled -- otherwise curated-only, never padded
   * with fake content (spec §7-8). A placement is silently excluded if its
   * underlying media row has been deleted or is no longer publicly eligible
   * (spec §9): rather than duplicating `GameCuratedVideo`/`GameHighlight`
   * eligibility rules here, this looks the placement's `sourceId` up inside
   * the game's already-composed `displayVideos` (the exact same
   * `GameMediaCurationService` output the public per-game Game Center uses)
   * -- if it's not there, it's stale/ineligible, full stop.
   */
  private async getHighlights(): Promise<readonly PublicHomepageHighlightDto[]> {
    const [settings, placements] = await Promise.all([
      this.options.repository.getHighlightSettings(),
      this.options.repository.listActiveHighlightPlacements(),
    ]);
    const displayLimit = settings.displayLimit;

    const placementGames = await this.options.repository.findGamesWithTeamsByIds(
      placements.map((placement) => placement.gameId),
    );
    const gameById = new Map(placementGames.map((game) => [game.id, game]));

    const curatedResults = await Promise.all(
      placements.map(async (placement) => {
        const game = gameById.get(placement.gameId);
        if (game === undefined) return null;
        const media = await this.options.gameMedia.getPublicGameMedia(placement.gameId);
        const item = media.displayVideos.find((video) => video.id === placement.sourceId);
        if (item === undefined || item.mediaType === 'GLOBAL') return null;
        return toPublicHomepageHighlightDto(game, item, 'CURATED');
      }),
    );
    const curated = curatedResults
      .filter((item): item is PublicHomepageHighlightDto => item !== null)
      .slice(0, displayLimit);

    if (curated.length >= displayLimit || !settings.fillWithAutomatic) {
      return curated;
    }

    // Never re-show a game that's already curated here, valid or not -- a
    // game with a since-stale curated placement doesn't fall back into the
    // automatic pool (spec §7: no duplicate media item across curated +
    // automatic).
    const excludedGameIds = new Set(placements.map((placement) => placement.gameId));
    const remaining = displayLimit - curated.length;
    const games = await this.options.repository.findRecentGamesWithMedia(
      HOMEPAGE_HIGHLIGHTS_LIMIT + excludedGameIds.size,
    );
    const fallback: PublicHomepageHighlightDto[] = [];
    for (const game of games) {
      if (fallback.length >= remaining) break;
      if (excludedGameIds.has(game.id)) continue;
      const media = await this.options.gameMedia.getPublicGameMedia(game.id);
      const item = media.displayVideos.find((video) => video.mediaType !== 'GLOBAL');
      if (item === undefined) continue;
      fallback.push(toPublicHomepageHighlightDto(game, item, 'AUTOMATIC'));
    }
    return [...curated, ...fallback];
  }

  // -- Insight Rail (M37A) --------------------------------------------------

  private async getInsights(): Promise<HomepageInsightsDto> {
    const context = await this.options.repository.findCurrentWeekContext();
    const [aiHub, weeklyLeaders] = await Promise.all([
      this.getAiHubSnapshot(context),
      this.getWeeklyLeadersSnapshot(context),
    ]);
    return { aiHub, weeklyLeaders };
  }

  private async getAiHubSnapshot(
    context: HomepageCurrentWeekContext | null,
  ): Promise<HomepageAiHubSnapshotDto | null> {
    if (context === null) return null;
    try {
      const insights = await this.options.aiHub.getWeeklyInsights({
        season: context.season,
        seasonType: context.seasonType,
        week: context.week,
        top: 3,
      });
      return {
        season: context.season,
        week: context.week,
        seasonType: context.seasonType,
        strongestPick: toInsightPickDto(insights.strongestPick),
        closestMatchup: toInsightPickDto(insights.closestMatchup),
        highestProjectedTotal: toInsightPickDto(insights.projectedHighestScoringGame),
      };
    } catch (error: unknown) {
      // No published predictions stored yet for this week -- degrade to
      // `null` (spec §20 analog: never fabricate), don't fail the homepage.
      if (error instanceof AppError && error.code === 'WEEKLY_INSIGHTS_NOT_FOUND') return null;
      throw error;
    }
  }

  /**
   * "Latest week with valid stored leader data" (spec §19): steps backward a
   * bounded number of weeks within the same season/current-week resolution
   * if the resolved current week has no stats posted yet (e.g. the week just
   * started) -- never crosses into a different season, never substitutes
   * historical season leaders for a module labeled "This Week" (spec §20).
   */
  private async getWeeklyLeadersSnapshot(
    context: HomepageCurrentWeekContext | null,
  ): Promise<HomepageWeeklyLeadersDto | null> {
    if (context === null) return null;
    const seasonType: 'REG' | 'POST' = context.seasonType === 'POST' ? 'POST' : 'REG';

    for (let step = 0; step <= WEEKLY_LEADERS_MAX_BACKWARD_STEPS; step += 1) {
      const week = context.week - step;
      if (week < 1) break;
      const [passing, rushing, receiving] = await Promise.all([
        this.getWeeklyLeaderCategory(context.season, week, seasonType, 'passing_yards'),
        this.getWeeklyLeaderCategory(context.season, week, seasonType, 'rushing_yards'),
        this.getWeeklyLeaderCategory(context.season, week, seasonType, 'receiving_yards'),
      ]);
      if (passing !== null || rushing !== null || receiving !== null) {
        return { season: context.season, week, seasonType, passing, rushing, receiving };
      }
    }
    return null;
  }

  private async getWeeklyLeaderCategory(
    season: number,
    week: number,
    seasonType: 'REG' | 'POST',
    metric: string,
  ): Promise<HomepageWeeklyLeaderDto | null> {
    let raw: unknown;
    try {
      raw = await this.options.stats.getWeeklyLeaders({
        season,
        week,
        seasonType,
        metric,
        limit: 1,
      });
    } catch (error: unknown) {
      // Stats-hub throws (rather than returning empty) for a season it has
      // no imported data for at all -- e.g. the live current season, which
      // never has historical player statistics imported. Treat exactly like
      // "no leader for this metric/week" so the Insight Rail degrades to
      // null instead of failing the whole homepage read (spec §20-21).
      if (error instanceof AppError) return null;
      throw error;
    }
    const [row] = readWeeklyLeaderRows(raw);
    if (row === undefined) return null;
    return {
      playerId: row.player.id,
      playerName: row.player.displayName,
      team: row.team.abbreviation,
      value: row.metricValue,
      metric,
      week: row.week,
      season: row.season,
    };
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

function toInsightPickDto(card: InsightCard | null): HomepageInsightPickDto | null {
  if (card === null) return null;
  return {
    game: {
      gameId: card.game.id,
      startTime: card.game.startTime,
      homeTeam: card.game.homeTeam,
      awayTeam: card.game.awayTeam,
    },
    favoriteTeam: card.favorite,
    favoriteProbability: card.favoriteProbability,
    projectedScore: card.projectedScore,
    projectedTotal: card.projectedTotal,
  };
}

interface WeeklyLeaderRowLike {
  readonly rank: number;
  readonly metricValue: number;
  readonly week: number;
  readonly season: number;
  readonly player: { readonly id: string; readonly displayName: string };
  readonly team: { readonly abbreviation: string };
}

function readWeeklyLeaderRows(value: unknown): readonly WeeklyLeaderRowLike[] {
  if (typeof value !== 'object' || value === null || !('data' in value)) return [];
  const { data } = value;
  return Array.isArray(data) ? (data as readonly WeeklyLeaderRowLike[]) : [];
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

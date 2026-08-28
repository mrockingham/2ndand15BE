import { AppError } from '../../common/errors/app-error.js';
import type { AuditActor } from '../../common/audit/audit-actor.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import { effectivePublishedAt } from '../articles/article.repository.js';
import { toPublicArticleListDto, type PublicArticleListDto } from '../articles/article.dto.js';
import type { PublicArticleReader } from '../articles/article.service.js';
import type { PublicGameMediaDto } from '../game-media-curation/game-media-curation.dto.js';
import {
  toArticleItem,
  toBannerDto,
  toVideoItem,
  type PublicTeamHomepageDto,
  type TeamHomepageEditorialItemDto,
  type TeamHomepageHighlightPlacementRecord,
  type TeamHomepageMediaSourceType,
  type TeamHomepagePlacementRecord,
  type TeamHomepageVideoDto,
} from './team-homepage.dto.js';
import type { TeamHomepageRepository } from './team-homepage.repository.js';
import type {
  AddTeamEditorialPlacementInput,
  AddTeamHighlightPlacementInput,
  ReorderTeamHomepagePlacementsInput,
  TeamHomepageCandidatesQuery,
  UpdateTeamBannerInput,
  UpdateTeamEditorialPlacementInput,
  UpdateTeamHighlightSettingsInput,
} from './team-homepage.schemas.js';

const MAX_EDITORIAL_PLACEMENTS = 8;
const MAX_HIGHLIGHT_PLACEMENTS = 10;
const MAX_SUPPORTING_ITEMS = 8;
const AUTOMATIC_GAME_CANDIDATES = 20;

export interface TeamHomepageGameMediaReader {
  getPublicGameMedia(gameId: string): Promise<PublicGameMediaDto>;
}

export interface TeamHomepageServiceContract {
  getPublicHomepage(teamId: string): Promise<PublicTeamHomepageDto>;
  getAdminHomepage(teamId: string): Promise<unknown>;
  updateBanner(
    teamId: string,
    input: UpdateTeamBannerInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<unknown>;
  listEditorial(teamId: string): Promise<unknown>;
  listEditorialCandidates(teamId: string, query: TeamHomepageCandidatesQuery): Promise<unknown>;
  addEditorial(
    teamId: string,
    input: AddTeamEditorialPlacementInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<unknown>;
  updateEditorial(
    teamId: string,
    placementId: string,
    input: UpdateTeamEditorialPlacementInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<unknown>;
  removeEditorial(
    teamId: string,
    placementId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<void>;
  reorderEditorial(
    teamId: string,
    input: ReorderTeamHomepagePlacementsInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<unknown>;
  listHighlights(teamId: string): Promise<unknown>;
  listHighlightCandidates(teamId: string, query: TeamHomepageCandidatesQuery): Promise<unknown>;
  addHighlight(
    teamId: string,
    input: AddTeamHighlightPlacementInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<unknown>;
  removeHighlight(
    teamId: string,
    placementId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<void>;
  reorderHighlights(
    teamId: string,
    input: ReorderTeamHomepagePlacementsInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<unknown>;
  updateHighlightSettings(
    teamId: string,
    input: UpdateTeamHighlightSettingsInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<unknown>;
}

export interface TeamHomepageServiceOptions {
  readonly repository: TeamHomepageRepository;
  readonly articles: PublicArticleReader;
  readonly gameMedia: TeamHomepageGameMediaReader;
  readonly now?: () => Date;
}

export class TeamHomepageService implements TeamHomepageServiceContract {
  private readonly now: () => Date;

  constructor(private readonly options: TeamHomepageServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async getPublicHomepage(teamId: string): Promise<PublicTeamHomepageDto> {
    await this.requireTeam(teamId);
    const [config, placements, articlePage, highlightPlacements, settings] = await Promise.all([
      this.options.repository.getConfig(teamId),
      this.options.repository.listEditorialPlacements(teamId),
      this.options.articles.listForTeam(teamId, { limit: 50 }),
      this.options.repository.listHighlightPlacements(teamId),
      this.options.repository.getHighlightSettings(teamId),
    ]);
    const editorial = await this.composeEditorial(teamId, placements, articlePage.articles);
    const highlights = await this.composeHighlights(
      teamId,
      highlightPlacements,
      settings.displayLimit,
      settings.fillWithAutomatic,
    );
    return { banner: toBannerDto(config), editorial, highlights };
  }

  async getAdminHomepage(teamId: string): Promise<unknown> {
    await this.requireTeam(teamId);
    const [config, editorial, highlights] = await Promise.all([
      this.options.repository.getConfig(teamId),
      this.listEditorial(teamId),
      this.listHighlights(teamId),
    ]);
    return { banner: toBannerDto(config), editorial, highlights };
  }

  async updateBanner(
    teamId: string,
    input: UpdateTeamBannerInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<unknown> {
    await this.requireTeam(teamId);
    return toBannerDto(
      await this.options.repository.updateConfig(teamId, input, toActor(principal, requestId)),
    );
  }

  async listEditorial(teamId: string): Promise<unknown> {
    await this.requireTeam(teamId);
    const placements = await this.options.repository.listEditorialPlacements(teamId);
    return {
      placements: await Promise.all(
        placements.map((placement) => this.toAdminEditorialPlacement(teamId, placement)),
      ),
    };
  }

  async listEditorialCandidates(
    teamId: string,
    query: TeamHomepageCandidatesQuery,
  ): Promise<unknown> {
    await this.requireTeam(teamId);
    const [articles, media, placements] = await Promise.all([
      this.options.repository.listArticleCandidates(teamId),
      this.options.repository.listMediaCandidates(teamId),
      this.options.repository.listEditorialPlacements(teamId),
    ]);
    const selected = new Map(placements.map((row) => [editorialSourceKey(row), row]));
    const rows = [
      ...articles.map((row) => ({
        type: 'ARTICLE' as const,
        id: row.id,
        title: row.title,
        status: row.status,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        isSelected: selected.has(`ARTICLE:${row.id}`),
        isLeadReplacement: false,
      })),
      ...media.map((row) => {
        const placement = selected.get(`VIDEO:${row.sourceType}:${row.sourceId}`);
        return {
          type: 'VIDEO' as const,
          id: row.sourceId,
          mediaSourceType: row.sourceType,
          gameId: row.gameId,
          title: row.title,
          thumbnailUrl: row.thumbnailUrl,
          canonicalUrl: row.canonicalUrl,
          embedUrl: row.embedUrl,
          canEmbed: row.canEmbed,
          publishedAt: row.publishedAt?.toISOString() ?? null,
          isSelected: placement !== undefined,
          isLeadReplacement: placement?.isLeadReplacement ?? false,
        };
      }),
    ];
    return paginate(rows, query);
  }

  async addEditorial(
    teamId: string,
    input: AddTeamEditorialPlacementInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<unknown> {
    await this.requireTeam(teamId);
    const existing = await this.options.repository.listEditorialPlacements(teamId);
    if (existing.length >= MAX_EDITORIAL_PLACEMENTS)
      throw conflict(
        'TEAM_HOMEPAGE_EDITORIAL_LIMIT',
        `A team may have at most ${String(MAX_EDITORIAL_PLACEMENTS)} editorial placements.`,
      );
    if (
      existing.some(
        (row) =>
          row.sourceType === input.sourceType &&
          row.sourceId === input.sourceId &&
          (input.sourceType === 'ARTICLE' || row.mediaSourceType === input.mediaSourceType),
      )
    )
      throw conflict(
        'TEAM_HOMEPAGE_EDITORIAL_DUPLICATE',
        'This content is already selected for the team.',
      );
    let gameId: string | null = null;
    let mediaSourceType: TeamHomepageMediaSourceType | null = null;
    if (input.sourceType === 'ARTICLE') {
      if ((await this.options.repository.findArticleCandidate(teamId, input.sourceId)) === null)
        throw notFound(
          'TEAM_HOMEPAGE_ARTICLE_NOT_FOUND',
          'The article is not related to this team.',
        );
    } else {
      const sourceType = input.mediaSourceType;
      if (sourceType === undefined)
        throw notFound('TEAM_HOMEPAGE_MEDIA_NOT_FOUND', 'The media source is invalid.');
      const source = await this.options.repository.findMediaCandidate(
        teamId,
        sourceType,
        input.sourceId,
      );
      if (source === null)
        throw notFound(
          'TEAM_HOMEPAGE_MEDIA_NOT_FOUND',
          'The media item does not belong to a game involving this team.',
        );
      gameId = source.gameId;
      mediaSourceType = sourceType;
    }
    const row = await this.options.repository.createEditorialPlacement(
      {
        teamId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        mediaSourceType,
        gameId,
        isLeadReplacement: input.isLeadReplacement,
      },
      toActor(principal, requestId),
    );
    return this.toAdminEditorialPlacement(teamId, row);
  }

  async updateEditorial(
    teamId: string,
    placementId: string,
    input: UpdateTeamEditorialPlacementInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<unknown> {
    await this.requireTeam(teamId);
    const placement = (await this.options.repository.listEditorialPlacements(teamId)).find(
      (row) => row.id === placementId,
    );
    if (placement === undefined) throw placementNotFound();
    if (input.isLeadReplacement && placement.sourceType !== 'VIDEO')
      throw conflict(
        'TEAM_HOMEPAGE_LEAD_REQUIRES_VIDEO',
        'Only a video may replace the lead article.',
      );
    if (
      input.isLeadReplacement &&
      (placement.mediaSourceType === null ||
        (await this.options.repository.findMediaCandidate(
          teamId,
          placement.mediaSourceType,
          placement.sourceId,
        )) === null)
    ) {
      throw notFound(
        'TEAM_HOMEPAGE_MEDIA_NOT_FOUND',
        'The media item is no longer available for this team.',
      );
    }
    const updated = await this.options.repository.updateEditorialLead(
      teamId,
      placementId,
      input.isLeadReplacement,
      toActor(principal, requestId),
    );
    if (updated === null) throw placementNotFound();
    return this.toAdminEditorialPlacement(teamId, updated);
  }

  async removeEditorial(
    teamId: string,
    placementId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<void> {
    await this.requireTeam(teamId);
    if (
      (await this.options.repository.deleteEditorialPlacement(
        teamId,
        placementId,
        toActor(principal, requestId),
      )) === null
    )
      throw placementNotFound();
  }

  async reorderEditorial(
    teamId: string,
    input: ReorderTeamHomepagePlacementsInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<unknown> {
    await this.requireTeam(teamId);
    const current = await this.options.repository.listEditorialPlacements(teamId);
    requireExactIds(
      current.map(({ id }) => id),
      input.placementIds,
      'TEAM_HOMEPAGE_EDITORIAL_REORDER_MISMATCH',
    );
    return {
      placements: await this.options.repository.reorderEditorialPlacements(
        teamId,
        input.placementIds,
        toActor(principal, requestId),
      ),
    };
  }

  async listHighlights(teamId: string): Promise<unknown> {
    await this.requireTeam(teamId);
    const [placements, settings] = await Promise.all([
      this.options.repository.listHighlightPlacements(teamId),
      this.options.repository.getHighlightSettings(teamId),
    ]);
    return {
      placements: await Promise.all(placements.map((row) => this.toAdminHighlightPlacement(row))),
      settings,
    };
  }

  async listHighlightCandidates(
    teamId: string,
    query: TeamHomepageCandidatesQuery,
  ): Promise<unknown> {
    await this.requireTeam(teamId);
    const [media, placements] = await Promise.all([
      this.options.repository.listMediaCandidates(teamId),
      this.options.repository.listHighlightPlacements(teamId),
    ]);
    const selected = new Set(placements.map((row) => `${row.sourceType}:${row.sourceId}`));
    return paginate(
      media.map((row) => ({
        ...row,
        sourceId: row.sourceId,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        isSelected: selected.has(`${row.sourceType}:${row.sourceId}`),
      })),
      query,
    );
  }

  async addHighlight(
    teamId: string,
    input: AddTeamHighlightPlacementInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<unknown> {
    await this.requireTeam(teamId);
    const existing = await this.options.repository.listHighlightPlacements(teamId);
    if (existing.length >= MAX_HIGHLIGHT_PLACEMENTS)
      throw conflict(
        'TEAM_HOMEPAGE_HIGHLIGHT_LIMIT',
        'A team may have at most 10 curated highlights.',
      );
    if (
      existing.some((row) => row.sourceType === input.sourceType && row.sourceId === input.sourceId)
    )
      throw conflict(
        'TEAM_HOMEPAGE_HIGHLIGHT_DUPLICATE',
        'This media item is already curated for the team.',
      );
    const source = await this.options.repository.findMediaCandidate(
      teamId,
      input.sourceType,
      input.sourceId,
    );
    if (source === null)
      throw notFound(
        'TEAM_HOMEPAGE_MEDIA_NOT_FOUND',
        'The media item does not belong to a game involving this team.',
      );
    return this.toAdminHighlightPlacement(
      await this.options.repository.createHighlightPlacement(
        teamId,
        source,
        toActor(principal, requestId),
      ),
    );
  }

  async removeHighlight(
    teamId: string,
    placementId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<void> {
    await this.requireTeam(teamId);
    if (
      (await this.options.repository.deleteHighlightPlacement(
        teamId,
        placementId,
        toActor(principal, requestId),
      )) === null
    )
      throw highlightPlacementNotFound();
  }

  async reorderHighlights(
    teamId: string,
    input: ReorderTeamHomepagePlacementsInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<unknown> {
    await this.requireTeam(teamId);
    const current = await this.options.repository.listHighlightPlacements(teamId);
    requireExactIds(
      current.map(({ id }) => id),
      input.placementIds,
      'TEAM_HOMEPAGE_HIGHLIGHT_REORDER_MISMATCH',
    );
    return {
      placements: await this.options.repository.reorderHighlightPlacements(
        teamId,
        input.placementIds,
        toActor(principal, requestId),
      ),
    };
  }

  async updateHighlightSettings(
    teamId: string,
    input: UpdateTeamHighlightSettingsInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<unknown> {
    await this.requireTeam(teamId);
    return this.options.repository.updateHighlightSettings(
      teamId,
      input,
      toActor(principal, requestId),
    );
  }

  private async composeEditorial(
    teamId: string,
    placements: readonly TeamHomepagePlacementRecord[],
    fallbackArticles: readonly PublicArticleListDto[],
  ): Promise<{
    featuredItem: TeamHomepageEditorialItemDto | null;
    supportingItems: readonly TeamHomepageEditorialItemDto[];
  }> {
    const gameRows = await this.options.repository.findGamesByIds(
      placements.flatMap((row) => (row.gameId === null ? [] : [row.gameId])),
    );
    const gameTimes = new Map(gameRows.map((row) => [row.id, row.startTime]));
    const resolved = new Map<string, TeamHomepageEditorialItemDto>();
    await Promise.all(
      placements.map(async (placement) => {
        if (placement.sourceType === 'ARTICLE') {
          const article = await this.options.repository.findPublicArticle(
            teamId,
            placement.sourceId,
            this.now(),
          );
          const publishedAt = article === null ? null : effectivePublishedAt(article);
          if (article !== null && publishedAt !== null)
            resolved.set(placement.id, toArticleItem(toPublicArticleListDto(article, publishedAt)));
        } else if (placement.gameId !== null) {
          const item = await this.resolveVideo(
            placement.gameId,
            placement.sourceId,
            gameTimes.get(placement.gameId) ?? null,
          );
          if (item !== null) resolved.set(placement.id, item);
        }
      }),
    );
    const replacement = placements.find(
      (row) => row.sourceType === 'VIDEO' && row.isLeadReplacement && resolved.has(row.id),
    );
    const leadArticlePlacement = placements.find(
      (row) => row.sourceType === 'ARTICLE' && resolved.has(row.id),
    );
    const fallbackArticle = fallbackArticles[0];
    const featuredItem =
      replacement === undefined
        ? leadArticlePlacement === undefined
          ? fallbackArticle === undefined
            ? null
            : toArticleItem(fallbackArticle)
          : (resolved.get(leadArticlePlacement.id) ?? null)
        : (resolved.get(replacement.id) ?? null);
    const supporting: TeamHomepageEditorialItemDto[] = [];
    const used = new Set(featuredItem === null ? [] : [itemKey(featuredItem)]);
    for (const placement of placements) {
      if (
        placement.id === replacement?.id ||
        (placement.id === leadArticlePlacement?.id && replacement === undefined)
      )
        continue;
      const item = resolved.get(placement.id);
      if (item === undefined || used.has(itemKey(item))) continue;
      used.add(itemKey(item));
      supporting.push(item);
      if (supporting.length === MAX_SUPPORTING_ITEMS) break;
    }
    for (const article of fallbackArticles) {
      const item = toArticleItem(article);
      if (used.has(itemKey(item))) continue;
      used.add(itemKey(item));
      supporting.push(item);
      if (supporting.length === MAX_SUPPORTING_ITEMS) break;
    }
    return { featuredItem, supportingItems: supporting };
  }

  private async composeHighlights(
    teamId: string,
    placements: readonly TeamHomepageHighlightPlacementRecord[],
    displayLimit: number,
    fill: boolean,
  ): Promise<readonly TeamHomepageVideoDto[]> {
    const gameRows = await this.options.repository.findGamesByIds(
      placements.map(({ gameId }) => gameId),
    );
    const gameTimes = new Map(gameRows.map((row) => [row.id, row.startTime]));
    const curated: TeamHomepageVideoDto[] = [];
    const usedMedia = new Set<string>();
    const usedGames = new Set<string>();
    for (const placement of placements) {
      const item = await this.resolveVideo(
        placement.gameId,
        placement.sourceId,
        gameTimes.get(placement.gameId) ?? null,
      );
      if (item === null || usedMedia.has(item.id)) continue;
      usedMedia.add(item.id);
      usedGames.add(item.gameId);
      curated.push(item);
      if (curated.length === displayLimit) return curated;
    }
    if (!fill) return curated;
    const games = await this.options.repository.listRecentMediaGames(
      teamId,
      AUTOMATIC_GAME_CANDIDATES,
    );
    for (const game of games) {
      if (usedGames.has(game.id)) continue;
      const media = await this.options.gameMedia.getPublicGameMedia(game.id);
      const item = media.displayVideos.find(
        (row) => row.mediaType !== 'GLOBAL' && !usedMedia.has(row.id),
      );
      if (item === undefined) continue;
      const dto = toVideoItem(game.id, game.startTime, item);
      usedMedia.add(dto.id);
      usedGames.add(game.id);
      curated.push(dto);
      if (curated.length === displayLimit) break;
    }
    return curated;
  }

  private async resolveVideo(
    gameId: string,
    sourceId: string,
    publishedAt: Date | null,
  ): Promise<TeamHomepageVideoDto | null> {
    try {
      const media = await this.options.gameMedia.getPublicGameMedia(gameId);
      const item = media.displayVideos.find(
        (row) => row.id === sourceId && row.mediaType !== 'GLOBAL',
      );
      return item === undefined ? null : toVideoItem(gameId, publishedAt, item);
    } catch (error: unknown) {
      if (error instanceof AppError && error.code === 'GAME_NOT_FOUND') return null;
      throw error;
    }
  }

  private async toAdminEditorialPlacement(
    teamId: string,
    placement: TeamHomepagePlacementRecord,
  ): Promise<unknown> {
    if (placement.sourceType === 'ARTICLE') {
      const source = await this.options.repository.findArticleCandidate(teamId, placement.sourceId);
      return {
        ...placement,
        source:
          source === null
            ? null
            : {
                ...source,
                publishedAt: source.publishedAt?.toISOString() ?? null,
                updatedAt: source.updatedAt.toISOString(),
              },
        isAvailable: source !== null,
      };
    }
    const source =
      placement.mediaSourceType === null
        ? null
        : await this.options.repository.findMediaCandidate(
            teamId,
            placement.mediaSourceType,
            placement.sourceId,
          );
    return {
      ...placement,
      source:
        source === null
          ? null
          : { ...source, publishedAt: source.publishedAt?.toISOString() ?? null },
      isAvailable: source !== null,
    };
  }

  private async toAdminHighlightPlacement(
    placement: TeamHomepageHighlightPlacementRecord,
  ): Promise<unknown> {
    const source = await this.options.repository.findMediaCandidate(
      placement.teamId,
      placement.sourceType,
      placement.sourceId,
    );
    return {
      ...placement,
      source:
        source === null
          ? null
          : { ...source, publishedAt: source.publishedAt?.toISOString() ?? null },
      isAvailable: source !== null,
    };
  }

  private async requireTeam(teamId: string): Promise<void> {
    if (!(await this.options.repository.isActiveTeam(teamId)))
      throw notFound('TEAM_NOT_FOUND', 'The requested team was not found.');
  }
}

function paginate<T>(
  rows: readonly T[],
  query: TeamHomepageCandidatesQuery,
): { items: readonly T[]; nextCursor: string | null } {
  const offset = query.cursor ?? 0;
  const items = rows.slice(offset, offset + query.limit);
  return {
    items,
    nextCursor: offset + query.limit < rows.length ? String(offset + query.limit) : null,
  };
}
function itemKey(item: TeamHomepageEditorialItemDto): string {
  return item.type === 'ARTICLE' ? `ARTICLE:${item.article.id}` : `VIDEO:${item.id}`;
}
function editorialSourceKey(placement: TeamHomepagePlacementRecord): string {
  return placement.sourceType === 'ARTICLE'
    ? `ARTICLE:${placement.sourceId}`
    : `VIDEO:${placement.mediaSourceType ?? 'UNKNOWN'}:${placement.sourceId}`;
}
function toActor(principal: AdministrativePrincipal, requestId: string | null): AuditActor {
  return { userId: principal.userId, emailSnapshot: principal.email, requestId };
}
function requireExactIds(
  current: readonly string[],
  supplied: readonly string[],
  code: string,
): void {
  if (
    current.length !== supplied.length ||
    new Set(supplied).size !== supplied.length ||
    current.some((id) => !supplied.includes(id))
  )
    throw conflict(
      code,
      'placementIds must contain exactly the team’s current placements, each once.',
    );
}
function conflict(code: string, message: string): AppError {
  return new AppError({ code, message, statusCode: 409 });
}
function notFound(code: string, message: string): AppError {
  return new AppError({ code, message, statusCode: 404 });
}
function placementNotFound(): AppError {
  return notFound(
    'TEAM_HOMEPAGE_EDITORIAL_PLACEMENT_NOT_FOUND',
    'The editorial placement was not found.',
  );
}
function highlightPlacementNotFound(): AppError {
  return notFound(
    'TEAM_HOMEPAGE_HIGHLIGHT_PLACEMENT_NOT_FOUND',
    'The highlight placement was not found.',
  );
}

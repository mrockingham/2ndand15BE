import { AppError } from '../../common/errors/app-error.js';
import type { AuditActor } from '../../common/audit/audit-actor.js';
import type { AdministrativePrincipal } from '../admin/admin-authorization.js';
import { isAllowedEmbedHost } from '../game-highlights/embed-eligibility.js';
import type { PublicGameHighlightsDto } from '../game-highlights/game-highlights.dto.js';
import type { GameWithTeams } from '../games/game.dto.js';
import {
  toAdminGameMediaDetailDto,
  toAdminGameMediaSummaryDto,
  toAdminGlobalGameCenterVideoDto,
  toPublicGameMediaDto,
  type AdminGameMediaDetailDto,
  type AdminGameMediaSummaryDto,
  type AdminGlobalGameCenterVideoDto,
  type PublicGameMediaDto,
} from './game-media-curation.dto.js';
import type {
  CreateCuratedVideoInput,
  GameMediaWeekQuery,
  SetGlobalGameCenterVideoInput,
  UpdateCuratedVideoInput,
} from './game-media-curation.schemas.js';
import type {
  GameCuratedVideoRecord,
  GameMediaCurationRepository,
} from './game-media-curation.repository.js';
import type { GlobalGameMediaRepository } from './global-game-media.repository.js';

/**
 * M32: the one method this service needs from `GameHighlightsService`, defined
 * locally so this module never imports the whole game-highlights service
 * surface -- mirrors the `HighlightSyncPort` convention in
 * `current-game-poller.ts`. A real `GameHighlightsService` instance satisfies
 * this structurally.
 */
export interface GameMediaHighlightsReader {
  getPublicHighlights(gameId: string): Promise<PublicGameHighlightsDto>;
}

export interface GameMediaCurationServiceContract {
  listGamesForWeek(query: GameMediaWeekQuery): Promise<readonly AdminGameMediaSummaryDto[]>;
  getGameMediaDetail(gameId: string): Promise<AdminGameMediaDetailDto>;
  addVideo(
    gameId: string,
    input: CreateCuratedVideoInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameMediaDetailDto>;
  updateVideo(
    videoId: string,
    input: UpdateCuratedVideoInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameMediaDetailDto>;
  reorderVideos(
    gameId: string,
    videoIds: readonly string[],
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameMediaDetailDto>;
  deleteVideo(
    videoId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameMediaDetailDto>;
  getPublicGameMedia(gameId: string): Promise<PublicGameMediaDto>;
  getGlobalVideo(): Promise<AdminGlobalGameCenterVideoDto | null>;
  setGlobalVideo(
    input: SetGlobalGameCenterVideoInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGlobalGameCenterVideoDto>;
  removeGlobalVideo(
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGlobalGameCenterVideoDto | null>;
}

function toActor(principal: AdministrativePrincipal, requestId: string | null): AuditActor {
  return { userId: principal.userId, emailSnapshot: principal.email, requestId };
}

export class GameMediaCurationService implements GameMediaCurationServiceContract {
  constructor(
    private readonly repository: GameMediaCurationRepository,
    private readonly highlightsReader: GameMediaHighlightsReader,
    /** `null` disables embed-host allowlisting entirely. */
    private readonly embedAllowedHosts: readonly string[] | null,
    private readonly globalMediaRepository: GlobalGameMediaRepository,
  ) {}

  async listGamesForWeek(query: GameMediaWeekQuery): Promise<readonly AdminGameMediaSummaryDto[]> {
    const [rows, globalVideo] = await Promise.all([
      this.repository.listGamesForWeek(query),
      this.globalMediaRepository.findActive(),
    ]);
    const hasGlobalVideo = globalVideo !== null;
    return rows.map((row) =>
      toAdminGameMediaSummaryDto(
        row.game,
        row.curatedVideoCount,
        row.automaticHighlightCount,
        hasGlobalVideo,
      ),
    );
  }

  async getGameMediaDetail(gameId: string): Promise<AdminGameMediaDetailDto> {
    const game = await this.requireGame(gameId);
    const [videos, automaticHighlightCount, globalVideo] = await Promise.all([
      this.repository.listVideos(gameId),
      this.repository.countHighlights(gameId),
      this.globalMediaRepository.findActive(),
    ]);
    return toAdminGameMediaDetailDto(game, videos, automaticHighlightCount, globalVideo);
  }

  async addVideo(
    gameId: string,
    input: CreateCuratedVideoInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameMediaDetailDto> {
    await this.requireGame(gameId);
    this.requireAllowedEmbedHost(input.embedUrl);
    await this.repository.createVideo(gameId, input, toActor(principal, requestId));
    return this.getGameMediaDetail(gameId);
  }

  async updateVideo(
    videoId: string,
    input: UpdateCuratedVideoInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameMediaDetailDto> {
    const video = await this.requireVideo(videoId);
    if (input.embedUrl !== undefined) this.requireAllowedEmbedHost(input.embedUrl);
    await this.repository.updateVideo(videoId, input, toActor(principal, requestId));
    return this.getGameMediaDetail(video.gameId);
  }

  async reorderVideos(
    gameId: string,
    videoIds: readonly string[],
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameMediaDetailDto> {
    const game = await this.requireGame(gameId);
    const existing = await this.repository.listVideos(gameId);
    this.requireExactVideoSet(existing, videoIds);
    await this.repository.reorderVideos(game.id, videoIds, toActor(principal, requestId));
    return this.getGameMediaDetail(gameId);
  }

  async deleteVideo(
    videoId: string,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGameMediaDetailDto> {
    const video = await this.requireVideo(videoId);
    await this.repository.deleteVideo(videoId, toActor(principal, requestId));
    return this.getGameMediaDetail(video.gameId);
  }

  async getPublicGameMedia(gameId: string): Promise<PublicGameMediaDto> {
    await this.requireGame(gameId);
    const [videos, highlightsDto, globalVideo] = await Promise.all([
      this.repository.listVideos(gameId),
      this.highlightsReader.getPublicHighlights(gameId),
      this.globalMediaRepository.findActive(),
    ]);
    return toPublicGameMediaDto(
      gameId,
      videos,
      highlightsDto.highlights,
      highlightsDto.coverage,
      globalVideo,
    );
  }

  async getGlobalVideo(): Promise<AdminGlobalGameCenterVideoDto | null> {
    const video = await this.globalMediaRepository.findActive();
    return video === null ? null : toAdminGlobalGameCenterVideoDto(video);
  }

  async setGlobalVideo(
    input: SetGlobalGameCenterVideoInput,
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGlobalGameCenterVideoDto> {
    this.requireAllowedEmbedHost(input.embedUrl);
    const video = await this.globalMediaRepository.upsert(input, toActor(principal, requestId));
    return toAdminGlobalGameCenterVideoDto(video);
  }

  async removeGlobalVideo(
    principal: AdministrativePrincipal,
    requestId: string | null,
  ): Promise<AdminGlobalGameCenterVideoDto | null> {
    const removed = await this.globalMediaRepository.remove(toActor(principal, requestId));
    return removed === null ? null : toAdminGlobalGameCenterVideoDto(removed);
  }

  private requireAllowedEmbedHost(embedUrl: string): void {
    if (this.embedAllowedHosts === null) return;
    if (isAllowedEmbedHost(embedUrl, this.embedAllowedHosts)) return;
    throw new AppError({
      code: 'GAME_CURATED_VIDEO_HOST_NOT_ALLOWED',
      message: 'The embed URL host is not on the configured allowlist.',
      statusCode: 422,
    });
  }

  /** Every existing video for this game must appear exactly once in
   * `videoIds` -- no fewer, no more, no unrecognized IDs. */
  private requireExactVideoSet(
    existing: readonly GameCuratedVideoRecord[],
    videoIds: readonly string[],
  ): void {
    const providedIds = new Set(videoIds);
    const existingIds = new Set(existing.map((video) => video.id));
    const isExactMatch =
      videoIds.length === existing.length &&
      providedIds.size === videoIds.length &&
      [...existingIds].every((id) => providedIds.has(id));
    if (isExactMatch) return;
    throw new AppError({
      code: 'GAME_CURATED_VIDEO_REORDER_MISMATCH',
      message: 'videoIds must include exactly this game’s current curated videos, each once.',
      statusCode: 422,
    });
  }

  private async requireGame(gameId: string): Promise<GameWithTeams> {
    const game = await this.repository.findGame(gameId);
    if (game === null) {
      throw new AppError({
        code: 'GAME_NOT_FOUND',
        message: 'The requested game was not found.',
        statusCode: 404,
      });
    }
    return game;
  }

  private async requireVideo(videoId: string): Promise<GameCuratedVideoRecord> {
    const video = await this.repository.findVideo(videoId);
    if (video === null) {
      throw new AppError({
        code: 'GAME_CURATED_VIDEO_NOT_FOUND',
        message: 'The requested curated video was not found.',
        statusCode: 404,
      });
    }
    return video;
  }
}

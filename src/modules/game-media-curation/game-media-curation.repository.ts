import { AppError } from '../../common/errors/app-error.js';
import type { AuditActor } from '../../common/audit/audit-actor.js';
import { sanitizeAuditSnapshot } from '../admin/audit-sanitizer.js';
import { publicGameInclude, type GameWithTeams } from '../games/game.dto.js';
import { Prisma, type PrismaClient, type SeasonType } from '../../generated/prisma/client.js';

/** M32: purely operator-driven, so a small fixed cap is enforced server-side
 * regardless of what the frontend sends. See docs/game-center/admin-media-curation.md. */
export const MAX_CURATED_VIDEOS_PER_GAME = 4;

export interface GameCuratedVideoRecord {
  readonly id: string;
  readonly gameId: string;
  readonly position: number;
  readonly title: string;
  readonly embedUrl: string;
  readonly canonicalUrl: string | null;
  readonly thumbnailUrl: string | null;
  readonly sourceLabel: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CuratedVideoWriteInput {
  readonly title: string;
  readonly embedUrl: string;
  readonly canonicalUrl: string | null;
  readonly thumbnailUrl: string | null;
  readonly sourceLabel: string | null;
}

export interface CuratedVideoUpdateInput {
  readonly title?: string | undefined;
  readonly embedUrl?: string | undefined;
  readonly canonicalUrl?: string | null | undefined;
  readonly thumbnailUrl?: string | null | undefined;
  readonly sourceLabel?: string | null | undefined;
}

export interface GameMediaWeekQueryInput {
  readonly season: number;
  readonly seasonType: SeasonType;
  readonly week?: number | undefined;
}

export interface GameMediaBrowseRow {
  readonly game: GameWithTeams;
  readonly curatedVideoCount: number;
  readonly automaticHighlightCount: number;
}

export interface GameMediaCurationRepository {
  findGame(gameId: string): Promise<GameWithTeams | null>;
  listGamesForWeek(query: GameMediaWeekQueryInput): Promise<readonly GameMediaBrowseRow[]>;
  listVideos(gameId: string): Promise<readonly GameCuratedVideoRecord[]>;
  countHighlights(gameId: string): Promise<number>;
  findVideo(videoId: string): Promise<GameCuratedVideoRecord | null>;
  createVideo(
    gameId: string,
    input: CuratedVideoWriteInput,
    actor: AuditActor,
  ): Promise<GameCuratedVideoRecord>;
  updateVideo(
    videoId: string,
    input: CuratedVideoUpdateInput,
    actor: AuditActor,
  ): Promise<GameCuratedVideoRecord>;
  deleteVideo(videoId: string, actor: AuditActor): Promise<GameCuratedVideoRecord>;
  reorderVideos(
    gameId: string,
    orderedVideoIds: readonly string[],
    actor: AuditActor,
  ): Promise<readonly GameCuratedVideoRecord[]>;
}

function duplicateEmbedUrlError(): AppError {
  return new AppError({
    code: 'GAME_CURATED_VIDEO_DUPLICATE_EMBED_URL',
    message: 'This game already has a curated video with that embed URL.',
    statusCode: 409,
  });
}

export class PrismaGameMediaCurationRepository implements GameMediaCurationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findGame(gameId: string): Promise<GameWithTeams | null> {
    return this.prisma.game.findUnique({ where: { id: gameId }, include: publicGameInclude });
  }

  async listGamesForWeek(query: GameMediaWeekQueryInput): Promise<readonly GameMediaBrowseRow[]> {
    const games = await this.prisma.game.findMany({
      where: {
        league: 'NFL',
        season: query.season,
        seasonType: query.seasonType,
        ...(query.week === undefined ? {} : { week: query.week }),
      },
      include: publicGameInclude,
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    });
    if (games.length === 0) return [];

    const gameIds = games.map((game) => game.id);
    const [curatedCounts, highlightCounts] = await Promise.all([
      this.prisma.gameCuratedVideo.groupBy({
        by: ['gameId'],
        where: { gameId: { in: gameIds } },
        _count: { _all: true },
      }),
      this.prisma.gameHighlight.groupBy({
        by: ['gameId'],
        where: { gameId: { in: gameIds } },
        _count: { _all: true },
      }),
    ]);
    const curatedByGame = new Map(curatedCounts.map((row) => [row.gameId, row._count._all]));
    const highlightByGame = new Map(highlightCounts.map((row) => [row.gameId, row._count._all]));

    return games.map((game) => ({
      game,
      curatedVideoCount: curatedByGame.get(game.id) ?? 0,
      automaticHighlightCount: highlightByGame.get(game.id) ?? 0,
    }));
  }

  listVideos(gameId: string): Promise<readonly GameCuratedVideoRecord[]> {
    return this.prisma.gameCuratedVideo.findMany({
      where: { gameId },
      orderBy: { position: 'asc' },
    });
  }

  countHighlights(gameId: string): Promise<number> {
    return this.prisma.gameHighlight.count({ where: { gameId } });
  }

  findVideo(videoId: string): Promise<GameCuratedVideoRecord | null> {
    return this.prisma.gameCuratedVideo.findUnique({ where: { id: videoId } });
  }

  createVideo(
    gameId: string,
    input: CuratedVideoWriteInput,
    actor: AuditActor,
  ): Promise<GameCuratedVideoRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const count = await transaction.gameCuratedVideo.count({ where: { gameId } });
      if (count >= MAX_CURATED_VIDEOS_PER_GAME) {
        throw new AppError({
          code: 'GAME_CURATED_VIDEO_LIMIT_REACHED',
          message: `A game may have at most ${String(MAX_CURATED_VIDEOS_PER_GAME)} curated videos.`,
          statusCode: 409,
        });
      }
      let created: GameCuratedVideoRecord;
      try {
        created = await transaction.gameCuratedVideo.create({
          data: {
            gameId,
            position: count,
            title: input.title,
            embedUrl: input.embedUrl,
            canonicalUrl: input.canonicalUrl,
            thumbnailUrl: input.thumbnailUrl,
            sourceLabel: input.sourceLabel,
            createdById: actor.userId,
            updatedById: actor.userId,
            createdBySnapshot: actor.emailSnapshot,
            updatedBySnapshot: actor.emailSnapshot,
          },
        });
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw duplicateEmbedUrlError();
        }
        throw error;
      }
      await createAudit(
        transaction,
        actor,
        'GAME_CURATED_VIDEO_CREATED',
        'GAME_CURATED_VIDEO',
        created.id,
        null,
        created,
      );
      return created;
    });
  }

  updateVideo(
    videoId: string,
    input: CuratedVideoUpdateInput,
    actor: AuditActor,
  ): Promise<GameCuratedVideoRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.gameCuratedVideo.findUniqueOrThrow({
        where: { id: videoId },
      });
      let after: GameCuratedVideoRecord;
      try {
        after = await transaction.gameCuratedVideo.update({
          where: { id: videoId },
          data: {
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.embedUrl === undefined ? {} : { embedUrl: input.embedUrl }),
            ...(input.canonicalUrl === undefined ? {} : { canonicalUrl: input.canonicalUrl }),
            ...(input.thumbnailUrl === undefined ? {} : { thumbnailUrl: input.thumbnailUrl }),
            ...(input.sourceLabel === undefined ? {} : { sourceLabel: input.sourceLabel }),
            updatedById: actor.userId,
            updatedBySnapshot: actor.emailSnapshot,
          },
        });
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw duplicateEmbedUrlError();
        }
        throw error;
      }
      await createAudit(
        transaction,
        actor,
        'GAME_CURATED_VIDEO_UPDATED',
        'GAME_CURATED_VIDEO',
        videoId,
        before,
        after,
      );
      return after;
    });
  }

  deleteVideo(videoId: string, actor: AuditActor): Promise<GameCuratedVideoRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const deleted = await transaction.gameCuratedVideo.delete({ where: { id: videoId } });
      // Compact remaining positions so they stay contiguous 0..n-1 -- the
      // former #2 (position 2) becomes primary automatically if #1 (position
      // 0) was the one removed, per the "position 0 = primary" invariant.
      const remaining = await transaction.gameCuratedVideo.findMany({
        where: { gameId: deleted.gameId },
        orderBy: { position: 'asc' },
      });
      await reassignPositions(transaction, remaining, actor);
      await createAudit(
        transaction,
        actor,
        'GAME_CURATED_VIDEO_DELETED',
        'GAME_CURATED_VIDEO',
        videoId,
        deleted,
        null,
      );
      return deleted;
    });
  }

  reorderVideos(
    gameId: string,
    orderedVideoIds: readonly string[],
    actor: AuditActor,
  ): Promise<readonly GameCuratedVideoRecord[]> {
    return this.prisma.$transaction(async (transaction) => {
      const before = await transaction.gameCuratedVideo.findMany({
        where: { gameId },
        orderBy: { position: 'asc' },
      });
      const byId = new Map(before.map((video) => [video.id, video]));
      const ordered = orderedVideoIds.map((id) => {
        const video = byId.get(id);
        if (video === undefined) {
          throw new AppError({
            code: 'GAME_CURATED_VIDEO_REORDER_MISMATCH',
            message: 'videoIds must include exactly this game’s current curated videos, each once.',
            statusCode: 422,
          });
        }
        return video;
      });
      const after = await reassignPositions(transaction, ordered, actor);
      await createAudit(
        transaction,
        actor,
        'GAME_CURATED_VIDEO_REORDERED',
        'GAME',
        gameId,
        before,
        after,
      );
      return after;
    });
  }
}

/**
 * Reassigns `position` to match array order (index 0 = primary), contiguous
 * 0..n-1. Goes through a temporary negative-position pass first because the
 * `(gameId, position)` unique constraint is checked per-statement (not
 * deferred) -- writing final positions directly can collide with another
 * row's still-current position mid-transaction (e.g. swapping 0 and 1).
 * Negative placeholders can never collide with the existing (always >= 0) or
 * final (always >= 0) position sets.
 */
async function reassignPositions(
  transaction: Prisma.TransactionClient,
  orderedVideos: readonly GameCuratedVideoRecord[],
  actor: AuditActor,
): Promise<readonly GameCuratedVideoRecord[]> {
  // Sequential, not Promise.all: an interactive transaction runs on a single
  // connection, so queries against it must be awaited one at a time.
  for (const [index, video] of orderedVideos.entries()) {
    await transaction.gameCuratedVideo.update({
      where: { id: video.id },
      data: { position: -(index + 1) },
    });
  }
  const results: GameCuratedVideoRecord[] = [];
  for (const [index, video] of orderedVideos.entries()) {
    results.push(
      await transaction.gameCuratedVideo.update({
        where: { id: video.id },
        data: {
          position: index,
          updatedById: actor.userId,
          updatedBySnapshot: actor.emailSnapshot,
        },
      }),
    );
  }
  return results;
}

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

import type { GameStatus, PrismaClient } from '../../generated/prisma/client.js';
import type { DataHealthGameListQuery, DataHealthProbeListQuery } from './data-health.schemas.js';
import {
  dataHealthGameDetailInclude,
  dataHealthGameListInclude,
  type DataHealthGameDetailRow,
  type DataHealthGameListRow,
} from './data-health.dto.js';

const HIGHLIGHTLY_PROVIDER = 'highlightly';

export interface DataHealthGameListPage {
  readonly games: readonly DataHealthGameListRow[];
  readonly activePlayCounts: ReadonlyMap<string, number>;
  readonly nextCursor: string | null;
}

export interface DataHealthProbeRecord {
  readonly id: string;
  readonly checkedAt: Date;
  readonly requestCount: number;
  readonly durationMs: number;
  readonly providerReachable: boolean;
  readonly providerMatchFound: boolean;
  readonly quotaLimit: number | null;
  readonly quotaRemaining: number | null;
  readonly resultDiagnosis: string;
  readonly teamStatsDiagnosis: string;
  readonly playerStatsDiagnosis: string;
  readonly playsDiagnosis: string;
  readonly providerTeamStatRows: number | null;
  readonly dbTeamStatRows: number | null;
  readonly providerPlayerStatRows: number | null;
  readonly normalizedPlayerStatRows: number | null;
  readonly resolvedPlayerCount: number | null;
  readonly unresolvedPlayerCount: number | null;
  readonly dbPlayerStatRows: number | null;
  readonly providerPlayCount: number | null;
  readonly dbPlayCount: number | null;
  readonly errorCode: string | null;
}

export interface SaveDataHealthProbeInput {
  readonly gameId: string;
  readonly checkedAt: Date;
  readonly requestCount: number;
  readonly durationMs: number;
  readonly providerReachable: boolean;
  readonly providerMatchFound: boolean;
  readonly quotaLimit: number | null;
  readonly quotaRemaining: number | null;
  readonly resultDiagnosis: string;
  readonly teamStatsDiagnosis: string;
  readonly playerStatsDiagnosis: string;
  readonly playsDiagnosis: string;
  readonly providerTeamStatRows: number | null;
  readonly dbTeamStatRows: number | null;
  readonly providerPlayerStatRows: number | null;
  readonly normalizedPlayerStatRows: number | null;
  readonly resolvedPlayerCount: number | null;
  readonly unresolvedPlayerCount: number | null;
  readonly dbPlayerStatRows: number | null;
  readonly providerPlayCount: number | null;
  readonly dbPlayCount: number | null;
  readonly errorCode: string | null;
}

export interface DataHealthRepository {
  listGames(query: DataHealthGameListQuery): Promise<DataHealthGameListPage>;
  getGame(gameId: string): Promise<{
    readonly game: DataHealthGameDetailRow;
    readonly activePlayCount: number;
    readonly supersededPlayCount: number;
  } | null>;
  listProbes(
    gameId: string,
    query: DataHealthProbeListQuery,
  ): Promise<readonly DataHealthProbeRecord[]>;
  saveProbe(input: SaveDataHealthProbeInput): Promise<void>;
  countActivePlays(gameId: string): Promise<number>;
  getProbeGameContext(gameId: string): Promise<ProbeGameContext | null>;
}

export interface ProbeGameContext {
  readonly status: GameStatus;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly hasEditorialFallback: boolean;
  readonly activePlayCount: number;
}

export class PrismaDataHealthRepository implements DataHealthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listGames(query: DataHealthGameListQuery): Promise<DataHealthGameListPage> {
    const games = await this.prisma.game.findMany({
      where: {
        league: 'NFL',
        ...(query.season === undefined ? {} : { season: query.season }),
        ...(query.seasonType === undefined ? {} : { seasonType: query.seasonType }),
        ...(query.week === undefined ? {} : { week: query.week }),
        ...(query.gameStatus === undefined ? {} : { status: query.gameStatus }),
        ...(query.teamId === undefined
          ? {}
          : { OR: [{ homeTeamId: query.teamId }, { awayTeamId: query.teamId }] }),
      },
      include: dataHealthGameListInclude,
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
    });
    const hasMore = games.length > query.limit;
    const page = hasMore ? games.slice(0, query.limit) : games;

    const activePlayCounts = await this.batchActivePlayCounts(page.map((game) => game.id));

    return {
      games: page,
      activePlayCounts,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async getGame(gameId: string): Promise<{
    readonly game: DataHealthGameDetailRow;
    readonly activePlayCount: number;
    readonly supersededPlayCount: number;
  } | null> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: dataHealthGameDetailInclude,
    });
    if (game === null) return null;
    const [activePlayCount, supersededPlayCount] = await Promise.all([
      this.prisma.gamePlay.count({ where: { gameId, supersededAt: null } }),
      this.prisma.gamePlay.count({ where: { gameId, supersededAt: { not: null } } }),
    ]);
    return { game, activePlayCount, supersededPlayCount };
  }

  async listProbes(
    gameId: string,
    query: DataHealthProbeListQuery,
  ): Promise<readonly DataHealthProbeRecord[]> {
    return this.prisma.gameDataHealthProbe.findMany({
      where: { gameId },
      orderBy: { checkedAt: 'desc' },
      take: query.limit,
    });
  }

  async saveProbe(input: SaveDataHealthProbeInput): Promise<void> {
    await this.prisma.gameDataHealthProbe.create({
      data: { ...input, provider: HIGHLIGHTLY_PROVIDER },
    });
  }

  countActivePlays(gameId: string): Promise<number> {
    return this.prisma.gamePlay.count({ where: { gameId, supersededAt: null } });
  }

  async getProbeGameContext(gameId: string): Promise<ProbeGameContext | null> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: {
        status: true,
        homeScore: true,
        awayScore: true,
        editorialOverride: {
          select: { status: true, homeScore: true, awayScore: true },
        },
      },
    });
    if (game === null) return null;
    const activePlayCount = await this.countActivePlays(gameId);
    return {
      status: game.editorialOverride?.status ?? game.status,
      homeScore: game.editorialOverride?.homeScore ?? game.homeScore,
      awayScore: game.editorialOverride?.awayScore ?? game.awayScore,
      hasEditorialFallback:
        game.editorialOverride?.status === 'FINAL' &&
        game.editorialOverride.homeScore !== null &&
        game.editorialOverride.awayScore !== null,
      activePlayCount,
    };
  }

  private async batchActivePlayCounts(gameIds: readonly string[]): Promise<Map<string, number>> {
    if (gameIds.length === 0) return new Map();
    const grouped = await this.prisma.gamePlay.groupBy({
      by: ['gameId'],
      where: { gameId: { in: [...gameIds] }, supersededAt: null },
      _count: { _all: true },
    });
    return new Map(grouped.map((row) => [row.gameId, row._count._all]));
  }
}

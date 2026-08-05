import type { PlayerSeasonStat, Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { PlayerWithTeam, PlayerStatWithContext } from './player.dto.js';

export interface PlayerFilters {
  readonly search?: string | undefined;
  readonly teamId?: string | undefined;
  readonly position?: string | undefined;
  readonly season?: number | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}
export interface PlayerStatFilters {
  readonly season?: number | undefined;
  readonly week?: number | undefined;
  readonly seasonType?: 'PRE' | 'REG' | 'POST' | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}
export interface PlayerPage {
  readonly players: readonly PlayerWithTeam[];
  readonly nextCursor: string | null;
}
export interface PlayerStatPage {
  readonly stats: readonly PlayerStatWithContext[];
  readonly nextCursor: string | null;
}
export interface PlayerRepository {
  findPlayers(filters: PlayerFilters): Promise<PlayerPage>;
  findPlayer(id: string): Promise<PlayerWithTeam | null>;
  findStats(id: string, filters: PlayerStatFilters): Promise<PlayerStatPage>;
  findSeasons(id: string): Promise<readonly PlayerSeasonStat[]>;
}

export class PrismaPlayerRepository implements PlayerRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async findPlayers(filters: PlayerFilters): Promise<PlayerPage> {
    const conditions: Prisma.PlayerWhereInput[] = [
      ...(filters.search === undefined
        ? []
        : [{ normalizedName: { contains: normalizeSearch(filters.search) } }]),
      ...(filters.teamId === undefined
        ? []
        : filters.season === undefined
          ? [
              {
                OR: [
                  { latestTeamId: filters.teamId },
                  { weeklyRosters: { some: { teamId: filters.teamId } } },
                ],
              },
            ]
          : [
              {
                weeklyRosters: {
                  some: { teamId: filters.teamId, season: filters.season },
                },
              },
            ]),
      ...(filters.position === undefined ? [] : [{ position: filters.position }]),
      ...(filters.season === undefined
        ? []
        : [
            {
              OR: [
                { weeklyRosters: { some: { season: filters.season } } },
                { gameStats: { some: { season: filters.season } } },
              ],
            },
          ]),
    ];
    const rows = await this.prisma.player.findMany({
      where: conditions.length === 0 ? {} : { AND: conditions },
      include: { latestTeam: true },
      orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      take: filters.limit + 1,
      ...(filters.cursor === undefined ? {} : { cursor: { id: filters.cursor }, skip: 1 }),
    });
    const hasMore = rows.length > filters.limit;
    const players = hasMore ? rows.slice(0, filters.limit) : rows;
    return { players, nextCursor: hasMore ? (players.at(-1)?.id ?? null) : null };
  }
  findPlayer(id: string): Promise<PlayerWithTeam | null> {
    return this.prisma.player.findUnique({ where: { id }, include: { latestTeam: true } });
  }
  async findStats(id: string, filters: PlayerStatFilters): Promise<PlayerStatPage> {
    const rows = await this.prisma.playerGameStat.findMany({
      where: {
        playerId: id,
        ...(filters.season === undefined ? {} : { season: filters.season }),
        ...(filters.week === undefined ? {} : { week: filters.week }),
        ...(filters.seasonType === undefined ? {} : { seasonType: filters.seasonType }),
      },
      include: { team: true, opponentTeam: true, game: { select: { startTime: true } } },
      orderBy: [{ season: 'desc' }, { week: 'desc' }, { id: 'asc' }],
      take: filters.limit + 1,
      ...(filters.cursor === undefined ? {} : { cursor: { id: filters.cursor }, skip: 1 }),
    });
    const hasMore = rows.length > filters.limit;
    const stats = hasMore ? rows.slice(0, filters.limit) : rows;
    return { stats, nextCursor: hasMore ? (stats.at(-1)?.id ?? null) : null };
  }
  findSeasons(id: string) {
    return this.prisma.playerSeasonStat.findMany({
      where: { playerId: id },
      orderBy: [{ season: 'desc' }, { summaryType: 'asc' }],
    });
  }
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

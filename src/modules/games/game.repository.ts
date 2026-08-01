import type {
  GameStatus,
  Prisma,
  PrismaClient,
  SeasonType,
} from '../../generated/prisma/client.js';
import type { GameWithTeams } from './game.dto.js';

export interface GameListFilters {
  readonly season?: number;
  readonly seasonType?: SeasonType;
  readonly week?: number;
  readonly startTime?: Date;
  readonly endTime?: Date;
  readonly teamId?: string;
  readonly status?: GameStatus;
  readonly limit: number;
  readonly cursor?: string;
}
export interface GamePage {
  readonly games: readonly GameWithTeams[];
  readonly nextCursor: string | null;
}
export interface GameRepository {
  findGames(filters: GameListFilters): Promise<GamePage>;
  findGameById(gameId: string): Promise<GameWithTeams | null>;
  activeTeamExists(teamId: string): Promise<boolean>;
}
const includeTeams = { homeTeam: true, awayTeam: true } as const;
export type GameDataSource = 'mock' | 'api-sports' | 'future-provider' | 'none';
export interface PublicGameSourcePolicy {
  readonly provider: 'mock' | 'api-sports';
  readonly fixtureDataEnabled: boolean;
}

export function resolvePublicGameDataSource(policy: PublicGameSourcePolicy): GameDataSource {
  return policy.provider === 'mock' && !policy.fixtureDataEnabled ? 'none' : policy.provider;
}

export class PrismaGameRepository implements GameRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sourceProvider?: GameDataSource,
  ) {}
  async findGames(filters: GameListFilters): Promise<GamePage> {
    const games = await this.prisma.game.findMany({
      where: {
        league: 'NFL',
        ...toSourceWhere(this.sourceProvider),
        ...(filters.season === undefined ? {} : { season: filters.season }),
        ...(filters.seasonType === undefined ? {} : { seasonType: filters.seasonType }),
        ...(filters.week === undefined ? {} : { week: filters.week }),
        ...(filters.status === undefined ? {} : { status: filters.status }),
        ...(filters.startTime === undefined && filters.endTime === undefined
          ? {}
          : {
              startTime: {
                ...(filters.startTime === undefined ? {} : { gte: filters.startTime }),
                ...(filters.endTime === undefined ? {} : { lte: filters.endTime }),
              },
            }),
        ...(filters.teamId === undefined
          ? {}
          : { OR: [{ homeTeamId: filters.teamId }, { awayTeamId: filters.teamId }] }),
      },
      include: includeTeams,
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      take: filters.limit + 1,
      ...(filters.cursor === undefined ? {} : { cursor: { id: filters.cursor }, skip: 1 }),
    });
    const hasMore = games.length > filters.limit;
    const pageGames = hasMore ? games.slice(0, filters.limit) : games;
    return { games: pageGames, nextCursor: hasMore ? (pageGames.at(-1)?.id ?? null) : null };
  }
  findGameById(gameId: string): Promise<GameWithTeams | null> {
    return this.prisma.game.findFirst({
      where: {
        id: gameId,
        ...toSourceWhere(this.sourceProvider),
      },
      include: includeTeams,
    });
  }
  async activeTeamExists(teamId: string): Promise<boolean> {
    return (
      (await this.prisma.team.count({ where: { id: teamId, league: 'NFL', isActive: true } })) > 0
    );
  }
}

function toSourceWhere(source: GameDataSource | undefined): Prisma.GameWhereInput {
  if (source === undefined) return {};
  if (source === 'none') {
    return { providerMaps: { some: { provider: '__disabled_public_game_source__' } } };
  }
  return { providerMaps: { some: { provider: source } } };
}

import type {
  GameStatus,
  Prisma,
  PrismaClient,
  SeasonType,
} from '../../generated/prisma/client.js';
import { AppError } from '../../common/errors/app-error.js';
import { publicGameInclude, type GameWithTeams } from './game.dto.js';

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
const MAX_RESOLVED_QUERY_CANDIDATES = 1_000;
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
    const candidates = await this.prisma.game.findMany({
      where: {
        league: 'NFL',
        ...(filters.season === undefined ? {} : { season: filters.season }),
        ...(filters.seasonType === undefined ? {} : { seasonType: filters.seasonType }),
        AND: [
          toSourceWhere(this.sourceProvider),
          ...(filters.teamId === undefined
            ? []
            : [{ OR: [{ homeTeamId: filters.teamId }, { awayTeamId: filters.teamId }] }]),
        ],
      },
      include: publicGameInclude,
      orderBy: { id: 'asc' },
      take: MAX_RESOLVED_QUERY_CANDIDATES + 1,
    });
    if (candidates.length > MAX_RESOLVED_QUERY_CANDIDATES) {
      throw new AppError({
        code: 'GAME_QUERY_TOO_BROAD',
        message: 'The game query is too broad. Add season or date filters.',
        statusCode: 400,
      });
    }
    const games = candidates
      .filter((game) => matchesResolvedFilters(game, filters))
      .sort(compareResolvedKickoff);
    const cursorIndex =
      filters.cursor === undefined ? -1 : games.findIndex((game) => game.id === filters.cursor);
    const afterCursor =
      filters.cursor === undefined ? games : cursorIndex < 0 ? [] : games.slice(cursorIndex + 1);
    const hasMore = afterCursor.length > filters.limit;
    const pageGames = hasMore ? afterCursor.slice(0, filters.limit) : afterCursor;
    return { games: pageGames, nextCursor: hasMore ? (pageGames.at(-1)?.id ?? null) : null };
  }
  findGameById(gameId: string): Promise<GameWithTeams | null> {
    return this.prisma.game.findFirst({
      where: {
        id: gameId,
        ...toSourceWhere(this.sourceProvider),
      },
      include: publicGameInclude,
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
  const manuallyMaintained: Prisma.GameWhereInput = {
    provenance: {
      is: { sourceType: { in: ['MANUAL_IMPORT', 'MANUAL_ENTRY', 'OFFICIAL_WEB'] } },
    },
  };
  if (source === 'none') {
    return manuallyMaintained;
  }
  return {
    OR: [{ providerMaps: { some: { provider: source } } }, manuallyMaintained],
  };
}

function matchesResolvedFilters(game: GameWithTeams, filters: GameListFilters): boolean {
  const override = game.editorialOverride;
  const startTime = override?.startTime ?? game.startTime;
  return (
    (filters.week === undefined || (override?.week ?? game.week) === filters.week) &&
    (filters.status === undefined || (override?.status ?? game.status) === filters.status) &&
    (filters.startTime === undefined || startTime >= filters.startTime) &&
    (filters.endTime === undefined || startTime <= filters.endTime)
  );
}

function compareResolvedKickoff(left: GameWithTeams, right: GameWithTeams): number {
  const difference =
    (left.editorialOverride?.startTime ?? left.startTime).getTime() -
    (right.editorialOverride?.startTime ?? right.startTime).getTime();
  return difference === 0 ? left.id.localeCompare(right.id) : difference;
}

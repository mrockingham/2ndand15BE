import type {
  GameStatus,
  Prisma,
  PrismaClient,
  SeasonType,
} from '../../generated/prisma/client.js';
import { publicGameSourceWhere, type GameDataSource } from '../games/game.repository.js';

export const publicCurrentGameTeamStatSelect = {
  teamId: true,
  isHome: true,
  firstDowns: true,
  firstDownsPassing: true,
  firstDownsRushing: true,
  firstDownsPenalty: true,
  totalPlays: true,
  totalYards: true,
  passingCompletions: true,
  passingAttempts: true,
  passingYards: true,
  passingInterceptions: true,
  rushingAttempts: true,
  rushingYards: true,
  turnovers: true,
  fumblesLost: true,
  sacks: true,
  sackYardsLost: true,
  thirdDownConversions: true,
  thirdDownAttempts: true,
  fourthDownConversions: true,
  fourthDownAttempts: true,
  penalties: true,
  penaltyYards: true,
  possessionSeconds: true,
  redZoneConversions: true,
  redZoneAttempts: true,
  totalDrives: true,
  period1Score: true,
  period2Score: true,
  period3Score: true,
  period4Score: true,
  overtime1Score: true,
  overtime2Score: true,
} as const;

export interface PublicCurrentGameTeamStatRow {
  readonly teamId: string;
  readonly isHome: boolean;
  readonly firstDowns: number | null;
  readonly firstDownsPassing: number | null;
  readonly firstDownsRushing: number | null;
  readonly firstDownsPenalty: number | null;
  readonly totalPlays: number | null;
  readonly totalYards: number | null;
  readonly passingCompletions: number | null;
  readonly passingAttempts: number | null;
  readonly passingYards: number | null;
  readonly passingInterceptions: number | null;
  readonly rushingAttempts: number | null;
  readonly rushingYards: number | null;
  readonly turnovers: number | null;
  readonly fumblesLost: number | null;
  readonly sacks: number | null;
  readonly sackYardsLost: number | null;
  readonly thirdDownConversions: number | null;
  readonly thirdDownAttempts: number | null;
  readonly fourthDownConversions: number | null;
  readonly fourthDownAttempts: number | null;
  readonly penalties: number | null;
  readonly penaltyYards: number | null;
  readonly possessionSeconds: number | null;
  readonly redZoneConversions: number | null;
  readonly redZoneAttempts: number | null;
  readonly totalDrives: number | null;
  readonly period1Score: number | null;
  readonly period2Score: number | null;
  readonly period3Score: number | null;
  readonly period4Score: number | null;
  readonly overtime1Score: number | null;
  readonly overtime2Score: number | null;
}

export interface GameStatsRepository {
  findTeamStats(gameId: string): Promise<readonly PublicCurrentGameTeamStatRow[]>;
  findTeamStatsForGames?(
    gameIds: readonly string[],
  ): Promise<readonly PublicCurrentGameTeamStatRowWithGame[]>;
  findCurrentAvailability?(season: number): Promise<readonly CurrentGameStatsAvailabilityRow[]>;
  findPlayerBoxScore?(gameId: string): Promise<PublicCurrentGamePlayerBoxScore>;
}

export interface PublicCurrentGameTeamStatRowWithGame extends PublicCurrentGameTeamStatRow {
  readonly gameId: string;
}

export interface CurrentGameStatsAvailabilityRow {
  readonly seasonType: SeasonType;
  readonly week: number | null;
  readonly status: GameStatus;
  readonly overrideStatus: GameStatus | null;
  readonly overrideWeek: number | null;
  readonly teamStatRows: number;
}

export const publicCurrentGamePlayerStatSelect = {
  teamId: true,
  passingCompletions: true,
  passingAttempts: true,
  passingYards: true,
  passingTouchdowns: true,
  passingInterceptions: true,
  sacksSuffered: true,
  sackYardsLost: true,
  rushingAttempts: true,
  rushingYards: true,
  rushingTouchdowns: true,
  longestRush: true,
  targets: true,
  receptions: true,
  receivingYards: true,
  receivingTouchdowns: true,
  longestReception: true,
  fumbles: true,
  fumbleRecoveries: true,
  tacklesTotal: true,
  tacklesSolo: true,
  defensiveSacks: true,
  tacklesForLoss: true,
  passesDefended: true,
  defensiveTouchdowns: true,
  fieldGoalsMade: true,
  fieldGoalsAttempted: true,
  longestFieldGoal: true,
  extraPointsMade: true,
  extraPointsAttempted: true,
  punts: true,
  puntYards: true,
  puntAverage: true,
  puntsInside20: true,
  puntTouchbacks: true,
  longestPunt: true,
  kickReturns: true,
  kickReturnYards: true,
  kickReturnTouchdowns: true,
  longestKickReturn: true,
  puntReturns: true,
  puntReturnYards: true,
  puntReturnTouchdowns: true,
  longestPuntReturn: true,
  player: {
    select: {
      id: true,
      displayName: true,
      position: true,
      positionGroup: true,
      headshotUrl: true,
    },
  },
} as const satisfies Prisma.CurrentGamePlayerStatSelect;

export type PublicCurrentGamePlayerStatRow = Prisma.CurrentGamePlayerStatGetPayload<{
  select: typeof publicCurrentGamePlayerStatSelect;
}>;

export interface PublicCurrentGamePlayerBoxScore {
  readonly rows: readonly PublicCurrentGamePlayerStatRow[];
  readonly coverage: {
    readonly providerRows: number;
    readonly resolvedRows: number;
    readonly unresolvedRows: number;
  } | null;
}

export class PrismaGameStatsRepository implements GameStatsRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sourceProvider?: GameDataSource,
  ) {}

  findTeamStats(gameId: string): Promise<readonly PublicCurrentGameTeamStatRow[]> {
    return this.prisma.currentGameTeamStat.findMany({
      where: { gameId },
      select: publicCurrentGameTeamStatSelect,
      orderBy: { isHome: 'desc' },
    });
  }

  findTeamStatsForGames(
    gameIds: readonly string[],
  ): Promise<readonly PublicCurrentGameTeamStatRowWithGame[]> {
    if (gameIds.length === 0) return Promise.resolve([]);
    return this.prisma.currentGameTeamStat.findMany({
      where: { gameId: { in: [...gameIds] } },
      select: { gameId: true, ...publicCurrentGameTeamStatSelect },
      orderBy: [{ gameId: 'asc' }, { isHome: 'desc' }],
    });
  }

  async findCurrentAvailability(
    season: number,
  ): Promise<readonly CurrentGameStatsAvailabilityRow[]> {
    const rows = await this.prisma.game.findMany({
      where: {
        league: 'NFL',
        season,
        ...publicGameSourceWhere(this.sourceProvider),
      },
      select: {
        seasonType: true,
        week: true,
        status: true,
        editorialOverride: { select: { status: true, week: true } },
        _count: { select: { currentTeamStats: true } },
      },
    });
    return rows.map((row) => ({
      seasonType: row.seasonType,
      week: row.week,
      status: row.status,
      overrideStatus: row.editorialOverride?.status ?? null,
      overrideWeek: row.editorialOverride?.week ?? null,
      teamStatRows: row._count.currentTeamStats,
    }));
  }

  async findPlayerBoxScore(gameId: string): Promise<PublicCurrentGamePlayerBoxScore> {
    const [rows, coverage] = await Promise.all([
      this.prisma.currentGamePlayerStat.findMany({
        where: { gameId },
        select: publicCurrentGamePlayerStatSelect,
        orderBy: [{ teamId: 'asc' }, { player: { normalizedName: 'asc' } }, { playerId: 'asc' }],
      }),
      this.prisma.currentGamePlayerStatCoverage.findUnique({
        where: { gameId },
        select: { providerRows: true, resolvedRows: true, unresolvedRows: true },
      }),
    ]);
    return { rows, coverage };
  }
}

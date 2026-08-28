import type {
  PublicCurrentGamePlayerStatRow,
  PublicCurrentGameTeamStatRow,
} from './game-stats.repository.js';
import type { GameDto } from '../games/game.dto.js';

export interface GameTeamStatsDto {
  readonly teamId: string;
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
  readonly scoringByPeriod: {
    readonly q1: number | null;
    readonly q2: number | null;
    readonly q3: number | null;
    readonly q4: number | null;
    readonly ot1: number | null;
    readonly ot2: number | null;
  };
}

export interface CurrentGameStatsResponse {
  readonly data: {
    readonly gameId: string;
    readonly teamStats: {
      readonly home: GameTeamStatsDto;
      readonly away: GameTeamStatsDto;
    };
    readonly playerStats: CurrentGamePlayerStatsSides;
    readonly gameLeaders: CurrentGameLeadersSides;
  };
  readonly meta: {
    readonly playerStatsAvailable: boolean;
    readonly playerStatsCoverageState: CurrentGamePlayerStatsCoverage;
    readonly playerStatsCoverage: {
      readonly providerRows: number;
      readonly resolvedRows: number;
      readonly unresolvedRows: number;
    } | null;
    readonly limitations: readonly string[];
  };
}

export type CurrentGamePlayerStatsCoverage = 'COMPLETE' | 'PARTIAL' | 'PENDING' | 'UNAVAILABLE';

export interface CurrentGameLeadersByTeam {
  readonly passer: Record<string, unknown> | null;
  readonly rusher: Record<string, unknown> | null;
  readonly receiver: Record<string, unknown> | null;
}

export interface CurrentGameLeadersSides {
  readonly home: CurrentGameLeadersByTeam;
  readonly away: CurrentGameLeadersByTeam;
}

export type CurrentGameTeamStatsCoverage = 'PENDING' | 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';

export interface CurrentGameStatsListResponse {
  readonly data: {
    readonly season: number;
    readonly seasonType: 'PRE' | 'REG' | 'POST';
    readonly week: number | 'ALL';
    readonly games: readonly {
      readonly game: GameDto;
      readonly coverage: CurrentGameTeamStatsCoverage;
      readonly teamStats: {
        readonly home: GameTeamStatsDto | null;
        readonly away: GameTeamStatsDto | null;
      };
    }[];
  };
  readonly meta: {
    readonly availableSeasons: readonly number[];
    readonly availableSeasonTypes: readonly ('PRE' | 'REG' | 'POST')[];
    readonly availableWeeks: readonly number[];
    readonly coverageNote: string;
  };
}

interface GamePlayerIdentityDto {
  readonly id: string;
  readonly displayName: string;
  readonly position: string | null;
  readonly positionGroup: string | null;
  readonly headshotUrl: string | null;
}

export interface CurrentGamePlayerStatsByCategory {
  readonly passing: readonly Record<string, unknown>[];
  readonly rushing: readonly Record<string, unknown>[];
  readonly receiving: readonly Record<string, unknown>[];
  readonly defense: readonly Record<string, unknown>[];
  readonly kicking: readonly Record<string, unknown>[];
  readonly punting: readonly Record<string, unknown>[];
  readonly returns: readonly Record<string, unknown>[];
}

export interface CurrentGamePlayerStatsSides {
  readonly home: CurrentGamePlayerStatsByCategory;
  readonly away: CurrentGamePlayerStatsByCategory;
}

export function toGameTeamStatsDto(row: PublicCurrentGameTeamStatRow): GameTeamStatsDto {
  return {
    teamId: row.teamId,
    firstDowns: row.firstDowns,
    firstDownsPassing: row.firstDownsPassing,
    firstDownsRushing: row.firstDownsRushing,
    firstDownsPenalty: row.firstDownsPenalty,
    totalPlays: row.totalPlays,
    totalYards: row.totalYards,
    passingCompletions: row.passingCompletions,
    passingAttempts: row.passingAttempts,
    passingYards: row.passingYards,
    passingInterceptions: row.passingInterceptions,
    rushingAttempts: row.rushingAttempts,
    rushingYards: row.rushingYards,
    turnovers: row.turnovers,
    fumblesLost: row.fumblesLost,
    sacks: row.sacks,
    sackYardsLost: row.sackYardsLost,
    thirdDownConversions: row.thirdDownConversions,
    thirdDownAttempts: row.thirdDownAttempts,
    fourthDownConversions: row.fourthDownConversions,
    fourthDownAttempts: row.fourthDownAttempts,
    penalties: row.penalties,
    penaltyYards: row.penaltyYards,
    possessionSeconds: row.possessionSeconds,
    redZoneConversions: row.redZoneConversions,
    redZoneAttempts: row.redZoneAttempts,
    totalDrives: row.totalDrives,
    scoringByPeriod: {
      q1: row.period1Score,
      q2: row.period2Score,
      q3: row.period3Score,
      q4: row.period4Score,
      ot1: row.overtime1Score,
      ot2: row.overtime2Score,
    },
  };
}

export function toCurrentGamePlayerStatsDto(
  rows: readonly PublicCurrentGamePlayerStatRow[],
  homeTeamId: string,
  awayTeamId: string,
): CurrentGamePlayerStatsSides {
  return {
    home: categoryRows(rows.filter((row) => row.teamId === homeTeamId)),
    away: categoryRows(rows.filter((row) => row.teamId === awayTeamId)),
  };
}

export function toCurrentGameLeadersDto(
  playerStats: CurrentGamePlayerStatsSides,
): CurrentGameLeadersSides {
  return {
    home: leadersForTeam(playerStats.home),
    away: leadersForTeam(playerStats.away),
  };
}

function leadersForTeam(stats: CurrentGamePlayerStatsByCategory): CurrentGameLeadersByTeam {
  return {
    passer: selectLeader(stats.passing, ['yards', 'touchdowns', 'attempts']),
    rusher: selectLeader(stats.rushing, ['yards', 'touchdowns', 'attempts']),
    receiver: selectLeader(stats.receiving, ['yards', 'touchdowns', 'receptions']),
  };
}

function selectLeader(
  rows: readonly Record<string, unknown>[],
  fields: readonly string[],
): Record<string, unknown> | null {
  return (
    [...rows].sort((left, right) => {
      for (const field of fields) {
        const rightValue = numericValue(right[field]);
        const leftValue = numericValue(left[field]);
        if (rightValue !== leftValue) return rightValue > leftValue ? 1 : -1;
      }
      const leftId = playerId(left);
      const rightId = playerId(right);
      return leftId.localeCompare(rightId);
    })[0] ?? null
  );
}

function numericValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function playerId(row: Record<string, unknown>): string {
  const player = row.player;
  if (typeof player !== 'object' || player === null || !('id' in player)) return '';
  return typeof player.id === 'string' ? player.id : '';
}

function categoryRows(
  rows: readonly PublicCurrentGamePlayerStatRow[],
): CurrentGamePlayerStatsByCategory {
  return {
    passing: rows.flatMap((row) =>
      hasAny(row, [
        'passingCompletions',
        'passingAttempts',
        'passingYards',
        'passingTouchdowns',
        'passingInterceptions',
        'sacksSuffered',
        'sackYardsLost',
      ])
        ? [
            {
              player: playerDto(row),
              completions: row.passingCompletions,
              attempts: row.passingAttempts,
              yards: row.passingYards,
              touchdowns: row.passingTouchdowns,
              interceptions: row.passingInterceptions,
              sacksSuffered: row.sacksSuffered,
              sackYardsLost: row.sackYardsLost,
            },
          ]
        : [],
    ),
    rushing: rows.flatMap((row) =>
      hasAny(row, ['rushingAttempts', 'rushingYards', 'rushingTouchdowns', 'longestRush'])
        ? [
            {
              player: playerDto(row),
              attempts: row.rushingAttempts,
              yards: row.rushingYards,
              touchdowns: row.rushingTouchdowns,
              longest: row.longestRush,
            },
          ]
        : [],
    ),
    receiving: rows.flatMap((row) =>
      hasAny(row, [
        'targets',
        'receptions',
        'receivingYards',
        'receivingTouchdowns',
        'longestReception',
      ])
        ? [
            {
              player: playerDto(row),
              targets: row.targets,
              receptions: row.receptions,
              yards: row.receivingYards,
              touchdowns: row.receivingTouchdowns,
              longest: row.longestReception,
            },
          ]
        : [],
    ),
    defense: rows.flatMap((row) =>
      hasAny(row, [
        'fumbles',
        'fumbleRecoveries',
        'tacklesTotal',
        'tacklesSolo',
        'defensiveSacks',
        'tacklesForLoss',
        'passesDefended',
        'defensiveTouchdowns',
      ])
        ? [
            {
              player: playerDto(row),
              tacklesTotal: row.tacklesTotal,
              tacklesSolo: row.tacklesSolo,
              sacks: row.defensiveSacks,
              tacklesForLoss: row.tacklesForLoss,
              passesDefended: row.passesDefended,
              fumbles: row.fumbles,
              fumbleRecoveries: row.fumbleRecoveries,
              touchdowns: row.defensiveTouchdowns,
            },
          ]
        : [],
    ),
    kicking: rows.flatMap((row) =>
      hasAny(row, [
        'fieldGoalsMade',
        'fieldGoalsAttempted',
        'longestFieldGoal',
        'extraPointsMade',
        'extraPointsAttempted',
      ])
        ? [
            {
              player: playerDto(row),
              fieldGoalsMade: row.fieldGoalsMade,
              fieldGoalsAttempted: row.fieldGoalsAttempted,
              longestFieldGoal: row.longestFieldGoal,
              extraPointsMade: row.extraPointsMade,
              extraPointsAttempted: row.extraPointsAttempted,
            },
          ]
        : [],
    ),
    punting: rows.flatMap((row) =>
      hasAny(row, [
        'punts',
        'puntYards',
        'puntAverage',
        'puntsInside20',
        'puntTouchbacks',
        'longestPunt',
      ])
        ? [
            {
              player: playerDto(row),
              punts: row.punts,
              yards: row.puntYards,
              average: row.puntAverage,
              inside20: row.puntsInside20,
              touchbacks: row.puntTouchbacks,
              longest: row.longestPunt,
            },
          ]
        : [],
    ),
    returns: rows.flatMap((row) =>
      hasAny(row, [
        'kickReturns',
        'kickReturnYards',
        'kickReturnTouchdowns',
        'longestKickReturn',
        'puntReturns',
        'puntReturnYards',
        'puntReturnTouchdowns',
        'longestPuntReturn',
      ])
        ? [
            {
              player: playerDto(row),
              kickReturns: row.kickReturns,
              kickReturnYards: row.kickReturnYards,
              kickReturnTouchdowns: row.kickReturnTouchdowns,
              longestKickReturn: row.longestKickReturn,
              puntReturns: row.puntReturns,
              puntReturnYards: row.puntReturnYards,
              puntReturnTouchdowns: row.puntReturnTouchdowns,
              longestPuntReturn: row.longestPuntReturn,
            },
          ]
        : [],
    ),
  };
}

function playerDto(row: PublicCurrentGamePlayerStatRow): GamePlayerIdentityDto {
  return row.player;
}

function hasAny(
  row: PublicCurrentGamePlayerStatRow,
  fields: readonly (keyof PublicCurrentGamePlayerStatRow)[],
): boolean {
  return fields.some((field) => row[field] !== null);
}

import type { CurrentGameTeamStatWrite } from './current-game-details.repository.js';

export const CURRENT_GAME_TEAM_STAT_FIELDS = [
  'firstDowns',
  'firstDownsPassing',
  'firstDownsRushing',
  'firstDownsPenalty',
  'totalPlays',
  'totalYards',
  'passingCompletions',
  'passingAttempts',
  'passingYards',
  'passingInterceptions',
  'rushingAttempts',
  'rushingYards',
  'turnovers',
  'fumblesLost',
  'sacks',
  'sackYardsLost',
  'thirdDownConversions',
  'thirdDownAttempts',
  'fourthDownConversions',
  'fourthDownAttempts',
  'penalties',
  'penaltyYards',
  'possessionSeconds',
  'redZoneConversions',
  'redZoneAttempts',
  'totalDrives',
  'period1Score',
  'period2Score',
  'period3Score',
  'period4Score',
  'overtime1Score',
  'overtime2Score',
] as const satisfies readonly (keyof CurrentGameTeamStatWrite)[];

const CORE_FIELDS = [
  'firstDowns',
  'totalPlays',
  'totalYards',
  'passingAttempts',
  'passingYards',
  'rushingAttempts',
  'rushingYards',
  'turnovers',
] as const satisfies readonly (keyof CurrentGameTeamStatWrite)[];

export type CurrentGameTeamStatCompleteness = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';

export interface CurrentGameTeamStatCoverage {
  readonly classification: CurrentGameTeamStatCompleteness;
  readonly rowCount: number;
  readonly orientationValid: boolean;
  readonly fields: Readonly<
    Record<
      (typeof CURRENT_GAME_TEAM_STAT_FIELDS)[number],
      { readonly nonNull: number; readonly total: number }
    >
  >;
}

export interface CurrentGameTeamStatCoverageSummary {
  readonly games: Readonly<Record<CurrentGameTeamStatCompleteness, number>>;
  readonly fields: CurrentGameTeamStatCoverage['fields'];
}

export function classifyCurrentGameTeamStats(input: {
  readonly rows: readonly CurrentGameTeamStatWrite[];
  readonly homeTeamId: string;
  readonly awayTeamId: string;
}): CurrentGameTeamStatCoverage {
  const orientationValid =
    input.rows.length === 2 &&
    input.rows.some((row) => row.isHome && row.teamId === input.homeTeamId) &&
    input.rows.some((row) => !row.isHome && row.teamId === input.awayTeamId);
  const coreComplete = input.rows.every((row) => CORE_FIELDS.every((field) => row[field] !== null));
  const classification =
    input.rows.length === 0
      ? 'UNAVAILABLE'
      : orientationValid && coreComplete
        ? 'COMPLETE'
        : 'PARTIAL';
  return {
    classification,
    rowCount: input.rows.length,
    orientationValid,
    fields: Object.fromEntries(
      CURRENT_GAME_TEAM_STAT_FIELDS.map((field) => [
        field,
        {
          nonNull: input.rows.filter((row) => row[field] !== null).length,
          total: input.rows.length,
        },
      ]),
    ) as CurrentGameTeamStatCoverage['fields'],
  };
}

export function summarizeCurrentGameTeamStatCoverage(
  coverages: readonly CurrentGameTeamStatCoverage[],
): CurrentGameTeamStatCoverageSummary {
  return {
    games: {
      COMPLETE: coverages.filter((coverage) => coverage.classification === 'COMPLETE').length,
      PARTIAL: coverages.filter((coverage) => coverage.classification === 'PARTIAL').length,
      UNAVAILABLE: coverages.filter((coverage) => coverage.classification === 'UNAVAILABLE').length,
    },
    fields: Object.fromEntries(
      CURRENT_GAME_TEAM_STAT_FIELDS.map((field) => [
        field,
        coverages.reduce(
          (total, coverage) => ({
            nonNull: total.nonNull + coverage.fields[field].nonNull,
            total: total.total + coverage.fields[field].total,
          }),
          { nonNull: 0, total: 0 },
        ),
      ]),
    ) as CurrentGameTeamStatCoverage['fields'],
  };
}

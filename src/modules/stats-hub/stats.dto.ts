import { NFLVERSE_PUBLIC_ATTRIBUTION } from '../players/player.dto.js';
import type { StatsMetricDefinition } from './stats-metrics.js';

export { NFLVERSE_PUBLIC_ATTRIBUTION as STATS_PUBLIC_ATTRIBUTION };

export interface StatsPlayerSummary {
  readonly id: string;
  readonly displayName: string;
  readonly position: string | null;
  readonly positionGroup: string | null;
  readonly headshotUrl: string | null;
}

export interface StatsTeamSummary {
  readonly id: string;
  readonly abbreviation: string;
  readonly fullName: string;
}

export interface StatsTeamContext {
  readonly type: 'NONE' | 'SINGLE' | 'MULTI';
  readonly teams: readonly StatsTeamSummary[];
}

export interface RankedStatsRow {
  readonly rowId: string;
  readonly rank: number;
  readonly tied: boolean;
  readonly player: StatsPlayerSummary;
  readonly metricValue: number;
  readonly games: number;
}

export interface SeasonLeaderRow extends RankedStatsRow {
  readonly season: number;
  readonly seasonType: 'REG' | 'POST' | 'REG_POST';
  readonly teamContext: StatsTeamContext;
  readonly qualifyingContext: null;
}

export interface WeeklyLeaderRow extends RankedStatsRow {
  readonly season: number;
  readonly seasonType: 'REG' | 'POST';
  readonly week: number;
  readonly gameId: string;
  readonly gameDate: string | null;
  readonly team: StatsTeamSummary;
  readonly opponent: StatsTeamSummary;
  readonly qualifyingContext: null;
}

export interface RecentPerformanceRow {
  readonly gameId: string;
  readonly season: number;
  readonly seasonType: 'REG' | 'POST';
  readonly week: number;
  readonly gameDate: string | null;
  readonly team: StatsTeamSummary;
  readonly opponent: StatsTeamSummary;
  readonly value: number | null;
}

export function metricResponse(definition: StatsMetricDefinition) {
  return {
    id: definition.id,
    label: definition.label,
    shortLabel: definition.shortLabel,
    description: definition.description,
    category: definition.category,
    valueType: definition.valueType,
    sortDirection: definition.sortDirection,
    higherIsBetter: definition.higherIsBetter,
    decimalPlaces: definition.decimalPlaces,
    nullableBehavior: definition.nullableBehavior,
    qualification: definition.qualification,
  };
}

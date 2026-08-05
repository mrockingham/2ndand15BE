import type { PlayerGameStat, PlayerSeasonStat } from '../../generated/prisma/client.js';

export const STATS_API_VERSION = '1.0';
export const STATS_CATEGORY_ORDER = [
  'PASSING',
  'RUSHING',
  'RECEIVING',
  'DEFENSE',
  'KICKING',
] as const;

export type StatsMetricCategory = (typeof STATS_CATEGORY_ORDER)[number];
export type StatsMetricValueType = 'INTEGER' | 'DECIMAL';
export type StatsMetricContext = 'SEASON' | 'WEEK' | 'RECENT';

type NumericSeasonField = keyof Pick<
  PlayerSeasonStat,
  | 'passingYards'
  | 'passingTouchdowns'
  | 'completions'
  | 'attempts'
  | 'passingInterceptions'
  | 'rushingYards'
  | 'rushingTouchdowns'
  | 'carries'
  | 'receivingYards'
  | 'receivingTouchdowns'
  | 'receptions'
  | 'targets'
  | 'tacklesSolo'
  | 'tackleAssists'
  | 'defensiveSacks'
  | 'defensiveInterceptions'
  | 'forcedFumbles'
  | 'fieldGoalsMade'
  | 'fieldGoalsAttempted'
  | 'extraPointsMade'
>;

type NumericGameField = keyof Pick<PlayerGameStat, NumericSeasonField>;
export type StatsMetricSource = NumericSeasonField | 'totalTackles';

export interface StatsMetricDefinition {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly category: StatsMetricCategory;
  readonly valueType: StatsMetricValueType;
  readonly sortDirection: 'DESC';
  readonly higherIsBetter: true;
  readonly availableForSeasonLeaders: boolean;
  readonly availableForWeekLeaders: boolean;
  readonly availableForRecentPerformance: boolean;
  readonly nullableBehavior: 'EXCLUDE';
  readonly decimalPlaces: number;
  readonly qualification: null;
  readonly source: StatsMetricSource;
  readonly seasonFields: readonly NumericSeasonField[];
  readonly gameFields: readonly NumericGameField[];
}

type MetricSeed = Omit<
  StatsMetricDefinition,
  | 'sortDirection'
  | 'higherIsBetter'
  | 'availableForSeasonLeaders'
  | 'availableForWeekLeaders'
  | 'availableForRecentPerformance'
  | 'nullableBehavior'
  | 'decimalPlaces'
  | 'qualification'
  | 'seasonFields'
  | 'gameFields'
> & {
  readonly source: StatsMetricSource;
  readonly decimalPlaces?: number;
};

function metric(seed: MetricSeed): StatsMetricDefinition {
  const fields =
    seed.source === 'totalTackles'
      ? (['tacklesSolo', 'tackleAssists'] as const)
      : ([seed.source] as readonly NumericSeasonField[]);
  return {
    ...seed,
    sortDirection: 'DESC',
    higherIsBetter: true,
    availableForSeasonLeaders: true,
    availableForWeekLeaders: true,
    availableForRecentPerformance: true,
    nullableBehavior: 'EXCLUDE',
    decimalPlaces: seed.decimalPlaces ?? 0,
    qualification: null,
    seasonFields: fields,
    gameFields: fields,
  };
}

export const STATS_METRICS = [
  metric({
    id: 'passing_yards',
    label: 'Passing Yards',
    shortLabel: 'Pass Yds',
    description: 'Total passing yards recorded.',
    category: 'PASSING',
    valueType: 'INTEGER',
    source: 'passingYards',
  }),
  metric({
    id: 'passing_touchdowns',
    label: 'Passing Touchdowns',
    shortLabel: 'Pass TD',
    description: 'Total passing touchdowns recorded.',
    category: 'PASSING',
    valueType: 'INTEGER',
    source: 'passingTouchdowns',
  }),
  metric({
    id: 'completions',
    label: 'Completions',
    shortLabel: 'Comp',
    description: 'Total completed passes recorded.',
    category: 'PASSING',
    valueType: 'INTEGER',
    source: 'completions',
  }),
  metric({
    id: 'passing_attempts',
    label: 'Passing Attempts',
    shortLabel: 'Pass Att',
    description: 'Total pass attempts recorded.',
    category: 'PASSING',
    valueType: 'INTEGER',
    source: 'attempts',
  }),
  metric({
    id: 'interceptions_thrown',
    label: 'Interceptions Thrown',
    shortLabel: 'INT',
    description: 'Total passing interceptions recorded.',
    category: 'PASSING',
    valueType: 'INTEGER',
    source: 'passingInterceptions',
  }),
  metric({
    id: 'rushing_yards',
    label: 'Rushing Yards',
    shortLabel: 'Rush Yds',
    description: 'Total rushing yards recorded.',
    category: 'RUSHING',
    valueType: 'INTEGER',
    source: 'rushingYards',
  }),
  metric({
    id: 'rushing_touchdowns',
    label: 'Rushing Touchdowns',
    shortLabel: 'Rush TD',
    description: 'Total rushing touchdowns recorded.',
    category: 'RUSHING',
    valueType: 'INTEGER',
    source: 'rushingTouchdowns',
  }),
  metric({
    id: 'rushing_attempts',
    label: 'Rushing Attempts',
    shortLabel: 'Carries',
    description: 'Total rushing attempts recorded.',
    category: 'RUSHING',
    valueType: 'INTEGER',
    source: 'carries',
  }),
  metric({
    id: 'receiving_yards',
    label: 'Receiving Yards',
    shortLabel: 'Rec Yds',
    description: 'Total receiving yards recorded.',
    category: 'RECEIVING',
    valueType: 'INTEGER',
    source: 'receivingYards',
  }),
  metric({
    id: 'receiving_touchdowns',
    label: 'Receiving Touchdowns',
    shortLabel: 'Rec TD',
    description: 'Total receiving touchdowns recorded.',
    category: 'RECEIVING',
    valueType: 'INTEGER',
    source: 'receivingTouchdowns',
  }),
  metric({
    id: 'receptions',
    label: 'Receptions',
    shortLabel: 'Rec',
    description: 'Total receptions recorded.',
    category: 'RECEIVING',
    valueType: 'INTEGER',
    source: 'receptions',
  }),
  metric({
    id: 'targets',
    label: 'Targets',
    shortLabel: 'Tgt',
    description: 'Total receiving targets recorded.',
    category: 'RECEIVING',
    valueType: 'INTEGER',
    source: 'targets',
  }),
  metric({
    id: 'tackles',
    label: 'Total Tackles',
    shortLabel: 'Tkl',
    description: 'Solo tackles plus tackle assists recorded.',
    category: 'DEFENSE',
    valueType: 'INTEGER',
    source: 'totalTackles',
  }),
  metric({
    id: 'solo_tackles',
    label: 'Solo Tackles',
    shortLabel: 'Solo',
    description: 'Total solo tackles recorded.',
    category: 'DEFENSE',
    valueType: 'INTEGER',
    source: 'tacklesSolo',
  }),
  metric({
    id: 'sacks',
    label: 'Sacks',
    shortLabel: 'Sack',
    description: 'Total defensive sacks recorded, including half-sacks.',
    category: 'DEFENSE',
    valueType: 'DECIMAL',
    source: 'defensiveSacks',
    decimalPlaces: 1,
  }),
  metric({
    id: 'defensive_interceptions',
    label: 'Defensive Interceptions',
    shortLabel: 'Def INT',
    description: 'Total defensive interceptions recorded.',
    category: 'DEFENSE',
    valueType: 'INTEGER',
    source: 'defensiveInterceptions',
  }),
  metric({
    id: 'forced_fumbles',
    label: 'Forced Fumbles',
    shortLabel: 'FF',
    description: 'Total forced fumbles recorded.',
    category: 'DEFENSE',
    valueType: 'INTEGER',
    source: 'forcedFumbles',
  }),
  metric({
    id: 'field_goals_made',
    label: 'Field Goals Made',
    shortLabel: 'FGM',
    description: 'Total made field goals recorded.',
    category: 'KICKING',
    valueType: 'INTEGER',
    source: 'fieldGoalsMade',
  }),
  metric({
    id: 'field_goals_attempted',
    label: 'Field Goals Attempted',
    shortLabel: 'FGA',
    description: 'Total field-goal attempts recorded.',
    category: 'KICKING',
    valueType: 'INTEGER',
    source: 'fieldGoalsAttempted',
  }),
  metric({
    id: 'extra_points_made',
    label: 'Extra Points Made',
    shortLabel: 'XPM',
    description: 'Total made extra points recorded.',
    category: 'KICKING',
    valueType: 'INTEGER',
    source: 'extraPointsMade',
  }),
] as const satisfies readonly StatsMetricDefinition[];

const EXPECTED_CATEGORY_BY_SOURCE: Readonly<Record<StatsMetricSource, StatsMetricCategory>> = {
  passingYards: 'PASSING',
  passingTouchdowns: 'PASSING',
  completions: 'PASSING',
  attempts: 'PASSING',
  passingInterceptions: 'PASSING',
  rushingYards: 'RUSHING',
  rushingTouchdowns: 'RUSHING',
  carries: 'RUSHING',
  receivingYards: 'RECEIVING',
  receivingTouchdowns: 'RECEIVING',
  receptions: 'RECEIVING',
  targets: 'RECEIVING',
  totalTackles: 'DEFENSE',
  tacklesSolo: 'DEFENSE',
  tackleAssists: 'DEFENSE',
  defensiveSacks: 'DEFENSE',
  defensiveInterceptions: 'DEFENSE',
  forcedFumbles: 'DEFENSE',
  fieldGoalsMade: 'KICKING',
  fieldGoalsAttempted: 'KICKING',
  extraPointsMade: 'KICKING',
};

const REVIEWED_NUMERIC_FIELDS = new Set<string>([
  'passingYards',
  'passingTouchdowns',
  'completions',
  'attempts',
  'passingInterceptions',
  'rushingYards',
  'rushingTouchdowns',
  'carries',
  'receivingYards',
  'receivingTouchdowns',
  'receptions',
  'targets',
  'tacklesSolo',
  'tackleAssists',
  'defensiveSacks',
  'defensiveInterceptions',
  'forcedFumbles',
  'fieldGoalsMade',
  'fieldGoalsAttempted',
  'extraPointsMade',
]);

export function validateStatsMetrics(definitions: readonly StatsMetricDefinition[]): void {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`Duplicate Stats Hub metric ID: ${definition.id}.`);
    ids.add(definition.id);
    if (EXPECTED_CATEGORY_BY_SOURCE[definition.source] !== definition.category)
      throw new Error(`Metric ${definition.id} has an unsupported category/source combination.`);
    if (
      !definition.availableForSeasonLeaders &&
      !definition.availableForWeekLeaders &&
      !definition.availableForRecentPerformance
    )
      throw new Error(`Metric ${definition.id} is unavailable in every public context.`);
    if (definition.seasonFields.length === 0 || definition.gameFields.length === 0)
      throw new Error(`Metric ${definition.id} does not reference stored numeric fields.`);
    if (
      !definition.seasonFields.every((field) => REVIEWED_NUMERIC_FIELDS.has(field)) ||
      !definition.gameFields.every((field) => REVIEWED_NUMERIC_FIELDS.has(field))
    )
      throw new Error(`Metric ${definition.id} references a nonexistent internal field.`);
  }
}

validateStatsMetrics(STATS_METRICS);

const METRIC_BY_ID = new Map<string, StatsMetricDefinition>(
  STATS_METRICS.map((definition) => [definition.id, definition]),
);

export function findStatsMetric(id: string): StatsMetricDefinition | undefined {
  return METRIC_BY_ID.get(id);
}

export function toPublicMetricDefinition(definition: StatsMetricDefinition) {
  return {
    id: definition.id,
    label: definition.label,
    shortLabel: definition.shortLabel,
    description: definition.description,
    category: definition.category,
    valueType: definition.valueType,
    sortDirection: definition.sortDirection,
    higherIsBetter: definition.higherIsBetter,
    availableForSeasonLeaders: definition.availableForSeasonLeaders,
    availableForWeekLeaders: definition.availableForWeekLeaders,
    availableForRecentPerformance: definition.availableForRecentPerformance,
    nullableBehavior: definition.nullableBehavior,
    decimalPlaces: definition.decimalPlaces,
    qualification: definition.qualification,
  };
}

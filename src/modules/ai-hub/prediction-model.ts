export const BASELINE_MODEL_VERSION = 'baseline-v1';

export interface PredictionGame {
  readonly id: string;
  readonly season: number;
  readonly seasonType: 'PRE' | 'REG' | 'POST';
  readonly week: number | null;
  readonly startTime: Date | null;
  readonly isNeutralSite: boolean;
  readonly homeTeam: {
    readonly id: string;
    readonly fullName: string;
    readonly abbreviation: string;
  };
  readonly awayTeam: {
    readonly id: string;
    readonly fullName: string;
    readonly abbreviation: string;
  };
}

export interface CompletedGame {
  readonly season: number;
  readonly seasonType: 'PRE' | 'REG' | 'POST';
  readonly week: number | null;
  readonly startTime: Date | null;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly isNeutralSite: boolean;
}

export interface TeamSeasonFeatures {
  readonly teamId: string;
  readonly season: number;
  readonly games: number;
  readonly passingYards: number;
  readonly rushingYards: number;
  readonly passingTouchdowns: number;
  readonly rushingTouchdowns: number;
  readonly turnovers: number;
  readonly defensiveSacks: number;
  readonly defensiveInterceptions: number;
  readonly forcedFumbles: number;
}

export interface BaselineInput {
  readonly game: PredictionGame;
  readonly completedGames: readonly CompletedGame[];
  readonly teamFeatures: readonly TeamSeasonFeatures[];
  readonly generatedAt: Date;
  readonly retrospective: boolean;
}

export interface BaselineOutput {
  readonly modelVersion: typeof BASELINE_MODEL_VERSION;
  readonly homeWinProbability: number;
  readonly awayWinProbability: number;
  readonly predictedWinnerTeamId: string;
  readonly projectedHomeScore: number | null;
  readonly projectedAwayScore: number | null;
  readonly confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly factors: readonly {
    readonly code: string;
    readonly favors: 'HOME' | 'AWAY' | 'EVEN';
    readonly label: string;
  }[];
  readonly featureSnapshot: Record<string, unknown>;
  readonly dataAvailability: Record<string, boolean>;
}

const ELO_START = 1500;
const ELO_K_REGULAR = 20;
const ELO_K_PRESEASON = 10;
const HOME_ADVANTAGE = 55;
const SEASON_REGRESSION = 0.25;

export function generateBaselinePrediction(input: BaselineInput): BaselineOutput {
  if (input.game.startTime === null && (!input.retrospective || input.game.week === null))
    throw new Error('A factual kickoff or retrospective week cutoff is required.');
  const games = [...input.completedGames]
    .filter((game) => isBeforeTarget(game, input.game))
    .sort(compareCompletedGames);
  const ratings = calculateElo(games);
  const homeElo = ratings.get(input.game.homeTeam.id) ?? ELO_START;
  const awayElo = ratings.get(input.game.awayTeam.id) ?? ELO_START;
  const homeFeatures = aggregateFeatures(
    input.teamFeatures,
    input.game.homeTeam.id,
    input.game.season,
  );
  const awayFeatures = aggregateFeatures(
    input.teamFeatures,
    input.game.awayTeam.id,
    input.game.season,
  );
  const featureEdge = featureRating(homeFeatures) - featureRating(awayFeatures);
  const venueEdge = input.game.isNeutralSite ? 0 : HOME_ADVANTAGE;
  const ratingEdge = homeElo - awayElo + venueEdge + featureEdge * 28;
  const rawHome = 1 / (1 + 10 ** (-ratingEdge / 400));
  const homeWinProbability = roundProbability(Math.min(0.8, Math.max(0.2, rawHome)));
  const awayWinProbability = roundProbability(1 - homeWinProbability);
  const scores = projectScores(games, input.game, homeWinProbability);
  const sample = homeFeatures.games + awayFeatures.games;
  const confidence =
    input.game.seasonType === 'PRE' || sample < 16
      ? 'LOW'
      : Math.abs(homeWinProbability - 0.5) >= 0.18 && sample >= 32
        ? 'HIGH'
        : 'MEDIUM';
  return {
    modelVersion: BASELINE_MODEL_VERSION,
    homeWinProbability,
    awayWinProbability,
    predictedWinnerTeamId:
      homeWinProbability >= awayWinProbability ? input.game.homeTeam.id : input.game.awayTeam.id,
    projectedHomeScore: scores?.home ?? null,
    projectedAwayScore: scores?.away ?? null,
    confidence,
    factors: buildFactors(homeElo - awayElo, featureEdge, input.game.isNeutralSite),
    featureSnapshot: {
      cutoff:
        input.game.startTime?.toISOString() ??
        `${String(input.game.season)}-${input.game.seasonType}-week-${String(input.game.week)}`,
      constants: {
        eloStart: ELO_START,
        eloKRegular: ELO_K_REGULAR,
        eloKPreseason: ELO_K_PRESEASON,
        homeAdvantage: HOME_ADVANTAGE,
        seasonRegression: SEASON_REGRESSION,
      },
      home: { elo: round(homeElo, 2), ...homeFeatures },
      away: { elo: round(awayElo, 2), ...awayFeatures },
      ratingEdge: round(ratingEdge, 3),
    },
    dataAvailability: {
      historicalScores: games.length > 0,
      historicalPlayerStats: input.teamFeatures.length > 0,
      currentSeasonResults: input.teamFeatures.some((row) => row.season === input.game.season),
      injuries: false,
      rosterAvailability: false,
      weather: false,
      bettingMarkets: false,
    },
  };
}

function isBeforeTarget(game: CompletedGame, target: PredictionGame): boolean {
  if (game.season !== target.season) return game.season < target.season;
  const typeDifference = seasonTypeOrder(game.seasonType) - seasonTypeOrder(target.seasonType);
  if (typeDifference !== 0) return typeDifference < 0;
  if (game.startTime !== null && target.startTime !== null)
    return game.startTime < target.startTime;
  if (game.week === null || target.week === null) return false;
  return game.week < target.week;
}

function compareCompletedGames(left: CompletedGame, right: CompletedGame): number {
  return (
    left.season - right.season ||
    seasonTypeOrder(left.seasonType) - seasonTypeOrder(right.seasonType) ||
    (left.week ?? 99) - (right.week ?? 99) ||
    (left.startTime?.getTime() ?? 0) - (right.startTime?.getTime() ?? 0) ||
    left.homeTeamId.localeCompare(right.homeTeamId)
  );
}

function seasonTypeOrder(value: 'PRE' | 'REG' | 'POST'): number {
  return value === 'PRE' ? 0 : value === 'REG' ? 1 : 2;
}

function calculateElo(games: readonly CompletedGame[]): Map<string, number> {
  const ratings = new Map<string, number>();
  let season: number | null = null;
  for (const game of games) {
    if (season !== null && game.season !== season) {
      for (const [teamId, rating] of ratings)
        ratings.set(teamId, ELO_START + (rating - ELO_START) * (1 - SEASON_REGRESSION));
    }
    season = game.season;
    const home = ratings.get(game.homeTeamId) ?? ELO_START;
    const away = ratings.get(game.awayTeamId) ?? ELO_START;
    const expected =
      1 / (1 + 10 ** (-(home - away + (game.isNeutralSite ? 0 : HOME_ADVANTAGE)) / 400));
    const actual =
      game.homeScore === game.awayScore ? 0.5 : game.homeScore > game.awayScore ? 1 : 0;
    const k = game.seasonType === 'PRE' ? ELO_K_PRESEASON : ELO_K_REGULAR;
    ratings.set(game.homeTeamId, home + k * (actual - expected));
    ratings.set(game.awayTeamId, away + k * (expected - actual));
  }
  return ratings;
}

function aggregateFeatures(
  rows: readonly TeamSeasonFeatures[],
  teamId: string,
  targetSeason: number,
): TeamSeasonFeatures {
  const selected = rows.filter(
    (row) => row.teamId === teamId && row.season <= targetSeason && row.season >= targetSeason - 3,
  );
  const weights = selected.map((row) =>
    row.season === targetSeason
      ? 1.2
      : row.season === targetSeason - 1
        ? 1
        : row.season === targetSeason - 2
          ? 0.65
          : 0.35,
  );
  const denominator = selected.reduce(
    (sum, row, index) => sum + row.games * (weights[index] ?? 0),
    0,
  );
  const perGame = (
    key: Exclude<keyof TeamSeasonFeatures, 'teamId' | 'season' | 'games'>,
  ): number =>
    denominator === 0
      ? 0
      : selected.reduce((sum, row, index) => sum + row[key] * (weights[index] ?? 0), 0) /
        denominator;
  return {
    teamId,
    season: targetSeason,
    games: selected.reduce((sum, row) => sum + row.games, 0),
    passingYards: perGame('passingYards'),
    rushingYards: perGame('rushingYards'),
    passingTouchdowns: perGame('passingTouchdowns'),
    rushingTouchdowns: perGame('rushingTouchdowns'),
    turnovers: perGame('turnovers'),
    defensiveSacks: perGame('defensiveSacks'),
    defensiveInterceptions: perGame('defensiveInterceptions'),
    forcedFumbles: perGame('forcedFumbles'),
  };
}

function featureRating(value: TeamSeasonFeatures): number {
  return (
    ((value.passingYards - 220) / 55) * 0.25 +
    ((value.rushingYards - 110) / 35) * 0.2 +
    ((1.5 - value.turnovers) / 0.8) * 0.2 +
    ((value.passingTouchdowns - 1.4) / 0.8) * 0.1 +
    ((value.rushingTouchdowns - 0.9) / 0.5) * 0.1 +
    (((value.defensiveSacks - 2.2) / 1.2 +
      (value.defensiveInterceptions - 0.7) / 0.5 +
      (value.forcedFumbles - 0.7) / 0.5) /
      3) *
      0.15
  );
}

function projectScores(
  games: readonly CompletedGame[],
  target: PredictionGame,
  homeProbability: number,
): { home: number; away: number } | null {
  const relevant = games.filter((game) => game.season >= target.season - 2);
  const average = (teamId: string): number | null => {
    const points = relevant.flatMap((game) =>
      game.homeTeamId === teamId
        ? [game.homeScore]
        : game.awayTeamId === teamId
          ? [game.awayScore]
          : [],
    );
    return points.length < 8 ? null : points.reduce((sum, value) => sum + value, 0) / points.length;
  };
  const home = average(target.homeTeam.id),
    away = average(target.awayTeam.id);
  if (home === null || away === null) return null;
  const adjustment = (homeProbability - 0.5) * 10;
  let projectedHome = Math.round(Math.min(45, Math.max(10, home + adjustment)));
  let projectedAway = Math.round(Math.min(45, Math.max(10, away - adjustment)));
  if (homeProbability > 0.5 && projectedHome <= projectedAway) projectedHome = projectedAway + 1;
  if (homeProbability < 0.5 && projectedAway <= projectedHome) projectedAway = projectedHome + 1;
  return { home: Math.min(45, projectedHome), away: Math.min(45, projectedAway) };
}

function buildFactors(
  eloEdge: number,
  featureEdge: number,
  neutral: boolean,
): BaselineOutput['factors'] {
  const favors = (value: number): 'HOME' | 'AWAY' | 'EVEN' =>
    value > 0.08 ? 'HOME' : value < -0.08 ? 'AWAY' : 'EVEN';
  return [
    { code: 'TEAM_STRENGTH', favors: favors(eloEdge / 100), label: 'Recent team strength' },
    {
      code: 'OFFENSE_AND_TAKEAWAYS',
      favors: favors(featureEdge),
      label: 'Passing, rushing, ball security, and defensive disruption',
    },
    {
      code: neutral ? 'NEUTRAL_SITE' : 'HOME_FIELD',
      favors: neutral ? 'EVEN' : 'HOME',
      label: neutral ? 'Neutral-site setting' : 'Home-field context',
    },
  ];
}

function roundProbability(value: number): number {
  return Math.round(value * 1000) / 1000;
}
function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

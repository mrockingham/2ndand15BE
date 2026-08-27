import { z } from 'zod';

export interface WeeklyInsightTeam {
  readonly id: string;
  readonly fullName: string;
  readonly abbreviation: string;
}
const featureTeamSchema = z.object({
  teamId: z.string(),
  games: z.number().nonnegative(),
  passingYards: z.number(),
  rushingYards: z.number(),
  passingTouchdowns: z.number(),
  rushingTouchdowns: z.number(),
  turnovers: z.number(),
  defensiveSacks: z.number(),
  defensiveInterceptions: z.number(),
  forcedFumbles: z.number(),
});
const featureSnapshotSchema = z.object({ home: featureTeamSchema, away: featureTeamSchema });
const factorsSchema = z.array(
  z.object({
    code: z.string(),
    favors: z.enum(['HOME', 'AWAY', 'EVEN']),
    label: z.string(),
  }),
);

export interface WeeklyInsightPrediction {
  readonly id: string;
  readonly gameId: string;
  readonly modelVersion: string;
  readonly revision: number;
  readonly status: 'PUBLISHED' | 'LOCKED' | 'EVALUATED';
  readonly homeWinProbability: number;
  readonly awayWinProbability: number;
  readonly projectedHomeScore: number | null;
  readonly projectedAwayScore: number | null;
  readonly confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly factors: unknown;
  readonly featureSnapshot: unknown;
  readonly dataAvailability: unknown;
  readonly predictedWinnerTeamId: string | null;
  readonly generatedAt: Date;
  readonly game: {
    readonly id: string;
    readonly season: number;
    readonly seasonType: 'PRE' | 'REG' | 'POST';
    readonly week: number | null;
    readonly startTime: Date | null;
    readonly homeTeam: WeeklyInsightTeam;
    readonly awayTeam: WeeklyInsightTeam;
  };
}

export interface EvaluatedPrediction {
  readonly modelVersion: string;
  readonly wasCorrect: boolean | null;
  readonly isTie: boolean | null;
  readonly brierScore: number | null;
  readonly game: { readonly week: number | null };
}

export interface WeeklyInsightsInput {
  readonly season: number;
  readonly seasonType: 'PRE' | 'REG' | 'POST';
  readonly week: number;
  readonly top: number;
  readonly teamId?: string | undefined;
  readonly predictions: readonly WeeklyInsightPrediction[];
  readonly evaluatedPredictions: readonly EvaluatedPrediction[];
}

type Team = WeeklyInsightTeam;

export interface InsightCard {
  readonly rank: number;
  readonly game: {
    readonly id: string;
    readonly startTime: string | null;
    readonly homeTeam: Team;
    readonly awayTeam: Team;
  };
  readonly favorite: Team;
  readonly underdog: Team;
  readonly favoriteProbability: number;
  readonly underdogProbability: number;
  readonly probabilityGap: number;
  readonly projectedScore: { readonly home: number; readonly away: number } | null;
  readonly projectedMargin: number | null;
  readonly projectedTotal: number | null;
  readonly confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly factors: readonly {
    readonly code: string;
    readonly favors: 'HOME' | 'AWAY' | 'EVEN';
    readonly label: string;
  }[];
}

export function deriveWeeklyInsights(input: WeeklyInsightsInput) {
  const ordered = [...input.predictions].sort(compareSnapshotOrder);
  const cards = ordered
    .map(toCard)
    .sort(compareStrongest)
    .map((card, index) => ({ ...card, rank: index + 1 }));
  const closest = [...cards].sort(compareClosest);
  const totals = cards.filter(hasProjectedScores);
  const blowouts = [...totals]
    .map((card) => ({ ...card, blowoutScore: blowoutScore(card) }))
    .sort((left, right) => right.blowoutScore - left.blowoutScore || compareStrongest(left, right));
  const highestTotals = [...totals].sort(
    (left, right) => right.projectedTotal - left.projectedTotal || compareStrongest(left, right),
  );
  const lowestTotals = [...totals].sort(
    (left, right) => left.projectedTotal - right.projectedTotal || compareClosest(left, right),
  );
  const upsetWatch = deriveUpsetWatch(cards);
  const featureRows = ordered.flatMap(parseFeatureRow);
  const offensiveEdge = deriveFeatureEdge(featureRows, 'OFFENSE');
  const defensiveEdge = deriveFeatureEdge(featureRows, 'DEFENSE');
  const turnoverEdge = deriveFeatureEdge(featureRows, 'TURNOVER');
  const teamPrediction =
    input.teamId === undefined ? null : deriveTeamPrediction(cards, input.teamId);
  const performance = derivePerformance(
    input.evaluatedPredictions,
    input.season,
    input.seasonType,
    input.week,
    ordered[0]?.modelVersion ?? 'baseline-v1',
  );
  return {
    context: {
      season: input.season,
      seasonType: input.seasonType,
      week: input.week,
      modelVersion: ordered[0]?.modelVersion ?? 'baseline-v1',
      predictionCount: cards.length,
    },
    strongestPick: cards[0] ?? null,
    strongestPicks: cards.slice(0, input.top),
    closestMatchup: closest[0] ?? null,
    closestMatchups: closest.slice(0, input.top),
    upsetWatch,
    mostLikelyBlowout: blowouts[0] ?? null,
    blowoutWatch: blowouts.slice(0, Math.min(input.top, 3)),
    projectedHighestScoringGame: highestTotals[0] ?? null,
    projectedHighestScoringGames: highestTotals.slice(0, input.top),
    projectedLowestScoringGame: lowestTotals[0] ?? null,
    projectedLowestScoringGames: lowestTotals.slice(0, input.top),
    offensiveEdge,
    defensiveEdge,
    turnoverProfileEdge: turnoverEdge,
    confidenceRanking: cards.slice(0, input.top),
    favoriteTeamPrediction: teamPrediction,
    modelPerformance: performance,
  };
}

function toCard(row: WeeklyInsightPrediction): Omit<InsightCard, 'rank'> {
  const homeIsFavorite = row.homeWinProbability >= row.awayWinProbability;
  const projectedScore =
    row.projectedHomeScore === null || row.projectedAwayScore === null
      ? null
      : { home: row.projectedHomeScore, away: row.projectedAwayScore };
  const factors = factorsSchema.safeParse(row.factors);
  return {
    game: {
      id: row.game.id,
      startTime: row.game.startTime?.toISOString() ?? null,
      homeTeam: row.game.homeTeam,
      awayTeam: row.game.awayTeam,
    },
    favorite: homeIsFavorite ? row.game.homeTeam : row.game.awayTeam,
    underdog: homeIsFavorite ? row.game.awayTeam : row.game.homeTeam,
    favoriteProbability: round(homeIsFavorite ? row.homeWinProbability : row.awayWinProbability),
    underdogProbability: round(homeIsFavorite ? row.awayWinProbability : row.homeWinProbability),
    probabilityGap: round(Math.abs(row.homeWinProbability - row.awayWinProbability)),
    projectedScore,
    projectedMargin:
      projectedScore === null ? null : Math.abs(projectedScore.home - projectedScore.away),
    projectedTotal: projectedScore === null ? null : projectedScore.home + projectedScore.away,
    confidence: row.confidence,
    factors: factors.success ? factors.data : [],
  };
}

function compareSnapshotOrder(
  left: WeeklyInsightPrediction,
  right: WeeklyInsightPrediction,
): number {
  return (
    (left.game.startTime?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (right.game.startTime?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
    left.game.id.localeCompare(right.game.id)
  );
}

function compareStrongest(
  left: Omit<InsightCard, 'rank'>,
  right: Omit<InsightCard, 'rank'>,
): number {
  return (
    right.favoriteProbability - left.favoriteProbability ||
    (left.game.startTime === null ? Number.MAX_SAFE_INTEGER : Date.parse(left.game.startTime)) -
      (right.game.startTime === null
        ? Number.MAX_SAFE_INTEGER
        : Date.parse(right.game.startTime)) ||
    left.game.id.localeCompare(right.game.id)
  );
}

function compareClosest(left: InsightCard, right: InsightCard): number {
  return (
    left.favoriteProbability - right.favoriteProbability ||
    left.rank - right.rank ||
    left.game.id.localeCompare(right.game.id)
  );
}

function hasProjectedScores(card: InsightCard): card is InsightCard & {
  projectedMargin: number;
  projectedTotal: number;
  projectedScore: { home: number; away: number };
} {
  return (
    card.projectedMargin !== null && card.projectedTotal !== null && card.projectedScore !== null
  );
}

function blowoutScore(card: InsightCard & { projectedMargin: number }): number {
  const normalizedProbabilityGap = Math.min(card.probabilityGap / 0.6, 1);
  const normalizedMargin = Math.min(card.projectedMargin / 28, 1);
  return round(normalizedProbabilityGap * 0.6 + normalizedMargin * 0.4);
}

function deriveUpsetWatch(cards: readonly InsightCard[]) {
  const reversals = cards
    .map((card) => {
      const strength = card.factors.find((factor) => factor.code === 'TEAM_STRENGTH');
      if (strength === undefined || strength.favors === 'EVEN') return null;
      const strengthTeam = strength.favors === 'HOME' ? card.game.homeTeam : card.game.awayTeam;
      return strengthTeam.id === card.favorite.id
        ? null
        : {
            ...card,
            opportunityTeam: card.favorite,
            basis: 'HISTORICAL_STRENGTH_REVERSAL' as const,
          };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort(compareStrongest);
  if (reversals[0] !== undefined) return reversals[0];
  const closest = [...cards].sort(compareClosest)[0];
  return closest === undefined
    ? null
    : { ...closest, opportunityTeam: closest.underdog, basis: 'MODEL_UNCERTAINTY' as const };
}

interface ParsedFeatureRow {
  readonly prediction: WeeklyInsightPrediction;
  readonly home: z.output<typeof featureTeamSchema>;
  readonly away: z.output<typeof featureTeamSchema>;
  readonly coverage: ReturnType<typeof safeCoverage>;
}

function parseFeatureRow(prediction: WeeklyInsightPrediction): readonly ParsedFeatureRow[] {
  const parsed = featureSnapshotSchema.safeParse(prediction.featureSnapshot);
  return parsed.success
    ? [
        {
          prediction,
          home: parsed.data.home,
          away: parsed.data.away,
          coverage: safeCoverage(prediction.dataAvailability),
        },
      ]
    : [];
}

function deriveFeatureEdge(
  rows: readonly ParsedFeatureRow[],
  family: 'OFFENSE' | 'DEFENSE' | 'TURNOVER',
) {
  const candidates = rows.map((row) => {
    const homeScore = featureFamilyScore(row.home, family);
    const awayScore = featureFamilyScore(row.away, family);
    const homeWins = homeScore >= awayScore;
    const team = homeWins ? row.prediction.game.homeTeam : row.prediction.game.awayTeam;
    const opponent = homeWins ? row.prediction.game.awayTeam : row.prediction.game.homeTeam;
    return {
      gameId: row.prediction.game.id,
      team,
      opponent,
      edgeScore: round(Math.tanh(Math.abs(homeScore - awayScore))),
      supportingFactors: supportingFactors(row.home, row.away, homeWins, family),
      dataCoverage: row.coverage,
    };
  });
  return (
    candidates.sort(
      (left, right) => right.edgeScore - left.edgeScore || left.gameId.localeCompare(right.gameId),
    )[0] ?? null
  );
}

function featureFamilyScore(
  value: z.output<typeof featureTeamSchema>,
  family: 'OFFENSE' | 'DEFENSE' | 'TURNOVER',
): number {
  if (family === 'OFFENSE')
    return (
      (value.passingYards / 220) * 0.35 +
      (value.rushingYards / 110) * 0.25 +
      (value.passingTouchdowns / 1.4) * 0.2 +
      (value.rushingTouchdowns / 0.9) * 0.2
    );
  if (family === 'DEFENSE')
    return (
      (value.defensiveSacks / 2.2) * 0.4 +
      (value.defensiveInterceptions / 0.7) * 0.35 +
      (value.forcedFumbles / 0.7) * 0.25
    );
  return -value.turnovers + value.defensiveInterceptions + value.forcedFumbles;
}

function supportingFactors(
  home: z.output<typeof featureTeamSchema>,
  away: z.output<typeof featureTeamSchema>,
  homeWins: boolean,
  family: 'OFFENSE' | 'DEFENSE' | 'TURNOVER',
): readonly string[] {
  const winner = homeWins ? home : away;
  const loser = homeWins ? away : home;
  const factors =
    family === 'OFFENSE'
      ? [
          ['PASSING_PRODUCTION', winner.passingYards - loser.passingYards],
          ['RUSHING_PRODUCTION', winner.rushingYards - loser.rushingYards],
          [
            'SCORING_PRODUCTION',
            winner.passingTouchdowns +
              winner.rushingTouchdowns -
              loser.passingTouchdowns -
              loser.rushingTouchdowns,
          ],
        ]
      : family === 'DEFENSE'
        ? [
            ['SACK_DISRUPTION', winner.defensiveSacks - loser.defensiveSacks],
            [
              'INTERCEPTION_DISRUPTION',
              winner.defensiveInterceptions - loser.defensiveInterceptions,
            ],
            ['FORCED_FUMBLE_DISRUPTION', winner.forcedFumbles - loser.forcedFumbles],
          ]
        : [
            ['BALL_SECURITY', loser.turnovers - winner.turnovers],
            [
              'TAKEAWAY_PRODUCTION',
              winner.defensiveInterceptions +
                winner.forcedFumbles -
                loser.defensiveInterceptions -
                loser.forcedFumbles,
            ],
          ];
  return factors
    .filter(([, difference]) => typeof difference === 'number' && difference > 0)
    .map(([code]) => String(code));
}

function safeCoverage(value: unknown) {
  const record = typeof value === 'object' && value !== null ? value : {};
  const flag = (key: string): boolean =>
    key in record && record[key as keyof typeof record] === true;
  return {
    historicalScores: flag('historicalScores'),
    historicalPlayerStats: flag('historicalPlayerStats'),
    currentSeasonResults: flag('currentSeasonResults'),
  };
}

function deriveTeamPrediction(cards: readonly InsightCard[], teamId: string) {
  const card = cards.find(
    (candidate) => candidate.game.homeTeam.id === teamId || candidate.game.awayTeam.id === teamId,
  );
  if (card === undefined) return null;
  const teamIsHome = card.game.homeTeam.id === teamId;
  const team = teamIsHome ? card.game.homeTeam : card.game.awayTeam;
  return {
    team,
    opponent: teamIsHome ? card.game.awayTeam : card.game.homeTeam,
    game: card.game,
    teamWinProbability: teamIsHome
      ? card.favorite.id === teamId
        ? card.favoriteProbability
        : card.underdogProbability
      : card.favorite.id === teamId
        ? card.favoriteProbability
        : card.underdogProbability,
    isPredictedWinner: card.favorite.id === teamId,
    projectedScore: card.projectedScore,
    confidence: card.confidence,
    factors: card.factors,
    weeklyRank: card.rank,
  };
}

function derivePerformance(
  rows: readonly EvaluatedPrediction[],
  season: number,
  seasonType: 'PRE' | 'REG' | 'POST',
  targetWeek: number,
  modelVersion: string,
) {
  const seasonRecord = performanceRecord(rows, modelVersion);
  const previousWeekNumber = rows
    .map((row) => row.game.week)
    .filter((week): week is number => week !== null && week < targetWeek)
    .sort((left, right) => right - left)[0];
  return {
    label: '2nd & 15 Model Performance',
    modelVersion,
    season,
    seasonType,
    seasonRecord,
    previousWeek:
      previousWeekNumber === undefined
        ? null
        : {
            week: previousWeekNumber,
            ...performanceRecord(
              rows.filter((row) => row.game.week === previousWeekNumber),
              modelVersion,
            ),
          },
  };
}

function performanceRecord(rows: readonly EvaluatedPrediction[], modelVersion: string) {
  const relevant = rows.filter((row) => row.modelVersion === modelVersion);
  const decided = relevant.filter((row) => row.isTie === false && row.wasCorrect !== null);
  const brier = relevant.flatMap((row) => (row.brierScore === null ? [] : [row.brierScore]));
  const correct = decided.filter((row) => row.wasCorrect).length;
  return {
    gamesEvaluated: relevant.length,
    correct,
    incorrect: decided.length - correct,
    tiesOrExcluded: relevant.length - decided.length,
    accuracy: decided.length === 0 ? null : round(correct / decided.length),
    brierScore:
      brier.length === 0
        ? null
        : round(brier.reduce((sum, value) => sum + value, 0) / brier.length),
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

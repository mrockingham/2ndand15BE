import { describe, expect, it } from 'vitest';
import { deriveWeeklyInsights, type WeeklyInsightPrediction } from './weekly-insights.js';

const teams = {
  ari: {
    id: '00000000-0000-4000-8000-000000000001',
    fullName: 'Arizona Cardinals',
    abbreviation: 'ARI',
  },
  car: {
    id: '00000000-0000-4000-8000-000000000002',
    fullName: 'Carolina Panthers',
    abbreviation: 'CAR',
  },
  chi: {
    id: '00000000-0000-4000-8000-000000000003',
    fullName: 'Chicago Bears',
    abbreviation: 'CHI',
  },
  cle: {
    id: '00000000-0000-4000-8000-000000000004',
    fullName: 'Cleveland Browns',
    abbreviation: 'CLE',
  },
  det: {
    id: '00000000-0000-4000-8000-000000000005',
    fullName: 'Detroit Lions',
    abbreviation: 'DET',
  },
  cin: {
    id: '00000000-0000-4000-8000-000000000006',
    fullName: 'Cincinnati Bengals',
    abbreviation: 'CIN',
  },
} as const;

function prediction(
  id: string,
  home: (typeof teams)[keyof typeof teams],
  away: (typeof teams)[keyof typeof teams],
  homeProbability: number,
  homeScore: number,
  awayScore: number,
  featureOverrides: Partial<Record<'home' | 'away', Record<string, number>>> = {},
): WeeklyInsightPrediction {
  const feature = (teamId: string, overrides: Record<string, number> = {}) => ({
    teamId,
    games: 17,
    passingYards: 220,
    rushingYards: 110,
    passingTouchdowns: 1.4,
    rushingTouchdowns: 0.9,
    turnovers: 1,
    defensiveSacks: 2.2,
    defensiveInterceptions: 0.7,
    forcedFumbles: 0.7,
    ...overrides,
  });
  return {
    id: `prediction-${id}`,
    gameId: id,
    modelVersion: 'baseline-v1',
    revision: 1,
    status: 'PUBLISHED',
    homeWinProbability: homeProbability,
    awayWinProbability: 1 - homeProbability,
    projectedHomeScore: homeScore,
    projectedAwayScore: awayScore,
    confidence: 'LOW',
    factors: [
      {
        code: 'TEAM_STRENGTH',
        favors: id === 'game-2' ? 'AWAY' : 'HOME',
        label: 'Historical team strength',
      },
    ],
    featureSnapshot: {
      home: feature(home.id, featureOverrides.home),
      away: feature(away.id, featureOverrides.away),
    },
    dataAvailability: {
      historicalScores: true,
      historicalPlayerStats: false,
      currentSeasonResults: false,
      privateInternalFlag: true,
    },
    predictedWinnerTeamId: homeProbability >= 0.5 ? home.id : away.id,
    generatedAt: new Date('2026-08-01T00:00:00.000Z'),
    game: {
      id,
      season: 2026,
      seasonType: 'PRE',
      week: 1,
      startTime: new Date(
        id === 'game-1'
          ? '2026-08-11T00:00:00.000Z'
          : id === 'game-2'
            ? '2026-08-12T00:00:00.000Z'
            : '2026-08-13T00:00:00.000Z',
      ),
      homeTeam: home,
      awayTeam: away,
    },
  };
}

const predictions = [
  prediction('game-1', teams.ari, teams.car, 0.79, 30, 17, {
    home: { passingYards: 330, turnovers: 0, defensiveSacks: 4 },
    away: { passingYards: 170, turnovers: 3, defensiveSacks: 1 },
  }),
  prediction('game-2', teams.chi, teams.cle, 0.51, 20, 19),
  prediction('game-3', teams.det, teams.cin, 0.62, 31, 28),
];

describe('deriveWeeklyInsights', () => {
  it('derives deterministic rankings without inflating confidence', () => {
    const input = {
      season: 2026,
      seasonType: 'PRE' as const,
      week: 1,
      top: 2,
      predictions,
      evaluatedPredictions: [],
    };
    const first = deriveWeeklyInsights(input);
    expect(deriveWeeklyInsights(input)).toEqual(first);
    expect(first.strongestPick?.game.id).toBe('game-1');
    expect(first.strongestPick?.confidence).toBe('LOW');
    expect(first.closestMatchup?.game.id).toBe('game-2');
    expect(first.projectedHighestScoringGame?.game.id).toBe('game-3');
    expect(first.projectedLowestScoringGame?.game.id).toBe('game-2');
    expect(first.strongestPicks).toHaveLength(2);
    expect(first.confidenceRanking.map((card) => card.game.id)).toEqual(['game-1', 'game-3']);
  });

  it('uses documented prediction and feature evidence for watch cards', () => {
    const result = deriveWeeklyInsights({
      season: 2026,
      seasonType: 'PRE',
      week: 1,
      top: 5,
      predictions,
      evaluatedPredictions: [],
    });
    expect(result.mostLikelyBlowout?.game.id).toBe('game-1');
    expect(result.mostLikelyBlowout?.blowoutScore).toBe(0.7657);
    expect(result.upsetWatch).toMatchObject({
      game: { id: 'game-2' },
      opportunityTeam: teams.chi,
      basis: 'HISTORICAL_STRENGTH_REVERSAL',
    });
    expect(result.offensiveEdge?.team).toEqual(teams.ari);
    expect(result.offensiveEdge?.supportingFactors).toContain('PASSING_PRODUCTION');
    expect(result.defensiveEdge?.team).toEqual(teams.ari);
    expect(result.defensiveEdge?.supportingFactors).toContain('SACK_DISRUPTION');
    expect(result.turnoverProfileEdge?.team).toEqual(teams.ari);
    expect(result.turnoverProfileEdge?.supportingFactors).toContain('BALL_SECURITY');
    expect(result.turnoverProfileEdge?.dataCoverage).toEqual({
      historicalScores: true,
      historicalPlayerStats: false,
      currentSeasonResults: false,
    });
    expect(JSON.stringify(result)).not.toContain('privateInternalFlag');
  });

  it('returns a favorite-team view and honest zero/per-week performance', () => {
    const result = deriveWeeklyInsights({
      season: 2026,
      seasonType: 'PRE',
      week: 2,
      top: 5,
      teamId: teams.car.id,
      predictions,
      evaluatedPredictions: [
        {
          modelVersion: 'baseline-v1',
          wasCorrect: true,
          isTie: false,
          brierScore: 0.1,
          game: { week: 1 },
        },
        {
          modelVersion: 'baseline-v1',
          wasCorrect: false,
          isTie: false,
          brierScore: 0.3,
          game: { week: 1 },
        },
        { modelVersion: 'other', wasCorrect: true, isTie: false, brierScore: 0, game: { week: 1 } },
      ],
    });
    expect(result.favoriteTeamPrediction).toMatchObject({
      team: teams.car,
      opponent: teams.ari,
      teamWinProbability: 0.21,
      isPredictedWinner: false,
      weeklyRank: 1,
    });
    expect(result.modelPerformance).toMatchObject({
      label: '2nd & 15 Model Performance',
      seasonRecord: { gamesEvaluated: 2, correct: 1, incorrect: 1, accuracy: 0.5, brierScore: 0.2 },
      previousWeek: {
        week: 1,
        gamesEvaluated: 2,
        correct: 1,
        incorrect: 1,
        accuracy: 0.5,
        brierScore: 0.2,
      },
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  generateBaselinePrediction,
  type BaselineInput,
  type CompletedGame,
  type TeamSeasonFeatures,
} from './prediction-model.js';

const home = {
  id: '00000000-0000-4000-8000-000000000001',
  fullName: 'Arizona Cardinals',
  abbreviation: 'ARI',
};
const away = {
  id: '00000000-0000-4000-8000-000000000002',
  fullName: 'Carolina Panthers',
  abbreviation: 'CAR',
};
const history: CompletedGame[] = Array.from({ length: 10 }, (_, index) => ({
  season: 2025,
  seasonType: 'REG',
  week: index + 1,
  startTime: new Date(`2025-${String(index + 1).padStart(2, '0')}-01T00:00:00Z`),
  homeTeamId: index % 2 === 0 ? home.id : away.id,
  awayTeamId: index % 2 === 0 ? away.id : home.id,
  homeScore: index % 2 === 0 ? 27 : 17,
  awayScore: index % 2 === 0 ? 17 : 27,
  isNeutralSite: false,
}));
const features: TeamSeasonFeatures[] = [
  {
    teamId: home.id,
    season: 2025,
    games: 17,
    passingYards: 4200,
    rushingYards: 2100,
    passingTouchdowns: 30,
    rushingTouchdowns: 17,
    turnovers: 15,
    defensiveSacks: 45,
    defensiveInterceptions: 16,
    forcedFumbles: 13,
  },
  {
    teamId: away.id,
    season: 2025,
    games: 17,
    passingYards: 3500,
    rushingYards: 1700,
    passingTouchdowns: 20,
    rushingTouchdowns: 12,
    turnovers: 27,
    defensiveSacks: 30,
    defensiveInterceptions: 8,
    forcedFumbles: 8,
  },
];
const input = (neutral = false): BaselineInput => ({
  game: {
    id: '00000000-0000-4000-8000-000000000003',
    season: 2026,
    seasonType: 'PRE',
    week: null,
    startTime: new Date('2026-08-07T00:00:00Z'),
    isNeutralSite: neutral,
    homeTeam: home,
    awayTeam: away,
  },
  completedGames: history,
  teamFeatures: features,
  generatedAt: new Date('2026-08-01T00:00:00Z'),
  retrospective: false,
});

describe('baseline-v1 prediction model', () => {
  it('is deterministic, bounded, and probabilities sum to one', () => {
    const first = generateBaselinePrediction(input());
    const second = generateBaselinePrediction(input());
    expect(first).toEqual(second);
    expect(first.homeWinProbability + first.awayWinProbability).toBe(1);
    expect(first.homeWinProbability).toBeGreaterThanOrEqual(0.2);
    expect(first.homeWinProbability).toBeLessThanOrEqual(0.8);
    if (first.projectedHomeScore !== null && first.projectedAwayScore !== null)
      expect(
        first.predictedWinnerTeamId === home.id
          ? first.projectedHomeScore
          : first.projectedAwayScore,
      ).toBeGreaterThan(
        first.predictedWinnerTeamId === home.id
          ? first.projectedAwayScore
          : first.projectedHomeScore,
      );
  });
  it('reduces preseason confidence and honors neutral sites', () => {
    const neutral = generateBaselinePrediction(input(true));
    const homeField = generateBaselinePrediction(input(false));
    expect(neutral.confidence).toBe('LOW');
    expect(homeField.homeWinProbability).toBeGreaterThan(neutral.homeWinProbability);
    expect(neutral.factors).toContainEqual(
      expect.objectContaining({ code: 'NEUTRAL_SITE', favors: 'EVEN' }),
    );
  });
  it('cannot use a result at or after the target kickoff', () => {
    const historicalGame = history[0];
    if (historicalGame === undefined) throw new Error('Test history is required.');
    const future = {
      ...historicalGame,
      season: 2026,
      seasonType: 'PRE' as const,
      week: null,
      startTime: new Date('2026-08-08T00:00:00Z'),
      homeScore: 100,
    };
    const baseline = generateBaselinePrediction(input());
    const withFuture = generateBaselinePrediction({
      ...input(),
      completedGames: [...history, future],
    });
    expect(withFuture).toEqual(baseline);
  });
  it('returns null projected scores when history is insufficient', () => {
    const result = generateBaselinePrediction({ ...input(), completedGames: history.slice(0, 2) });
    expect(result.projectedHomeScore).toBeNull();
    expect(result.projectedAwayScore).toBeNull();
  });
  it('uses only earlier weeks when historical kickoffs are null', () => {
    const target = {
      ...input().game,
      season: 2025,
      seasonType: 'REG' as const,
      week: 5,
      startTime: null,
    };
    const nullKickoffs = history.map((game) => ({ ...game, startTime: null }));
    const result = generateBaselinePrediction({
      ...input(),
      game: target,
      completedGames: nullKickoffs,
      retrospective: true,
    });
    const earlierOnly = generateBaselinePrediction({
      ...input(),
      game: target,
      completedGames: nullKickoffs.filter((game) => game.week !== null && game.week < 5),
      retrospective: true,
    });
    expect(result).toEqual(earlierOnly);
  });
});

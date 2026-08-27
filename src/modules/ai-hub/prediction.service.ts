import { AppError } from '../../common/errors/app-error.js';
import type { AuditActor } from '../admin/admin.repository.js';
import {
  generateBaselinePrediction,
  type BaselineOutput,
  type PredictionGame,
} from './prediction-model.js';
import type {
  PrismaPredictionRepository,
  PredictionListFilters,
  PredictionRecord,
} from './prediction.repository.js';
import {
  UnconfiguredPredictionExplainer,
  type PredictionExplainer,
  type PredictionExplanation,
} from './prediction-explainer.js';

export interface GenerationRequest {
  readonly gameId?: string | undefined;
  readonly season?: number | undefined;
  readonly seasonType?: 'PRE' | 'REG' | 'POST' | undefined;
  readonly week?: number | null | undefined;
  readonly dryRun: boolean;
  readonly retrospective: boolean;
  readonly includeAiExplanation: boolean;
}

export class PredictionService {
  constructor(
    private readonly repository: PrismaPredictionRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly explainer: PredictionExplainer = new UnconfiguredPredictionExplainer(),
  ) {}

  async generate(input: GenerationRequest, actor: AuditActor) {
    const games =
      input.gameId === undefined
        ? input.season === undefined || input.seasonType === undefined
          ? []
          : await this.repository.findWeeklyGames(
              input.season,
              input.seasonType,
              input.week ?? null,
            )
        : [await this.repository.findGame(input.gameId)].filter(
            (game): game is NonNullable<typeof game> => game !== null,
          );
    if (games.length === 0)
      throw new AppError({
        code: 'PREDICTION_GAME_NOT_FOUND',
        message: 'No eligible game was found.',
        statusCode: 404,
      });
    const now = this.clock();
    const generated = [];
    for (const game of games) {
      if (game.startTime === null)
        throw new AppError({
          code: 'PREDICTION_KICKOFF_REQUIRED',
          message: 'A factual kickoff is required.',
          statusCode: 409,
        });
      if (game.startTime <= now && !input.retrospective)
        throw new AppError({
          code: 'PREDICTION_GAME_STARTED',
          message: 'Predictions cannot be generated after kickoff.',
          statusCode: 409,
        });
      if (input.retrospective && game.status !== 'FINAL')
        throw new AppError({
          code: 'PREDICTION_RETROSPECTIVE_FINAL_REQUIRED',
          message: 'Retrospective generation requires a final game.',
          statusCode: 409,
        });
      const modelInputs = await this.repository.loadModelInputs(game);
      const output = generateBaselinePrediction({
        game,
        ...modelInputs,
        generatedAt: now,
        retrospective: input.retrospective,
      });
      let explanation: PredictionExplanation | null = null;
      let aiExplanationStatus: 'NOT_REQUESTED' | 'GENERATED' | 'DISCARDED' = 'NOT_REQUESTED';
      if (input.includeAiExplanation) {
        try {
          explanation = await this.explainer.explain(game, output);
          aiExplanationStatus = 'GENERATED';
        } catch {
          explanation = null;
          aiExplanationStatus = 'DISCARDED';
        }
      }
      generated.push(
        input.dryRun
          ? {
              game: publicGame(game),
              prediction: { ...publicOutput(output), explanation },
              persisted: false,
              aiExplanationStatus,
            }
          : {
              game: publicGame(game),
              prediction: toPublic(
                await this.repository.createPrediction(
                  game,
                  output,
                  actor,
                  now,
                  input.retrospective,
                  explanation,
                ),
              ),
              persisted: true,
              aiExplanationStatus,
            },
      );
    }
    return { dryRun: input.dryRun, count: generated.length, predictions: generated };
  }

  async publish(id: string, actor: AuditActor) {
    const prediction = await this.repository.publish(id, actor, this.clock());
    if (prediction === null)
      throw new AppError({
        code: 'PREDICTION_NOT_FOUND',
        message: 'Prediction not found.',
        statusCode: 404,
      });
    if (prediction.isRetrospective)
      throw new AppError({
        code: 'RETROSPECTIVE_PUBLISH_FORBIDDEN',
        message: 'Retrospective predictions cannot be published.',
        statusCode: 409,
      });
    if (prediction.status === 'DRAFT')
      throw new AppError({
        code: 'PREDICTION_PUBLISH_WINDOW_CLOSED',
        message: 'The prediction cannot be published at or after kickoff.',
        statusCode: 409,
      });
    return toPublic(prediction);
  }

  async evaluate(actor: AuditActor) {
    const now = this.clock();
    return {
      locked: await this.repository.lockStarted(now, actor),
      evaluated: await this.repository.evaluate(now, actor),
    };
  }

  async list(filters: PredictionListFilters) {
    return (await this.repository.listPublic(filters)).map(toPublic);
  }
  async detail(gameId: string) {
    const row = await this.repository.findPublicByGame(gameId);
    if (row === null)
      throw new AppError({
        code: 'PREDICTION_NOT_FOUND',
        message: 'Prediction not found.',
        statusCode: 404,
      });
    return toPublic(row);
  }
  async summary(filters: PredictionListFilters) {
    const rows = await this.repository.listPublic({
      ...filters,
      limit: Math.min(filters.limit, 20),
    });
    const predictions = rows.map(toPublic);
    const strongest = [...rows].sort(
      (left, right) =>
        Math.max(right.homeWinProbability, right.awayWinProbability) -
        Math.max(left.homeWinProbability, left.awayWinProbability),
    )[0];
    const closest = [...rows].sort(
      (left, right) =>
        Math.abs(left.homeWinProbability - 0.5) - Math.abs(right.homeWinProbability - 0.5),
    )[0];
    const confidenceRank = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
    const highestConfidence = [...rows].sort(
      (left, right) =>
        confidenceRank[right.confidence] - confidenceRank[left.confidence] ||
        Math.abs(right.homeWinProbability - 0.5) - Math.abs(left.homeWinProbability - 0.5),
    )[0];
    return {
      count: rows.length,
      strongestFavorite: strongest === undefined ? null : toPublic(strongest),
      closestMatchup: closest === undefined ? null : toPublic(closest),
      highestConfidence: highestConfidence === undefined ? null : toPublic(highestConfidence),
      lowConfidenceGames: rows.filter((row) => row.confidence === 'LOW').map(toPublic),
      predictions,
      generatedAt: this.clock().toISOString(),
    };
  }
  async performance() {
    const rows = await this.repository.performance();
    const decided = rows.filter((row) => row.isTie === false && row.wasCorrect !== null);
    const brier = rows.flatMap((row) => (row.brierScore === null ? [] : [row.brierScore]));
    return {
      modelVersion: rows[0]?.modelVersion ?? 'baseline-v1',
      evaluated: rows.length,
      decided: decided.length,
      tiesExcludedFromAccuracy: rows.filter((row) => row.isTie).length,
      correct: decided.filter((row) => row.wasCorrect).length,
      incorrect: decided.filter((row) => !row.wasCorrect).length,
      accuracy:
        decided.length === 0
          ? null
          : round(decided.filter((row) => row.wasCorrect).length / decided.length),
      meanBrierScore:
        brier.length === 0
          ? null
          : round(brier.reduce((sum, value) => sum + value, 0) / brier.length),
    };
  }
  async backtest(season: number, seasonType: 'REG' | 'POST', limit = 300) {
    const games = (await this.repository.findBacktestGames(season, seasonType)).slice(0, limit);
    let correct = 0,
      decided = 0,
      brierTotal = 0,
      extremes = 0,
      homePicks = 0;
    const probabilityBuckets = { close: 0, moderate: 0, strong: 0 };
    const confidence = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    for (const game of games) {
      if (game.homeScore === null || game.awayScore === null)
        throw new Error('Backtest query returned an incomplete final game.');
      const inputs = await this.repository.loadModelInputs(game);
      const prediction = generateBaselinePrediction({
        game,
        ...inputs,
        generatedAt:
          game.startTime ?? new Date(Date.UTC(game.season, 0, Math.max(1, game.week ?? 1))),
        retrospective: true,
      });
      if (prediction.predictedWinnerTeamId === game.homeTeam.id) homePicks++;
      confidence[prediction.confidence]++;
      const edge = Math.abs(prediction.homeWinProbability - 0.5);
      if (edge < 0.08) probabilityBuckets.close++;
      else if (edge < 0.18) probabilityBuckets.moderate++;
      else probabilityBuckets.strong++;
      const homeWon = game.homeScore > game.awayScore,
        tie = game.homeScore === game.awayScore;
      if (!tie) {
        decided++;
        if ((prediction.predictedWinnerTeamId === game.homeTeam.id) === homeWon) correct++;
      }
      const outcome = tie ? 0.5 : homeWon ? 1 : 0;
      brierTotal += (prediction.homeWinProbability - outcome) ** 2;
      if (prediction.homeWinProbability < 0.2 || prediction.homeWinProbability > 0.8) extremes++;
    }
    return {
      modelVersion: 'baseline-v1',
      season,
      seasonType,
      games: games.length,
      decided,
      tiesExcluded: games.length - decided,
      accuracy: decided === 0 ? null : round(correct / decided),
      meanBrierScore: games.length === 0 ? null : round(brierTotal / games.length),
      homePickRate: games.length === 0 ? null : round(homePicks / games.length),
      favoriteProbabilityDistribution: probabilityBuckets,
      confidenceDistribution: confidence,
      sanity: {
        probabilitiesBounded: extremes === 0,
        extremeCount: extremes,
        passed: games.length >= 10 && extremes === 0,
      },
    };
  }
}

function publicOutput(output: BaselineOutput) {
  return {
    modelVersion: output.modelVersion,
    homeWinProbability: output.homeWinProbability,
    awayWinProbability: output.awayWinProbability,
    projectedHomeScore: output.projectedHomeScore,
    projectedAwayScore: output.projectedAwayScore,
    predictedWinnerTeamId: output.predictedWinnerTeamId,
    confidence: output.confidence,
    factors: output.factors,
  };
}
function publicGame(game: PredictionGame) {
  return {
    id: game.id,
    season: game.season,
    seasonType: game.seasonType,
    week: game.week,
    startTime: game.startTime?.toISOString() ?? null,
    isNeutralSite: game.isNeutralSite,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
  };
}
function toPublic(row: PredictionRecord) {
  return {
    id: row.id,
    game: publicGame(row.game),
    modelVersion: row.modelVersion,
    revision: row.revision,
    status: row.status,
    homeWinProbability: row.homeWinProbability,
    awayWinProbability: row.awayWinProbability,
    projectedHomeScore: row.projectedHomeScore,
    projectedAwayScore: row.projectedAwayScore,
    predictedWinner: row.predictedWinnerTeam,
    confidence: row.confidence,
    factors: row.factors,
    explanation:
      row.aiSummary === null
        ? null
        : { summary: row.aiSummary, keyReasons: row.aiKeyReasons, watchFor: row.aiWatchFor },
    dataCoverage: publicDataCoverage(row.dataAvailability),
    generatedAt: row.generatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    lockedAt: row.lockedAt?.toISOString() ?? null,
    evaluation:
      row.evaluatedAt === null
        ? null
        : {
            evaluatedAt: row.evaluatedAt.toISOString(),
            actualHomeScore: row.actualHomeScore,
            actualAwayScore: row.actualAwayScore,
            actualWinner: row.actualWinnerTeam,
            wasCorrect: row.wasCorrect,
            isTie: row.isTie,
            brierScore: row.brierScore,
          },
  };
}
function publicDataCoverage(value: unknown) {
  const data = typeof value === 'object' && value !== null ? value : {};
  const flag = (key: string): boolean => key in data && data[key as keyof typeof data] === true;
  return {
    historicalScores: flag('historicalScores'),
    historicalPlayerStats: flag('historicalPlayerStats'),
    currentSeasonResults: flag('currentSeasonResults'),
    unavailable: ['INJURIES', 'ROSTER_AVAILABILITY', 'WEATHER', 'BETTING_MARKETS'],
  };
}
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

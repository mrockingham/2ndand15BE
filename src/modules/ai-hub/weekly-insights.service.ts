import { AppError } from '../../common/errors/app-error.js';
import type { PrismaPredictionRepository } from './prediction.repository.js';
import { deriveWeeklyInsights } from './weekly-insights.js';

export interface WeeklyInsightsQuery {
  readonly season: number;
  readonly seasonType: 'PRE' | 'REG' | 'POST';
  readonly week: number;
  readonly teamId?: string | undefined;
  readonly top: number;
}

export class AiHubWeeklyInsightsService {
  constructor(private readonly repository: PrismaPredictionRepository) {}

  async getWeeklyInsights(query: WeeklyInsightsQuery) {
    const [predictions, evaluatedPredictions] = await Promise.all([
      this.repository.findWeeklyInsightPredictions(query.season, query.seasonType, query.week),
      this.repository.findWeeklyInsightPerformance(query.season, query.seasonType),
    ]);
    if (predictions.length === 0)
      throw new AppError({
        code: 'WEEKLY_INSIGHTS_NOT_FOUND',
        message: 'No published predictions were found for the selected week.',
        statusCode: 404,
      });
    return deriveWeeklyInsights({ ...query, predictions, evaluatedPredictions });
  }
}

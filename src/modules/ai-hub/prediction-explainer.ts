import { z } from 'zod';
import type { BaselineOutput, PredictionGame } from './prediction-model.js';

const explanationSchema = z.strictObject({
  summary: z.string().trim().min(20).max(600),
  keyReasons: z.array(z.string().trim().min(5).max(220)).min(1).max(4),
  watchFor: z.array(z.string().trim().min(5).max(220)).max(3),
});
const envelopeSchema = z.object({
  model: z.string().optional(),
  output_text: z.string().optional(),
  output: z
    .array(
      z.object({
        content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
      }),
    )
    .optional(),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});
const unsupported =
  /\b(injur(?:y|ed|ies)|weather|wind|rain|snow|bet(?:ting)?|odds|spread|moneyline|depth chart|starter|quarterback|running back|wide receiver|tight end)\b/i;

export interface PredictionExplanation {
  readonly summary: string;
  readonly keyReasons: readonly string[];
  readonly watchFor: readonly string[];
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly durationMs: number;
}
export interface PredictionExplainer {
  explain(game: PredictionGame, prediction: BaselineOutput): Promise<PredictionExplanation>;
}
export class UnconfiguredPredictionExplainer implements PredictionExplainer {
  explain(): Promise<PredictionExplanation> {
    return Promise.reject(new Error('Prediction explanation is not configured.'));
  }
}

export class OpenAiPredictionExplainer implements PredictionExplainer {
  constructor(
    private readonly options: {
      readonly apiKey: string;
      readonly model: string;
      readonly baseUrl: string;
      readonly timeoutMs: number;
      readonly fetcher?: typeof fetch;
    },
  ) {}
  async explain(game: PredictionGame, prediction: BaselineOutput): Promise<PredictionExplanation> {
    const started = performance.now();
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await this.requestExplanation(game, prediction, attempt === 1);
        return { ...result, durationMs: Math.round(performance.now() - started) };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Prediction explanation is invalid.');
  }

  private async requestExplanation(
    game: PredictionGame,
    prediction: BaselineOutput,
    remediation: boolean,
  ): Promise<Omit<PredictionExplanation, 'durationMs'>> {
    const response = await (this.options.fetcher ?? fetch)(
      `${this.options.baseUrl.replace(/\/$/, '')}/responses`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          input: [
            {
              role: 'developer',
              content: [
                'Explain the supplied deterministic NFL prediction. Use only supplied team-level numbers and factors.',
                'Do not mention players, positions, injuries, roster availability, weather, betting, odds, or outside facts. Never change or add a number.',
                ...(remediation
                  ? [
                      'A previous response failed validation. Use only the exact supplied factor labels and team-level outputs.',
                    ]
                  : []),
              ].join(' '),
            },
            {
              role: 'user',
              content: JSON.stringify({
                game: {
                  homeTeam: game.homeTeam.fullName,
                  awayTeam: game.awayTeam.fullName,
                  neutralSite: game.isNeutralSite,
                  seasonType: game.seasonType,
                },
                prediction: {
                  homeWinProbability: prediction.homeWinProbability,
                  awayWinProbability: prediction.awayWinProbability,
                  projectedHomeScore: prediction.projectedHomeScore,
                  projectedAwayScore: prediction.projectedAwayScore,
                  confidence: prediction.confidence,
                  factors: prediction.factors,
                },
              }),
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'prediction_explanation',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['summary', 'keyReasons', 'watchFor'],
                properties: {
                  summary: { type: 'string' },
                  keyReasons: { type: 'array', items: { type: 'string' } },
                  watchFor: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      },
    );
    if (!response.ok) throw new Error('Prediction explanation provider unavailable.');
    const envelope = envelopeSchema.parse(await response.json());
    const text =
      envelope.output_text ??
      envelope.output
        ?.flatMap((item) => item.content ?? [])
        .find((item) => item.type === 'output_text')?.text;
    if (text === undefined) throw new Error('Prediction explanation provider returned no output.');
    const explanation = explanationSchema.parse(JSON.parse(text) as unknown);
    const all = [explanation.summary, ...explanation.keyReasons, ...explanation.watchFor].join(' ');
    if (unsupported.test(all))
      throw new Error('Prediction explanation introduced unsupported claims.');
    return {
      ...explanation,
      provider: 'openai',
      model: envelope.model ?? this.options.model,
      promptVersion: 'prediction-explanation-v1',
      inputTokens: envelope.usage?.input_tokens ?? null,
      outputTokens: envelope.usage?.output_tokens ?? null,
    };
  }
}

import { z } from 'zod';

import { AppError } from '../../common/errors/app-error.js';
import type {
  CandidateClassificationResult,
  CandidateClassifier,
} from './candidate-quality.service.js';

const classificationSchema = z.strictObject({
  relevance: z.enum(['NFL', 'NOT_NFL', 'UNCERTAIN']),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  reasons: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
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

export class OpenAiCandidateClassifier implements CandidateClassifier {
  constructor(
    private readonly options: {
      readonly apiKey: string;
      readonly model: string;
      readonly baseUrl: string;
      readonly timeoutMs: number;
      readonly fetcher?: typeof fetch;
    },
  ) {}

  async classify(
    input: Parameters<CandidateClassifier['classify']>[0],
  ): Promise<CandidateClassificationResult> {
    const started = performance.now();
    let response: Response;
    try {
      response = await (this.options.fetcher ?? fetch)(
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
                content:
                  'Classify NFL relevance using only supplied metadata. NCAA-only eligibility, recruiting, college games, and other sports are NOT_NFL unless a concrete NFL team, player, rookie, scout, draft prospect, or NFL Draft connection is supplied. Return UNCERTAIN when evidence is ambiguous.',
              },
              { role: 'user', content: JSON.stringify(input) },
            ],
            text: {
              format: {
                type: 'json_schema',
                name: 'candidate_nfl_relevance',
                strict: true,
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['relevance', 'confidence', 'reasons'],
                  properties: {
                    relevance: { type: 'string', enum: ['NFL', 'NOT_NFL', 'UNCERTAIN'] },
                    confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
                    reasons: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
                  },
                },
              },
            },
          }),
          signal: AbortSignal.timeout(this.options.timeoutMs),
        },
      );
    } catch {
      throw unavailable();
    }
    if (!response.ok) throw unavailable();
    const envelope = envelopeSchema.safeParse(await response.json());
    if (!envelope.success) throw invalid();
    const text =
      envelope.data.output_text ??
      envelope.data.output
        ?.flatMap((item) => item.content ?? [])
        .find((content) => content.type === 'output_text')?.text;
    if (text === undefined) throw invalid();
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw invalid();
    }
    const parsed = classificationSchema.safeParse(value);
    if (!parsed.success) throw invalid();
    return {
      ...parsed.data,
      provider: 'openai',
      model: envelope.data.model ?? this.options.model,
      inputTokens: envelope.data.usage?.input_tokens ?? null,
      outputTokens: envelope.data.usage?.output_tokens ?? null,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
    };
  }
}

function unavailable(): AppError {
  return new AppError({
    code: 'CANDIDATE_CLASSIFIER_UNAVAILABLE',
    message: 'Candidate classification is temporarily unavailable.',
    statusCode: 503,
  });
}
function invalid(): AppError {
  return new AppError({
    code: 'CANDIDATE_CLASSIFIER_INVALID_RESPONSE',
    message: 'Candidate classification returned an invalid response.',
    statusCode: 502,
  });
}

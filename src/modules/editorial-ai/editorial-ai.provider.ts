import { z } from 'zod';

import { AppError } from '../../common/errors/app-error.js';

const categories = [
  'BREAKING_NEWS',
  'TRAINING_CAMP',
  'PRESEASON',
  'GAME',
  'INJURY',
  'TRANSACTION',
  'CONTRACT',
  'ROSTER',
  'TRADE',
  'PLAYER',
  'TEAM',
  'ANALYSIS',
  'FANTASY',
  'LEAGUE',
  'OFF_FIELD',
] as const;

const riskFlags = [
  'THIN_SOURCE',
  'POSSIBLE_DUPLICATE',
  'SENSITIVE_INJURY',
  'CONTRACT_FIGURES',
  'LEGAL_DISCIPLINARY',
  'TRADE_RUMOR',
  'UNSOURCED_CLAIM',
  'QUOTE_INCLUDED',
  'MEDIA_RIGHTS_UNCLEAR',
  'PLAYER_IDENTITY_UNCERTAIN',
] as const;

export const editorialDraftSchema = z.strictObject({
  headline: z.string().trim().min(1).max(180),
  dek: z.string().trim().min(1).max(1000),
  body: z.string().trim().min(1).max(12_000),
  primaryTeam: z.string().trim().min(2).max(40).nullable(),
  additionalTeams: z.array(z.string().trim().min(2).max(40)).max(8),
  players: z
    .array(
      z.strictObject({
        name: z.string().trim().min(2).max(160),
        team: z.string().trim().min(2).max(40).nullable(),
      }),
    )
    .max(30),
  category: z.enum(categories),
  topicTags: z.array(z.string().trim().min(1).max(48)).max(12),
  sourceAttribution: z.string().trim().min(1).max(300),
  seoTitle: z.string().trim().min(1).max(180),
  seoDescription: z.string().trim().min(1).max(320),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  riskFlags: z.array(z.enum(riskFlags)).max(riskFlags.length),
  mediaSearchTerms: z.array(z.string().trim().min(2).max(160)).min(1).max(8),
});

export type EditorialDraft = z.output<typeof editorialDraftSchema>;

export interface EditorialSourceMaterial {
  readonly candidateId: string;
  readonly headline: string;
  readonly publisher: string;
  readonly canonicalUrl: string;
  readonly description: string | null;
  readonly author: string | null;
  readonly publishedAt: string | null;
  readonly suggestedTeams: readonly string[];
  readonly rights: {
    readonly textUsage: 'SUMMARY_ALLOWED' | 'LINK_ONLY' | 'UNKNOWN';
    readonly quotationPolicy: 'SHORT_QUOTES_ONLY' | 'UNKNOWN';
  };
  readonly contentMode: 'FULL_DRAFT' | 'SHORT_BRIEF';
}

export interface EditorialAiUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly estimatedCostMicros: number | null;
}

export interface EditorialAiResult {
  readonly draft: EditorialDraft;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly usage: EditorialAiUsage;
  readonly durationMs: number;
}

export interface EditorialAiProvider {
  generateDraft(source: EditorialSourceMaterial, instruction?: string): Promise<EditorialAiResult>;
}

export class UnconfiguredEditorialAiProvider implements EditorialAiProvider {
  generateDraft(): Promise<EditorialAiResult> {
    return Promise.reject(
      new AppError({
        code: 'EDITORIAL_AI_NOT_CONFIGURED',
        message: 'Editorial AI generation is not configured.',
        statusCode: 503,
      }),
    );
  }
}

export interface OpenAiEditorialProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly promptVersion?: string;
  readonly fetcher?: typeof fetch;
}

const openAiEnvelopeSchema = z.object({
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

export class OpenAiEditorialAiProvider implements EditorialAiProvider {
  private readonly fetcher: typeof fetch;
  private readonly promptVersion: string;

  constructor(private readonly options: OpenAiEditorialProviderOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.promptVersion = options.promptVersion ?? 'editorial-draft-v1';
  }

  async generateDraft(
    source: EditorialSourceMaterial,
    instruction?: string,
  ): Promise<EditorialAiResult> {
    const started = performance.now();
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.baseUrl.replace(/\/$/, '')}/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          input: [
            { role: 'developer', content: editorialSystemPrompt() },
            { role: 'user', content: JSON.stringify({ source, instruction: instruction ?? null }) },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'editorial_draft',
              strict: true,
              schema: editorialJsonSchema,
            },
          },
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch {
      throw providerError();
    }
    if (!response.ok) throw providerError();
    const envelope = openAiEnvelopeSchema.safeParse(await safeJson(response));
    if (!envelope.success) throw malformedProviderError();
    const text =
      envelope.data.output_text ??
      envelope.data.output
        ?.flatMap((item) => item.content ?? [])
        .find((content) => content.type === 'output_text')?.text;
    if (text === undefined) throw malformedProviderError();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw malformedProviderError();
    }
    const draft = editorialDraftSchema.safeParse(parsed);
    if (!draft.success) throw malformedProviderError();
    return {
      draft: draft.data,
      provider: 'openai',
      model: envelope.data.model ?? this.options.model,
      promptVersion: this.promptVersion,
      usage: {
        inputTokens: envelope.data.usage?.input_tokens ?? null,
        outputTokens: envelope.data.usage?.output_tokens ?? null,
        estimatedCostMicros: null,
      },
      durationMs: Math.round(performance.now() - started),
    };
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw malformedProviderError();
  }
}

function providerError(): AppError {
  return new AppError({
    code: 'EDITORIAL_AI_UNAVAILABLE',
    message: 'Editorial draft generation is temporarily unavailable.',
    statusCode: 503,
  });
}

function malformedProviderError(): AppError {
  return new AppError({
    code: 'EDITORIAL_AI_INVALID_RESPONSE',
    message: 'The editorial AI provider returned an invalid draft.',
    statusCode: 502,
  });
}

function editorialSystemPrompt(): string {
  return [
    'Create an original 2nd & 15 NFL news draft using only the supplied candidate metadata.',
    'Use concise, factual sports-news language. Never imitate a publisher or copy its structure.',
    'Do not reproduce or closely paraphrase source passages. Prefer paraphrase; any quote must be short, exact, attributed, and flagged.',
    'Never fabricate facts, quotes, statistics, injuries, contract values, or conclusions.',
    'Attribute facts to the supplied publisher and distinguish reporting from analysis.',
    'If the source is thin or rights are LINK_ONLY/UNKNOWN, write a short brief, lower confidence, and add THIN_SOURCE or UNSOURCED_CLAIM as appropriate.',
    'When description is null, treat the headline as the complete factual record: do not expand initials or abbreviations and do not add a role, team membership, amount interpretation, mechanism, venue, timing, quotation, reaction, attribution detail, or surrounding circumstance that is not literally present in the supplied metadata.',
    'A thin-source brief may explicitly say that no further verified details were supplied; repetition is safer than filling gaps.',
    'When contentMode is SHORT_BRIEF, write approximately 40-120 words with no filler. When contentMode is FULL_DRAFT, aim for 250-600 words only when the supplied material supports it; never pad to reach a minimum.',
    'Team values must be NFL names or abbreviations. Player entries are suggestions only.',
    'Return only the requested JSON schema.',
  ].join(' ');
}

const editorialJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'headline',
    'dek',
    'body',
    'primaryTeam',
    'additionalTeams',
    'players',
    'category',
    'topicTags',
    'sourceAttribution',
    'seoTitle',
    'seoDescription',
    'confidence',
    'riskFlags',
    'mediaSearchTerms',
  ],
  properties: {
    headline: { type: 'string' },
    dek: { type: 'string' },
    body: { type: 'string' },
    primaryTeam: { type: ['string', 'null'] },
    additionalTeams: { type: 'array', items: { type: 'string' } },
    players: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'team'],
        properties: { name: { type: 'string' }, team: { type: ['string', 'null'] } },
      },
    },
    category: { type: 'string', enum: [...categories] },
    topicTags: { type: 'array', items: { type: 'string' } },
    sourceAttribution: { type: 'string' },
    seoTitle: { type: 'string' },
    seoDescription: { type: 'string' },
    confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    riskFlags: { type: 'array', items: { type: 'string', enum: [...riskFlags] } },
    mediaSearchTerms: { type: 'array', items: { type: 'string' } },
  },
} as const;

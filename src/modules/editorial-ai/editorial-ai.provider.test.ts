import { describe, expect, it, vi } from 'vitest';

import {
  OpenAiEditorialAiProvider,
  UnconfiguredEditorialAiProvider,
  type EditorialSourceMaterial,
} from './editorial-ai.provider.js';

const source: EditorialSourceMaterial = {
  candidateId: '00000000-0000-4000-8000-000000000001',
  headline: 'Cardinals prepare for preseason',
  publisher: 'Example Sports',
  canonicalUrl: 'https://example.com/story',
  description: null,
  author: null,
  publishedAt: null,
  suggestedTeams: ['ARI'],
  rights: { textUsage: 'UNKNOWN', quotationPolicy: 'UNKNOWN' },
};

const validDraft = {
  headline: 'Cardinals prepare for preseason',
  dek: 'Arizona gets ready for exhibition play.',
  body: 'Arizona is preparing for its preseason schedule, according to Example Sports.',
  primaryTeam: 'ARI',
  additionalTeams: [],
  players: [],
  category: 'PRESEASON',
  topicTags: ['preseason'],
  sourceAttribution: 'Example Sports',
  seoTitle: 'Cardinals prepare for preseason',
  seoDescription: 'Arizona prepares for preseason football.',
  confidence: 'LOW',
  riskFlags: ['THIN_SOURCE'],
  mediaSearchTerms: ['Arizona Cardinals preseason 2026'],
};

describe('OpenAiEditorialAiProvider', () => {
  it('uses structured output and parses normalized usage without exposing the key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'configured-model',
          output: [{ content: [{ type: 'output_text', text: JSON.stringify(validDraft) }] }],
          usage: { input_tokens: 12, output_tokens: 34 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const provider = new OpenAiEditorialAiProvider({
      apiKey: 'private-key',
      model: 'configured-model',
      baseUrl: 'https://api.openai.com/v1',
      timeoutMs: 10_000,
      fetcher,
    });
    const result = await provider.generateDraft(source);
    expect(result).toMatchObject({
      provider: 'openai',
      model: 'configured-model',
      usage: { inputTokens: 12, outputTokens: 34 },
    });
    const requestBody = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== 'string') throw new Error('Expected a JSON request body');
    const request = JSON.parse(requestBody) as {
      text: { format: { type: string; strict: boolean } };
      input: readonly { content: string }[];
    };
    expect(request.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(request.input[0]?.content).toContain(
      'When description is null, treat the headline as the complete factual record',
    );
    expect(JSON.stringify(request)).not.toContain('private-key');
  });

  it('fails closed on malformed provider output', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ output_text: '{"headline":true}' }), { status: 200 }),
      );
    const provider = new OpenAiEditorialAiProvider({
      apiKey: 'private-key',
      model: 'configured-model',
      baseUrl: 'https://api.openai.com/v1',
      timeoutMs: 10_000,
      fetcher,
    });
    await expect(provider.generateDraft(source)).rejects.toMatchObject({
      code: 'EDITORIAL_AI_INVALID_RESPONSE',
      statusCode: 502,
    });
  });

  it('sanitizes upstream failures', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('secret provider body', { status: 429 }));
    const provider = new OpenAiEditorialAiProvider({
      apiKey: 'private-key',
      model: 'configured-model',
      baseUrl: 'https://api.openai.com/v1',
      timeoutMs: 10_000,
      fetcher,
    });
    await expect(provider.generateDraft(source)).rejects.toMatchObject({
      code: 'EDITORIAL_AI_UNAVAILABLE',
      message: 'Editorial draft generation is temporarily unavailable.',
    });
  });
});

it('fails gracefully when no editorial AI provider is configured', async () => {
  await expect(new UnconfiguredEditorialAiProvider().generateDraft()).rejects.toMatchObject({
    code: 'EDITORIAL_AI_NOT_CONFIGURED',
    statusCode: 503,
  });
});

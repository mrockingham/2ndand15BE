import { expect, it, vi } from 'vitest';

import { OpenAiCandidateClassifier } from './candidate-quality.provider.js';

it('uses compact structured relevance output and keeps credentials out of the body', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        model: 'configured-model',
        output_text: JSON.stringify({
          relevance: 'UNCERTAIN',
          confidence: 'LOW',
          reasons: ['No league context.'],
        }),
        usage: { input_tokens: 20, output_tokens: 10 },
      }),
      { status: 200 },
    ),
  );
  const classifier = new OpenAiCandidateClassifier({
    apiKey: 'private-key',
    model: 'configured-model',
    baseUrl: 'https://api.openai.com/v1',
    timeoutMs: 10_000,
    fetcher,
  });
  const result = await classifier.classify({
    headline: 'Veteran returns',
    canonicalUrl: 'https://example.com/story',
    publisher: 'Example',
    description: null,
    suggestedTeams: [],
  });
  expect(result).toMatchObject({
    relevance: 'UNCERTAIN',
    inputTokens: 20,
    outputTokens: 10,
  });
  const body = fetcher.mock.calls[0]?.[1]?.body;
  expect(typeof body === 'string' ? body : '').not.toContain('private-key');
});

it('fails closed on upstream classifier errors', async () => {
  const classifier = new OpenAiCandidateClassifier({
    apiKey: 'private-key',
    model: 'configured-model',
    baseUrl: 'https://api.openai.com/v1',
    timeoutMs: 10_000,
    fetcher: vi.fn().mockResolvedValue(new Response('private failure', { status: 429 })),
  });
  await expect(
    classifier.classify({
      headline: 'Unknown story',
      canonicalUrl: 'https://example.com/story',
      publisher: 'Example',
      description: null,
      suggestedTeams: [],
    }),
  ).rejects.toMatchObject({ code: 'CANDIDATE_CLASSIFIER_UNAVAILABLE' });
});

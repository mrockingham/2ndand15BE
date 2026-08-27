import { describe, expect, it } from 'vitest';
import { OpenAiPredictionExplainer } from './prediction-explainer.js';
import { generateBaselinePrediction } from './prediction-model.js';

const game = {
  id: 'game',
  season: 2026,
  seasonType: 'PRE' as const,
  week: 1,
  startTime: new Date('2026-08-10T00:00:00Z'),
  isNeutralSite: false,
  homeTeam: { id: 'home', fullName: 'Home Team', abbreviation: 'HOM' },
  awayTeam: { id: 'away', fullName: 'Away Team', abbreviation: 'AWY' },
};
const prediction = generateBaselinePrediction({
  game,
  completedGames: [],
  teamFeatures: [],
  generatedAt: new Date('2026-08-09T00:00:00Z'),
  retrospective: false,
});
const envelope = (value: unknown) =>
  new Response(
    JSON.stringify({
      model: 'test-model',
      output_text: JSON.stringify(value),
      usage: { input_tokens: 10, output_tokens: 20 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('OpenAI prediction explanation safety', () => {
  it('allows exactly one remediation after unsupported prose', async () => {
    let calls = 0;
    const fetcher: typeof fetch = () => {
      calls++;
      return Promise.resolve(
        calls === 1
          ? envelope({
              summary: 'Weather favors the home side in this matchup.',
              keyReasons: ['Weather creates an edge.'],
              watchFor: [],
            })
          : envelope({
              summary: 'The deterministic team-level result favors the home side.',
              keyReasons: ['Recent team strength favors HOME.'],
              watchFor: ['Watch the fixed team-strength factor.'],
            }),
      );
    };
    const explainer = new OpenAiPredictionExplainer({
      apiKey: 'secret',
      model: 'test-model',
      baseUrl: 'https://example.com/v1',
      timeoutMs: 1000,
      fetcher,
    });
    const result = await explainer.explain(game, prediction);
    expect(calls).toBe(2);
    expect(result.summary).toContain('team-level');
    expect(result.inputTokens).toBe(10);
  });
  it('discards output when the bounded remediation is also unsafe', async () => {
    let calls = 0;
    const fetcher: typeof fetch = () => {
      calls++;
      return Promise.resolve(
        envelope({
          summary: 'Vegas has the home side ahead in this matchup.',
          keyReasons: ['Odds favor HOME.'],
          watchFor: [],
        }),
      );
    };
    const explainer = new OpenAiPredictionExplainer({
      apiKey: 'secret',
      model: 'test-model',
      baseUrl: 'https://example.com/v1',
      timeoutMs: 1000,
      fetcher,
    });
    await expect(explainer.explain(game, prediction)).rejects.toThrow('unsupported');
    expect(calls).toBe(2);
  });
});

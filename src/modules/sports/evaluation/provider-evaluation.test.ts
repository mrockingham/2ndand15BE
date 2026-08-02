import 'dotenv/config';

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  type ProviderEvaluationReport,
  runProviderEvaluation,
  serializeProviderEvaluationReport,
} from './provider-evaluation.js';

describe('provider evaluation framework', () => {
  it('preserves distinct pass, warning, and failure findings', async () => {
    const report = createReport();
    const result = await runProviderEvaluation({
      providerName: 'Test Provider',
      evaluate: () => Promise.resolve(report),
    });
    expect(new Set(result.findings.map((finding) => finding.level))).toEqual(
      new Set(['pass', 'warning', 'failure']),
    );
  });

  it('serializes sanitized reports and rejects credentials or authorization headers', () => {
    const secret = 'never-write-this-provider-key';
    const safe = serializeProviderEvaluationReport(createReport(), [secret]);
    expect(safe).not.toContain(secret);

    const credentialReport = createReport({
      findings: [
        {
          level: 'failure',
          code: 'UNSAFE',
          message: `Credential was ${secret}`,
          evidenceState: 'verified',
        },
      ],
    });
    expect(() => serializeProviderEvaluationReport(credentialReport, [secret])).toThrow(
      'configured credential',
    );

    const headerReport = createReport({
      findings: [
        {
          level: 'failure',
          code: 'UNSAFE',
          message: 'Authorization: hidden',
          evidenceState: 'verified',
        },
      ],
    });
    expect(() => serializeProviderEvaluationReport(headerReport)).toThrow('credential header name');
  });

  it('keeps the committed API-Sports evaluation report credential-free', async () => {
    const report = await readFile(
      new URL('../../../../docs/provider-evaluations/api-sports-2026-08-01.md', import.meta.url),
      'utf8',
    );
    const configuredSecret = process.env.SPORTS_API ?? process.env.API_SPORTS_KEY;
    if (configuredSecret !== undefined && configuredSecret !== '') {
      expect(report).not.toContain(configuredSecret);
    }
    expect(report).not.toMatch(/x-apisports-key|authorization\s*:/i);
  });
});

function createReport(overrides: Partial<ProviderEvaluationReport> = {}): ProviderEvaluationReport {
  const untested = { state: 'untested', value: null, note: 'Not tested.' } as const;
  return {
    providerName: 'Test Provider',
    availableNflSeasons: { state: 'verified', value: [2024], note: null },
    currentSeasonAvailability: { state: 'verified', value: false, note: null },
    teamCount: { state: 'verified', value: 32, note: null },
    gameCountBySeasonType: {
      '2024': {
        PRE: { state: 'verified', value: 0, note: null },
        REG: { state: 'verified', value: 256, note: null },
        POST: { state: 'verified', value: 0, note: null },
      },
    },
    earliestGameDate: untested,
    latestGameDate: untested,
    statusValuesObserved: { state: 'verified', value: ['FINAL'], note: null },
    requiredFieldCoverage: { state: 'verified', value: {}, note: null },
    nullableFieldCoverage: untested,
    playByPlayEndpointAvailability: untested,
    playByPlayFieldCoverage: untested,
    estimatedRequestCount: 2,
    evaluationTimestamp: '2026-08-01T12:00:00.000Z',
    findings: [
      {
        level: 'pass',
        code: 'HISTORICAL_DATA',
        message: 'Historical data passed.',
        evidenceState: 'verified',
      },
      {
        level: 'warning',
        code: 'PLAY_BY_PLAY',
        message: 'Play-by-play was not tested.',
        evidenceState: 'untested',
      },
      {
        level: 'failure',
        code: 'CURRENT_SEASON',
        message: 'Current season failed.',
        evidenceState: 'verified',
      },
    ],
    ...overrides,
  };
}

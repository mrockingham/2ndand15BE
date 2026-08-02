import 'dotenv/config';

import { createLogger } from '../common/logging/logger.js';
import { loadSportsSyncConfig } from '../config/env.js';
import { ApiSportsEvaluator } from '../modules/sports/evaluation/api-sports-evaluator.js';
import {
  runProviderEvaluation,
  writeProviderEvaluationReport,
} from '../modules/sports/evaluation/provider-evaluation.js';
import { createSportsDataProvider } from '../modules/sports/sports-provider-factory.js';

const config = loadSportsSyncConfig();
const logger = createLogger(config);

try {
  const sportsConfig = { ...config.sports, provider: 'api-sports' } as const;
  const provider = createSportsDataProvider(sportsConfig, logger);
  const evaluator = new ApiSportsEvaluator({
    provider,
    seasons: parseSeasons(process.argv.find((argument) => argument.startsWith('--seasons='))),
    currentSeason: config.sports.currentNflSeason,
  });
  const report = await runProviderEvaluation(evaluator);
  await writeProviderEvaluationReport(
    report,
    'docs/provider-evaluations/api-sports-latest.md',
    config.sports.apiSports.apiKey === null ? [] : [config.sports.apiSports.apiKey],
  );
  logger.info(
    {
      provider: report.providerName,
      evaluationTimestamp: report.evaluationTimestamp,
      estimatedRequestCount: report.estimatedRequestCount,
      findingCounts: {
        pass: report.findings.filter((finding) => finding.level === 'pass').length,
        warning: report.findings.filter((finding) => finding.level === 'warning').length,
        failure: report.findings.filter((finding) => finding.level === 'failure').length,
      },
      output: 'docs/provider-evaluations/api-sports-latest.md',
      databaseMutated: false,
    },
    'API-Sports evaluation completed',
  );
} catch (error: unknown) {
  logger.error({ err: error }, 'API-Sports evaluation failed');
  process.exitCode = 1;
}

function parseSeasons(argument: string | undefined): readonly number[] {
  const values = (
    argument?.slice('--seasons='.length) ??
    `${String(config.sports.apiSports.syncSeason)},${String(config.sports.currentNflSeason)}`
  )
    .split(',')
    .map((value) => Number(value.trim()));
  if (
    values.length === 0 ||
    values.some((value) => !Number.isInteger(value) || value < 1920 || value > 2100)
  ) {
    throw new Error('Evaluation seasons must be comma-separated NFL season years.');
  }
  return [...new Set(values)];
}

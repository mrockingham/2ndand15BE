import 'dotenv/config';

import { createLogger } from '../common/logging/logger.js';
import { loadHighlightlyEvaluationConfig } from '../config/env.js';
import {
  HighlightlyEvaluator,
  writeHighlightlyEvaluationReport,
} from '../modules/sports/evaluation/highlightly/highlightly-evaluator.js';
import {
  HighlightlyEvaluationError,
  HighlightlyEvaluationHttpClient,
} from '../modules/sports/evaluation/highlightly/highlightly-http-client.js';
import { runProviderEvaluation } from '../modules/sports/evaluation/provider-evaluation.js';

let client: HighlightlyEvaluationHttpClient | undefined;
let priorRequestCount = 0;

try {
  const config = loadHighlightlyEvaluationConfig();
  const logger = createLogger(config);
  client = new HighlightlyEvaluationHttpClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    requestTimeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    logger,
  });
  priorRequestCount = parsePriorRequestCount(
    process.argv.find((argument) => argument.startsWith('--prior-requests=')),
  );
  const evaluator = new HighlightlyEvaluator({
    client,
    season: config.evaluationSeason,
    priorRequestCount,
  });
  await runProviderEvaluation(evaluator);
  const report = await evaluator.evaluateDetailed();
  const date = report.documentation.evaluatedAt.slice(0, 10);
  const output = `docs/provider-evaluations/highlightly-nfl-${date}.md`;
  await writeHighlightlyEvaluationReport(report, output, [config.apiKey]);
  logger.info(
    {
      provider: 'Highlightly',
      season: config.evaluationSeason,
      requestsUsed: report.requestCount,
      currentSeasonSuitability: report.currentSeasonSuitability,
      output,
      databaseAccessed: false,
      databaseMutated: false,
    },
    'Highlightly read-only evaluation completed',
  );
} catch (error: unknown) {
  const providerError = error instanceof HighlightlyEvaluationError ? error : null;
  const logger = createLogger({
    logLevel: process.env.LOG_LEVEL === 'silent' ? 'silent' : 'error',
  });
  logger.error(
    {
      errorType: error instanceof Error ? error.name : 'UnknownError',
      errorCode: providerError?.code ?? 'CONFIGURATION_OR_EVALUATION_ERROR',
      statusCode: providerError?.statusCode ?? null,
      endpoint: providerError?.getEndpointPath() ?? null,
      requestsUsed: priorRequestCount + (client?.getRequestCount() ?? 0),
    },
    'Highlightly evaluation failed without writing a report',
  );
  process.exitCode = 1;
}

function parsePriorRequestCount(argument: string | undefined): number {
  if (argument === undefined) return 0;
  const value = Number(argument.slice('--prior-requests='.length));
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error('Prior request count must be an integer between 0 and 100.');
  }
  return value;
}

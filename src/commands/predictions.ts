import 'dotenv/config';
import { parseArgs } from 'node:util';
import { createPrismaClient } from '../common/database/prisma.js';
import { loadConfig } from '../config/env.js';
import {
  OpenAiPredictionExplainer,
  UnconfiguredPredictionExplainer,
} from '../modules/ai-hub/prediction-explainer.js';
import { PrismaPredictionRepository } from '../modules/ai-hub/prediction.repository.js';
import { PredictionService } from '../modules/ai-hub/prediction.service.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    game: { type: 'string' },
    prediction: { type: 'string' },
    season: { type: 'string' },
    type: { type: 'string' },
    week: { type: 'string' },
    write: { type: 'boolean', default: false },
    retrospective: { type: 'boolean', default: false },
    ai: { type: 'boolean', default: false },
    limit: { type: 'string', default: '300' },
  },
});
const config = loadConfig(),
  prisma = createPrismaClient(config.databaseUrl);
const explainer =
  config.editorialAi.provider === 'openai' &&
  config.editorialAi.apiKey !== null &&
  config.editorialAi.model !== null
    ? new OpenAiPredictionExplainer({
        apiKey: config.editorialAi.apiKey,
        model: config.editorialAi.model,
        baseUrl: config.editorialAi.baseUrl,
        timeoutMs: config.editorialAi.timeoutMs,
      })
    : new UnconfiguredPredictionExplainer();
const service = new PredictionService(new PrismaPredictionRepository(prisma), undefined, explainer);
const command = positionals[0] ?? 'generate';
try {
  if (command === 'evaluate')
    console.log(
      JSON.stringify(
        await service.evaluate({
          userId: null,
          emailSnapshot: 'system:predictions-cli',
          requestId: null,
        }),
        null,
        2,
      ),
    );
  else if (command === 'publish') {
    if (values.prediction === undefined) throw new Error('--prediction is required.');
    console.log(
      JSON.stringify(
        await service.publish(values.prediction, {
          userId: null,
          emailSnapshot: 'system:predictions-cli',
          requestId: null,
        }),
        null,
        2,
      ),
    );
  } else if (command === 'backtest')
    console.log(
      JSON.stringify(
        await service.backtest(
          Number(values.season ?? '2025'),
          parseType(values.type, 'REG') as 'REG' | 'POST',
          Number(values.limit),
        ),
        null,
        2,
      ),
    );
  else
    console.log(
      JSON.stringify(
        await service.generate(
          {
            ...(values.game === undefined ? {} : { gameId: values.game }),
            ...(values.season === undefined ? {} : { season: Number(values.season) }),
            ...(values.type === undefined ? {} : { seasonType: parseType(values.type) }),
            ...(values.week === undefined
              ? {}
              : { week: values.week.toLowerCase() === 'null' ? null : Number(values.week) }),
            dryRun: !values.write,
            retrospective: values.retrospective,
            includeAiExplanation: values.ai,
          },
          { userId: null, emailSnapshot: 'system:predictions-cli', requestId: null },
        ),
        null,
        2,
      ),
    );
} finally {
  await prisma.$disconnect();
}
function parseType(
  value: string | undefined,
  fallback: 'PRE' | 'REG' | 'POST' = 'REG',
): 'PRE' | 'REG' | 'POST' {
  const normalized = value?.toUpperCase() ?? fallback;
  if (!['PRE', 'REG', 'POST'].includes(normalized))
    throw new Error('type must be PRE, REG, or POST');
  return normalized as 'PRE' | 'REG' | 'POST';
}

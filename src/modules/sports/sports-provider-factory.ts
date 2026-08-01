import type { Logger } from 'pino';

import type { SportsConfig } from '../../config/env.js';
import { ApiSportsDataProvider } from './providers/api-sports/api-sports-data-provider.js';
import {
  ApiSportsHttpClient,
  type ApiSportsHttpClientOptions,
} from './providers/api-sports/api-sports-http-client.js';
import { MockSportsDataProvider } from './providers/mock/mock-sports-data-provider.js';
import type { SportsDataProvider } from './sports-data-provider.js';

export interface SportsProviderFactoryDependencies {
  readonly fetchImplementation?: ApiSportsHttpClientOptions['fetchImplementation'];
  readonly sleep?: ApiSportsHttpClientOptions['sleep'];
  readonly random?: ApiSportsHttpClientOptions['random'];
}

export function createSportsDataProvider(
  config: SportsConfig,
  logger?: Pick<Logger, 'warn'>,
  dependencies: SportsProviderFactoryDependencies = {},
): SportsDataProvider {
  if (config.provider === 'mock') return new MockSportsDataProvider();

  const apiKey = config.apiSports.apiKey;
  if (apiKey === null) {
    throw new Error('SPORTS_API is required when SPORTS_PROVIDER is api-sports.');
  }

  const client = new ApiSportsHttpClient({
    baseUrl: config.apiSports.baseUrl,
    apiKey,
    requestTimeoutMs: config.apiSports.requestTimeoutMs,
    maxRetries: config.apiSports.maxRetries,
    ...(logger === undefined ? {} : { logger }),
    ...(dependencies.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: dependencies.fetchImplementation }),
    ...(dependencies.sleep === undefined ? {} : { sleep: dependencies.sleep }),
    ...(dependencies.random === undefined ? {} : { random: dependencies.random }),
  });
  return new ApiSportsDataProvider({ config: config.apiSports, client });
}

import type { NormalizedGame } from './normalized-game.js';
import type { ProviderRecordFailure } from './sports-data-provider.js';

export interface CurrentGameFetchQuery {
  readonly season: number;
  readonly startTime: Date;
  readonly endTime: Date;
}

export interface CurrentGameBatch {
  readonly provider: string;
  readonly received: number;
  readonly records: readonly NormalizedGame[];
  readonly failures: readonly ProviderRecordFailure[];
  readonly requestsUsed: number;
  readonly responseDurationMs: number;
}

export interface CurrentGameProvider {
  readonly providerKey: string;
  getCurrentGames(query: CurrentGameFetchQuery): Promise<CurrentGameBatch>;
}

import type { GameQuery, NormalizedGame } from './normalized-game.js';
import type { NormalizedTeam } from './normalized-team.js';

export interface ProviderRecordFailure {
  readonly providerRecordId: string | null;
  readonly reason: string;
}

export interface SportsDataBatch<T> {
  readonly provider: string;
  readonly received: number;
  readonly records: readonly T[];
  readonly failures: readonly ProviderRecordFailure[];
}

export interface SportsDataProvider {
  getTeams(): Promise<SportsDataBatch<NormalizedTeam>>;
  getGames(query: GameQuery): Promise<SportsDataBatch<NormalizedGame>>;
  getGameByProviderId(providerGameId: string): Promise<NormalizedGame | null>;
}

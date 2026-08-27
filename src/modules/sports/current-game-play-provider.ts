import type { GamePlayType } from '../../generated/prisma/client.js';
import type { ProviderRecordFailure } from './sports-data-provider.js';

export interface NormalizedCurrentGamePlay {
  readonly providerOrder: number;
  readonly period: number;
  readonly clock: string;
  readonly possessionProviderTeamId: string | null;
  readonly playType: GamePlayType;
  readonly sourcePlayType: string;
  readonly description: string;
  readonly startDown: number | null;
  readonly startDistance: number | null;
  readonly startYardLine: number | null;
  readonly endDown: number | null;
  readonly endDistance: number | null;
  readonly endYardLine: number | null;
  readonly isScoringPlay: boolean;
  readonly isPenalty: boolean;
  readonly isTurnover: boolean;
  readonly fieldPositionFailure: boolean;
}

export interface NormalizedCurrentGamePlaySnapshot {
  readonly provider: string;
  readonly providerGameId: string;
  readonly homeProviderTeamId: string;
  readonly awayProviderTeamId: string;
  readonly homeAbbreviation: string;
  readonly awayAbbreviation: string;
  readonly plays: readonly NormalizedCurrentGamePlay[];
  readonly providerUpdatedAt: string | null;
}

export interface CurrentGamePlayBatch {
  readonly provider: string;
  readonly record: NormalizedCurrentGamePlaySnapshot | null;
  readonly failures: readonly ProviderRecordFailure[];
  readonly requestsUsed: number;
  readonly responseDurationMs: number;
  readonly normalizationDurationMs: number;
}

export interface CurrentGamePlayProvider {
  readonly providerKey: string;
  getGamePlays(providerGameId: string): Promise<CurrentGamePlayBatch>;
}

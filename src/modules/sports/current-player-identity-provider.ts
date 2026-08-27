import type { ProviderRecordFailure } from './sports-data-provider.js';

export interface NormalizedCurrentPlayerProfile {
  readonly providerPlayerId: string;
  readonly displayName: string;
  readonly birthDate: string | null;
  readonly position: string | null;
  readonly sourcePosition: string | null;
  readonly jerseyNumber: number | null;
  readonly teamProviderId: string | null;
  readonly teamAbbreviation: string | null;
  readonly heightInches: number | null;
  readonly weightPounds: number | null;
  readonly draftYear: number | null;
  readonly draftRound: number | null;
  readonly draftPick: number | null;
  readonly isActive: boolean | null;
}

export interface CurrentPlayerProfileBatch {
  readonly provider: string;
  readonly profiles: readonly NormalizedCurrentPlayerProfile[];
  readonly failures: readonly ProviderRecordFailure[];
  readonly requestsUsed: number;
  readonly responseDurationMs: number;
}

export interface CurrentPlayerIdentityProvider {
  readonly providerKey: string;
  getPlayerProfiles(providerPlayerIds: readonly string[]): Promise<CurrentPlayerProfileBatch>;
}

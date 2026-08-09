import type { ProviderRecordFailure } from './sports-data-provider.js';

export interface NormalizedCurrentGameTeamStats {
  readonly firstDowns: number | null;
  readonly firstDownsPassing: number | null;
  readonly firstDownsRushing: number | null;
  readonly firstDownsPenalty: number | null;
  readonly totalPlays: number | null;
  readonly totalYards: number | null;
  readonly passingCompletions: number | null;
  readonly passingAttempts: number | null;
  readonly passingYards: number | null;
  readonly passingInterceptions: number | null;
  readonly rushingAttempts: number | null;
  readonly rushingYards: number | null;
  readonly turnovers: number | null;
  readonly fumblesLost: number | null;
  readonly sacks: number | null;
  readonly sackYardsLost: number | null;
  readonly thirdDownConversions: number | null;
  readonly thirdDownAttempts: number | null;
  readonly fourthDownConversions: number | null;
  readonly fourthDownAttempts: number | null;
  readonly penalties: number | null;
  readonly penaltyYards: number | null;
  readonly possessionSeconds: number | null;
  readonly redZoneConversions: number | null;
  readonly redZoneAttempts: number | null;
  readonly totalDrives: number | null;
}

export interface NormalizedCurrentGamePeriodScores {
  readonly period1: number | null;
  readonly period2: number | null;
  readonly period3: number | null;
  readonly period4: number | null;
  readonly overtime1: number | null;
  readonly overtime2: number | null;
}

export interface NormalizedCurrentGamePlayerStats {
  readonly providerPlayerId: string;
  readonly teamProviderId: string;
  readonly displayName: string;
  readonly passingCompletions: number | null;
  readonly passingAttempts: number | null;
  readonly passingYards: number | null;
  readonly passingTouchdowns: number | null;
  readonly passingInterceptions: number | null;
  readonly sacksSuffered: number | null;
  readonly sackYardsLost: number | null;
  readonly rushingAttempts: number | null;
  readonly rushingYards: number | null;
  readonly rushingTouchdowns: number | null;
  readonly longestRush: number | null;
  readonly targets: number | null;
  readonly receptions: number | null;
  readonly receivingYards: number | null;
  readonly receivingTouchdowns: number | null;
  readonly longestReception: number | null;
  readonly fumbles: number | null;
  readonly fumbleRecoveries: number | null;
  readonly tacklesTotal: number | null;
  readonly tacklesSolo: number | null;
  readonly defensiveSacks: number | null;
  readonly tacklesForLoss: number | null;
  readonly passesDefended: number | null;
  readonly defensiveTouchdowns: number | null;
  readonly fieldGoalsMade: number | null;
  readonly fieldGoalsAttempted: number | null;
  readonly longestFieldGoal: number | null;
  readonly extraPointsMade: number | null;
  readonly extraPointsAttempted: number | null;
  readonly punts: number | null;
  readonly puntYards: number | null;
  readonly puntAverage: number | null;
  readonly puntsInside20: number | null;
  readonly puntTouchbacks: number | null;
  readonly longestPunt: number | null;
  readonly kickReturns: number | null;
  readonly kickReturnYards: number | null;
  readonly kickReturnTouchdowns: number | null;
  readonly longestKickReturn: number | null;
  readonly puntReturns: number | null;
  readonly puntReturnYards: number | null;
  readonly puntReturnTouchdowns: number | null;
  readonly longestPuntReturn: number | null;
}

export interface NormalizedCurrentGameDetails {
  readonly provider: string;
  readonly providerGameId: string;
  readonly homeProviderTeamId: string;
  readonly awayProviderTeamId: string;
  readonly homeAbbreviation: string;
  readonly awayAbbreviation: string;
  readonly homeTeamStats: NormalizedCurrentGameTeamStats;
  readonly awayTeamStats: NormalizedCurrentGameTeamStats;
  readonly homePeriodScores: NormalizedCurrentGamePeriodScores;
  readonly awayPeriodScores: NormalizedCurrentGamePeriodScores;
  readonly playerStats: readonly NormalizedCurrentGamePlayerStats[];
  readonly scoringEventCount: number;
  readonly playCount: number;
  readonly structuredPlayCount: number;
}

export interface CurrentGameDetailsBatch {
  readonly provider: string;
  readonly record: NormalizedCurrentGameDetails | null;
  readonly failures: readonly ProviderRecordFailure[];
  readonly requestsUsed: number;
  readonly responseDurationMs: number;
}

export interface CurrentGameDetailsProvider {
  readonly providerKey: string;
  getGameDetails(providerGameId: string): Promise<CurrentGameDetailsBatch>;
}

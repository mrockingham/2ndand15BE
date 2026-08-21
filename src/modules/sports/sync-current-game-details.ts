import type { CurrentGamePlayerStat, CurrentGameTeamStat } from '../../generated/prisma/client.js';
import type {
  CurrentGameDetailsProvider,
  NormalizedCurrentGamePlayerStats,
} from './current-game-details-provider.js';
import type { CurrentPlayerIdentityProvider } from './current-player-identity-provider.js';
import {
  toTeamStatWrite,
  type CurrentGameDetailsRepository,
  type CurrentGamePlayerStatPlan,
  type CurrentGamePlayerStatValues,
  type CurrentGameTeamStatWrite,
} from './current-game-details.repository.js';
import {
  candidateLookupNames,
  reconcileCurrentPlayer,
  type CurrentPlayerResolution,
  type CurrentPlayerResolutionMethod,
} from './current-player-reconciliation.js';
import {
  assertCurrentGameMutationAllowed,
  CurrentGameSyncError,
  type CurrentGameExecutionPolicy,
} from './sync-current-games.js';

const COMPARABLE_FIELDS = [
  'isHome',
  'firstDowns',
  'firstDownsPassing',
  'firstDownsRushing',
  'firstDownsPenalty',
  'totalPlays',
  'totalYards',
  'passingCompletions',
  'passingAttempts',
  'passingYards',
  'passingInterceptions',
  'rushingAttempts',
  'rushingYards',
  'turnovers',
  'fumblesLost',
  'sacks',
  'sackYardsLost',
  'thirdDownConversions',
  'thirdDownAttempts',
  'fourthDownConversions',
  'fourthDownAttempts',
  'penalties',
  'penaltyYards',
  'possessionSeconds',
  'redZoneConversions',
  'redZoneAttempts',
  'totalDrives',
  'period1Score',
  'period2Score',
  'period3Score',
  'period4Score',
  'overtime1Score',
  'overtime2Score',
  'sourceProvider',
] as const satisfies readonly (keyof CurrentGameTeamStatWrite)[];

const PLAYER_STAT_FIELDS = [
  'passingCompletions',
  'passingAttempts',
  'passingYards',
  'passingTouchdowns',
  'passingInterceptions',
  'sacksSuffered',
  'sackYardsLost',
  'rushingAttempts',
  'rushingYards',
  'rushingTouchdowns',
  'longestRush',
  'targets',
  'receptions',
  'receivingYards',
  'receivingTouchdowns',
  'longestReception',
  'fumbles',
  'fumbleRecoveries',
  'tacklesTotal',
  'tacklesSolo',
  'defensiveSacks',
  'tacklesForLoss',
  'passesDefended',
  'defensiveTouchdowns',
  'fieldGoalsMade',
  'fieldGoalsAttempted',
  'longestFieldGoal',
  'extraPointsMade',
  'extraPointsAttempted',
  'punts',
  'puntYards',
  'puntAverage',
  'puntsInside20',
  'puntTouchbacks',
  'longestPunt',
  'kickReturns',
  'kickReturnYards',
  'kickReturnTouchdowns',
  'longestKickReturn',
  'puntReturns',
  'puntReturnYards',
  'puntReturnTouchdowns',
  'longestPuntReturn',
] as const satisfies readonly (keyof CurrentGamePlayerStatValues)[];

export interface SyncCurrentGameDetailsOptions {
  readonly gameId: string;
  readonly providerGameId?: string;
  readonly includePlayerStats?: boolean;
  readonly apply: boolean;
  readonly policy: CurrentGameExecutionPolicy;
}

export interface CurrentGameDetailFieldChange {
  readonly field: (typeof COMPARABLE_FIELDS)[number];
  readonly from: string | number | boolean | null;
  readonly to: string | number | boolean | null;
}

export interface CurrentGameTeamStatResult {
  readonly side: 'home' | 'away';
  readonly teamId: string;
  readonly outcome: 'WOULD_CREATE' | 'WOULD_UPDATE' | 'CREATED' | 'UPDATED' | 'UNCHANGED';
  readonly changes: readonly CurrentGameDetailFieldChange[];
}

export interface CurrentGameDetailsSyncReport {
  readonly provider: string;
  readonly usageMode: 'evaluation' | 'approved';
  readonly dryRun: boolean;
  readonly internalGameId: string;
  readonly providerGameId: string;
  readonly requestsUsed: number;
  readonly teamStats: {
    readonly wouldCreate: number;
    readonly wouldUpdate: number;
    readonly created: number;
    readonly updated: number;
    readonly unchanged: number;
  };
  readonly playerStats: {
    readonly received: number;
    readonly matched: number;
    readonly unmatched: number;
    readonly ambiguous: number;
    readonly persisted: number;
    readonly reason: 'PLAYER_IDENTITY_MAPPING_REQUIRED' | null;
    readonly resolutionMethods: Readonly<Record<CurrentPlayerResolutionMethod, number>>;
    readonly profiles: {
      readonly requested: number;
      readonly returned: number;
      readonly unavailable: number;
      readonly requestsUsed: number;
      readonly durationMs: number;
    };
    readonly players: {
      readonly wouldCreate: number;
      readonly created: number;
    };
    readonly mappings: {
      readonly wouldCreate: number;
      readonly created: number;
    };
    readonly rows: {
      readonly wouldCreate: number;
      readonly wouldUpdate: number;
      readonly created: number;
      readonly updated: number;
      readonly unchanged: number;
    };
    readonly review: readonly {
      readonly providerPlayerId: string;
      readonly displayName: string | null;
      readonly teamId: string;
      readonly position: string | null;
      readonly jerseyNumber: number | null;
      readonly birthDate: string | null;
      readonly method: 'AMBIGUOUS' | 'UNRESOLVED';
      readonly candidates: readonly {
        readonly playerId: string;
        readonly displayName: string;
        readonly position: string | null;
        readonly latestTeamId: string | null;
      }[];
    }[];
  };
  readonly discovery: {
    readonly scoringEvents: number;
    readonly plays: number;
    readonly structuredPlays: number;
  };
  readonly performance: {
    readonly providerMs: number;
    readonly normalizationMs: number;
    readonly databaseReadMs: number;
    readonly playerMappingMs: number;
    readonly profileMs: number;
    readonly candidateDatabaseMs: number;
    readonly identityReconciliationMs: number;
    readonly statComparisonMs: number;
    readonly comparisonMs: number;
    readonly databaseWriteMs: number;
    readonly totalMs: number;
  };
  readonly results: readonly CurrentGameTeamStatResult[];
}

export class CurrentGameDetailsSyncService {
  constructor(
    private readonly provider: CurrentGameDetailsProvider,
    private readonly repository: CurrentGameDetailsRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly identityProvider?: CurrentPlayerIdentityProvider,
  ) {}

  async sync(options: SyncCurrentGameDetailsOptions): Promise<CurrentGameDetailsSyncReport> {
    const totalStarted = performance.now();
    assertCurrentGameMutationAllowed(this.provider.providerKey, options.apply, options.policy);
    const usageMode = options.policy.publicationApproved ? 'approved' : 'evaluation';
    const readStarted = performance.now();
    const target = await this.repository.findTarget(options.gameId, this.provider.providerKey);
    const databaseReadMs = performance.now() - readStarted;
    if (target === null)
      throw new CurrentGameSyncError('GAME_NOT_FOUND', 'The internal game was not found.');
    const providerGameId = options.providerGameId ?? target.providerMapping?.providerGameId;
    if (providerGameId === undefined) {
      throw new CurrentGameSyncError(
        'GAME_PROVIDER_MAPPING_REQUIRED',
        'Current-game details require a verified provider game mapping.',
      );
    }

    if (
      target.providerMapping !== null &&
      options.providerGameId !== undefined &&
      options.providerGameId !== target.providerMapping.providerGameId
    ) {
      throw new CurrentGameSyncError(
        'CURRENT_GAME_DETAILS_IDENTITY_MISMATCH',
        'Requested provider details conflict with the existing mapping.',
      );
    }
    const includePlayerStats = options.includePlayerStats !== false;
    const batch = await this.provider.getGameDetails(providerGameId, { includePlayerStats });
    if (batch.provider !== this.provider.providerKey || batch.record === null) {
      throw new CurrentGameSyncError(
        'CURRENT_GAME_DETAILS_INVALID',
        batch.failures[0]?.reason ?? 'Provider details were unavailable.',
      );
    }
    const detail = includePlayerStats ? batch.record : { ...batch.record, playerStats: [] };
    if (
      detail.providerGameId !== providerGameId ||
      !sameTeamAbbreviation(detail.homeAbbreviation, target.homeAbbreviation) ||
      !sameTeamAbbreviation(detail.awayAbbreviation, target.awayAbbreviation)
    ) {
      throw new CurrentGameSyncError(
        'CURRENT_GAME_DETAILS_IDENTITY_MISMATCH',
        'Provider details conflict with the verified game identity or orientation.',
      );
    }

    const playerMappingStarted = performance.now();
    const playerIdentities = classifyPlayerIdentities(detail.playerStats);
    const playerMappings = includePlayerStats
      ? await this.repository.findPlayerMappings(
          this.provider.providerKey,
          playerIdentities.uniqueIds,
        )
      : new Map<string, string>();
    const playerMappingMs = performance.now() - playerMappingStarted;
    let profileMs = 0;
    let candidateDatabaseMs = 0;
    let identityReconciliationMs = 0;
    let profileRequests = 0;
    let profilesReturned = 0;
    let profilesUnavailable = 0;
    let resolutions: CurrentPlayerResolution[] = playerIdentities.uniqueIds.map(
      (providerPlayerId) => ({
        providerPlayerId,
        method: playerMappings.has(providerPlayerId) ? 'EXISTING_MAPPING' : 'UNRESOLVED',
        playerId: playerMappings.get(providerPlayerId) ?? null,
        profile: null,
        teamId: teamIdForProviderPlayer(detail, providerPlayerId, target),
        evidence: playerMappings.has(providerPlayerId) ? ['providerPlayerId'] : [],
        candidates: [],
      }),
    );
    if (
      this.identityProvider !== undefined &&
      this.repository.findPlayerIdentityCandidates !== undefined &&
      this.repository.findPlayerMappingOwners !== undefined
    ) {
      const unresolvedIds = playerIdentities.uniqueIds.filter((id) => !playerMappings.has(id));
      const profileBatch = await this.identityProvider.getPlayerProfiles(unresolvedIds);
      profileMs = profileBatch.responseDurationMs;
      profileRequests = profileBatch.requestsUsed;
      profilesReturned = profileBatch.profiles.length;
      profilesUnavailable = profileBatch.failures.length;
      const profileById = new Map(
        profileBatch.profiles.map((profile) => [profile.providerPlayerId, profile]),
      );
      const candidateReadStarted = performance.now();
      const candidates = await this.repository.findPlayerIdentityCandidates(
        profileBatch.profiles.flatMap((profile) => candidateLookupNames(profile.displayName)),
        profileBatch.profiles.flatMap((profile) =>
          profile.birthDate === null ? [] : [profile.birthDate],
        ),
      );
      const candidateOwners = await this.repository.findPlayerMappingOwners(
        this.provider.providerKey,
        candidates.map((candidate) => candidate.id),
      );
      candidateDatabaseMs = performance.now() - candidateReadStarted;
      const reconciliationStarted = performance.now();
      const rowById = new Map(detail.playerStats.map((row) => [row.providerPlayerId, row]));
      resolutions = playerIdentities.uniqueIds.map((providerPlayerId) => {
        const row = rowById.get(providerPlayerId);
        if (row === undefined) throw new Error('Normalized player row is unavailable.');
        const value = reconcileCurrentPlayer({
          providerPlayerId,
          boxScoreName: row.displayName,
          teamId: teamIdForProviderTeam(detail, row.teamProviderId, target),
          teamProviderId: row.teamProviderId,
          existingPlayerId: playerMappings.get(providerPlayerId),
          profile: profileById.get(providerPlayerId),
          candidates: candidates.filter((candidate) => {
            const profile = profileById.get(providerPlayerId);
            const birthDate = profile?.birthDate;
            return (
              candidateLookupNames(profile?.displayName ?? row.displayName).includes(
                candidate.normalizedName,
              ) ||
              (birthDate !== undefined && birthDate !== null && birthDate === candidate.birthDate)
            );
          }),
        });
        if (
          value.playerId !== null &&
          value.method === 'STRONG_PROFILE' &&
          candidateOwners.has(value.playerId) &&
          candidateOwners.get(value.playerId) !== providerPlayerId
        ) {
          return { ...value, method: 'AMBIGUOUS' as const, playerId: null, evidence: [] };
        }
        return value;
      });
      resolutions = rejectDuplicateBindings(resolutions);
      identityReconciliationMs = performance.now() - reconciliationStarted;
    }
    const matched = resolutions.filter((resolution) => resolution.playerId !== null).length;
    const sourceUpdatedAt = this.now();
    const desiredRows = [
      toTeamStatWrite({
        gameId: target.id,
        teamId: target.homeTeamId,
        isHome: true,
        stats: detail.homeTeamStats,
        periods: detail.homePeriodScores,
        provider: this.provider.providerKey,
        sourceUpdatedAt,
      }),
      toTeamStatWrite({
        gameId: target.id,
        teamId: target.awayTeamId,
        isHome: false,
        stats: detail.awayTeamStats,
        periods: detail.awayPeriodScores,
        provider: this.provider.providerKey,
        sourceUpdatedAt,
      }),
    ] as const;

    const comparisonStarted = performance.now();
    const results = desiredRows.map((row) => planRow(row, target.teamStats, options.apply));
    const changedRows = desiredRows.filter(
      (_row, index) => results[index]?.outcome !== 'UNCHANGED',
    );
    const comparisonMs = performance.now() - comparisonStarted;
    const statComparisonStarted = performance.now();
    const playerPlans = planPlayerStats(
      detail.playerStats,
      resolutions,
      target.playerStats,
      this.provider.providerKey,
    );
    const statComparisonMs = performance.now() - statComparisonStarted;
    const actionablePlayerPlans = playerPlans.filter(
      (plan) => plan.changed || plan.createMapping || plan.playerId === null,
    );
    const resolvedPlayerCount = playerPlans.length;
    const unresolvedPlayerCount = detail.playerStats.length - resolvedPlayerCount;
    const coverage = target.playerCoverage;
    const coverageChanged =
      coverage === null
        ? true
        : coverage.providerRows !== detail.playerStats.length ||
          coverage.resolvedRows !== resolvedPlayerCount ||
          coverage.unresolvedRows !== unresolvedPlayerCount ||
          coverage.sourceProvider !== this.provider.providerKey;
    let databaseWriteMs = 0;
    if (options.apply && changedRows.length > 0) {
      const writeStarted = performance.now();
      await this.repository.applyStats({
        target,
        rows: changedRows,
        provider: this.provider.providerKey,
        usageMode,
        unmatchedPlayerCount: playerIdentities.uniqueIds.length - matched,
      });
      databaseWriteMs = performance.now() - writeStarted;
    }

    if (
      options.apply &&
      includePlayerStats &&
      (actionablePlayerPlans.length > 0 || coverageChanged) &&
      this.repository.applyPlayerStats !== undefined
    ) {
      const writeStarted = performance.now();
      await this.repository.applyPlayerStats({
        target,
        plans: actionablePlayerPlans,
        provider: this.provider.providerKey,
        usageMode,
        sourceUpdatedAt,
        unresolvedPlayerCount,
        providerPlayerCount: detail.playerStats.length,
        resolvedPlayerCount,
        coverageChanged,
      });
      databaseWriteMs += performance.now() - writeStarted;
    }

    const resolutionMethods = resolutionMethodCounts(resolutions);
    const resolvedPlans = playerPlans.filter(
      (plan) => plan.playerId !== null || plan.profile !== null,
    );
    const newPlayers = resolutionMethods.NEW_CURRENT_PLAYER;
    const newMappings = resolutionMethods.STRONG_PROFILE + resolutionMethods.NEW_CURRENT_PLAYER;
    const playerRowCreates = playerPlans.filter(
      (plan) =>
        plan.playerId === null || !target.playerStats.some((row) => row.playerId === plan.playerId),
    ).length;
    const playerRowUpdates = playerPlans.filter(
      (plan) =>
        plan.playerId !== null &&
        target.playerStats.some((row) => row.playerId === plan.playerId) &&
        plan.changed,
    ).length;
    const playerRowUnchanged = playerPlans.filter((plan) => !plan.changed).length;

    return {
      provider: this.provider.providerKey,
      usageMode,
      dryRun: !options.apply,
      internalGameId: target.id,
      providerGameId: detail.providerGameId,
      requestsUsed: batch.requestsUsed + profileRequests,
      teamStats: {
        wouldCreate: results.filter((result) => result.outcome === 'WOULD_CREATE').length,
        wouldUpdate: results.filter((result) => result.outcome === 'WOULD_UPDATE').length,
        created: results.filter((result) => result.outcome === 'CREATED').length,
        updated: results.filter((result) => result.outcome === 'UPDATED').length,
        unchanged: results.filter((result) => result.outcome === 'UNCHANGED').length,
      },
      playerStats: {
        received: detail.playerStats.length,
        matched,
        unmatched: resolutionMethods.UNRESOLVED,
        ambiguous: playerIdentities.ambiguous + resolutionMethods.AMBIGUOUS,
        persisted: options.apply ? resolvedPlans.length : 0,
        reason:
          !includePlayerStats || this.identityProvider !== undefined
            ? null
            : 'PLAYER_IDENTITY_MAPPING_REQUIRED',
        resolutionMethods,
        profiles: {
          requested: playerIdentities.uniqueIds.length - playerMappings.size,
          returned: profilesReturned,
          unavailable: profilesUnavailable,
          requestsUsed: profileRequests,
          durationMs: Math.round(profileMs),
        },
        players: {
          wouldCreate: options.apply ? 0 : newPlayers,
          created: options.apply ? newPlayers : 0,
        },
        mappings: {
          wouldCreate: options.apply ? 0 : newMappings,
          created: options.apply ? newMappings : 0,
        },
        rows: {
          wouldCreate: options.apply ? 0 : playerRowCreates,
          wouldUpdate: options.apply ? 0 : playerRowUpdates,
          created: options.apply ? playerRowCreates : 0,
          updated: options.apply ? playerRowUpdates : 0,
          unchanged: playerRowUnchanged,
        },
        review: resolutions.flatMap((resolution) =>
          resolution.method === 'AMBIGUOUS' || resolution.method === 'UNRESOLVED'
            ? [toReviewRow(resolution)]
            : [],
        ),
      },
      discovery: {
        scoringEvents: detail.scoringEventCount,
        plays: detail.playCount,
        structuredPlays: detail.structuredPlayCount,
      },
      performance: {
        providerMs: batch.responseDurationMs - (batch.normalizationDurationMs ?? 0),
        normalizationMs: batch.normalizationDurationMs ?? 0,
        databaseReadMs: Math.round(databaseReadMs),
        playerMappingMs: Math.round(playerMappingMs),
        profileMs: Math.round(profileMs),
        candidateDatabaseMs: Math.round(candidateDatabaseMs),
        identityReconciliationMs: Math.round(identityReconciliationMs),
        statComparisonMs: Math.round(statComparisonMs),
        comparisonMs: Math.round(comparisonMs),
        databaseWriteMs: Math.round(databaseWriteMs),
        totalMs: Math.round(performance.now() - totalStarted),
      },
      results,
    };
  }
}

function classifyPlayerIdentities(
  rows: readonly {
    readonly providerPlayerId: string;
    readonly teamProviderId: string;
    readonly displayName: string;
  }[],
): { readonly uniqueIds: readonly string[]; readonly ambiguous: number } {
  const identities = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const row of rows) {
    const identity = `${row.teamProviderId}:${row.displayName}`;
    const existing = identities.get(row.providerPlayerId);
    if (existing !== undefined && existing !== identity) ambiguous.add(row.providerPlayerId);
    identities.set(row.providerPlayerId, identity);
  }
  return {
    uniqueIds: [...identities.keys()].filter((id) => !ambiguous.has(id)),
    ambiguous: ambiguous.size,
  };
}

function teamIdForProviderPlayer(
  detail: Awaited<ReturnType<CurrentGameDetailsProvider['getGameDetails']>>['record'] & {},
  providerPlayerId: string,
  target: { readonly homeTeamId: string; readonly awayTeamId: string },
): string {
  const row = detail.playerStats.find(
    (candidate) => candidate.providerPlayerId === providerPlayerId,
  );
  if (row === undefined) throw new Error('Normalized player identity is unavailable.');
  return teamIdForProviderTeam(detail, row.teamProviderId, target);
}

function teamIdForProviderTeam(
  detail: {
    readonly homeProviderTeamId: string;
    readonly awayProviderTeamId: string;
  },
  providerTeamId: string,
  target: { readonly homeTeamId: string; readonly awayTeamId: string },
): string {
  if (providerTeamId === detail.homeProviderTeamId) return target.homeTeamId;
  if (providerTeamId === detail.awayProviderTeamId) return target.awayTeamId;
  throw new Error('Player team does not match the verified game orientation.');
}

function sameTeamAbbreviation(left: string, right: string): boolean {
  const canonical = (value: string): string =>
    value.trim().toUpperCase() === 'WSH' ? 'WAS' : value.trim().toUpperCase();
  return canonical(left) === canonical(right);
}

function rejectDuplicateBindings(
  resolutions: readonly CurrentPlayerResolution[],
): CurrentPlayerResolution[] {
  const counts = new Map<string, number>();
  for (const resolution of resolutions) {
    if (resolution.playerId !== null) {
      counts.set(resolution.playerId, (counts.get(resolution.playerId) ?? 0) + 1);
    }
  }
  return resolutions.map((resolution) =>
    resolution.playerId !== null && (counts.get(resolution.playerId) ?? 0) > 1
      ? { ...resolution, method: 'AMBIGUOUS', playerId: null, evidence: [] }
      : resolution,
  );
}

function planPlayerStats(
  rows: readonly NormalizedCurrentGamePlayerStats[],
  resolutions: readonly CurrentPlayerResolution[],
  existingRows: readonly CurrentGamePlayerStat[],
  provider: string,
): CurrentGamePlayerStatPlan[] {
  const resolutionById = new Map(
    resolutions.map((resolution) => [resolution.providerPlayerId, resolution]),
  );
  return rows.flatMap((row) => {
    const resolution = resolutionById.get(row.providerPlayerId);
    if (
      resolution === undefined ||
      resolution.method === 'AMBIGUOUS' ||
      resolution.method === 'UNRESOLVED'
    ) {
      return [];
    }
    const providerPlayerId = row.providerPlayerId;
    const values = Object.fromEntries(
      PLAYER_STAT_FIELDS.map((field) => [field, row[field]]),
    ) as CurrentGamePlayerStatValues;
    const existing =
      resolution.playerId === null
        ? undefined
        : existingRows.find((candidate) => candidate.playerId === resolution.playerId);
    const changed =
      existing === undefined
        ? true
        : existing.teamId !== resolution.teamId ||
          existing.sourceProvider !== provider ||
          PLAYER_STAT_FIELDS.some((field) => existing[field] !== values[field]);
    return [
      {
        providerPlayerId,
        playerId: resolution.playerId,
        teamId: resolution.teamId,
        profile: resolution.profile,
        createMapping:
          resolution.method === 'STRONG_PROFILE' || resolution.method === 'NEW_CURRENT_PLAYER',
        values,
        changed,
      },
    ];
  });
}

function resolutionMethodCounts(
  resolutions: readonly CurrentPlayerResolution[],
): Record<CurrentPlayerResolutionMethod, number> {
  const counts: Record<CurrentPlayerResolutionMethod, number> = {
    EXISTING_MAPPING: 0,
    SHARED_EXTERNAL_ID: 0,
    STRONG_PROFILE: 0,
    NEW_CURRENT_PLAYER: 0,
    AMBIGUOUS: 0,
    UNRESOLVED: 0,
  };
  for (const resolution of resolutions) counts[resolution.method] += 1;
  return counts;
}

function toReviewRow(resolution: CurrentPlayerResolution) {
  return {
    providerPlayerId: resolution.providerPlayerId,
    displayName: resolution.profile?.displayName ?? null,
    teamId: resolution.teamId,
    position: resolution.profile?.position ?? null,
    jerseyNumber: resolution.profile?.jerseyNumber ?? null,
    birthDate: resolution.profile?.birthDate ?? null,
    method: resolution.method as 'AMBIGUOUS' | 'UNRESOLVED',
    candidates: resolution.candidates.map((candidate) => ({
      playerId: candidate.id,
      displayName: candidate.displayName,
      position: candidate.position,
      latestTeamId: candidate.latestTeamId,
    })),
  };
}

function planRow(
  desired: CurrentGameTeamStatWrite,
  existingRows: readonly CurrentGameTeamStat[],
  apply: boolean,
): CurrentGameTeamStatResult {
  const existing = existingRows.find((row) => row.teamId === desired.teamId);
  if (existing === undefined) {
    return {
      side: desired.isHome ? 'home' : 'away',
      teamId: desired.teamId,
      outcome: apply ? 'CREATED' : 'WOULD_CREATE',
      changes: COMPARABLE_FIELDS.map((field) => ({ field, from: null, to: desired[field] })),
    };
  }
  const changes = COMPARABLE_FIELDS.flatMap((field) =>
    existing[field] === desired[field]
      ? []
      : [{ field, from: existing[field], to: desired[field] }],
  );
  return {
    side: desired.isHome ? 'home' : 'away',
    teamId: desired.teamId,
    outcome: changes.length === 0 ? 'UNCHANGED' : apply ? 'UPDATED' : 'WOULD_UPDATE',
    changes,
  };
}

import type { CurrentGameProvider } from './current-game-provider.js';
import type {
  CurrentGameRecord,
  CurrentGameStateWrite,
  CurrentGameSyncRepository,
  CurrentGameWindowScope,
} from './current-game-sync.repository.js';
import type { NormalizedGame } from './normalized-game.js';

export const MATCH_TOLERANCE_MS = 15 * 60 * 1_000;

export type CurrentGameOutcome =
  | 'WOULD_UPDATE'
  | 'UPDATED'
  | 'UNCHANGED'
  | 'UNMATCHED'
  | 'AMBIGUOUS'
  | 'FAILED'
  | 'RESULT_CONFLICT';

export type CurrentGameResultCoverage =
  'PROVIDER_COMPLETE' | 'EDITORIAL_RESULT_FALLBACK' | 'PROVIDER_MISSING' | 'RESULT_CONFLICT';

export type CurrentGameResultReconciliation =
  'NOT_APPLICABLE' | 'PROVIDER_STILL_MISSING' | 'AGREES' | 'DISAGREES';

export interface CurrentGameFieldChange {
  readonly field: keyof CurrentGameStateWrite;
  readonly from: string | number | null;
  readonly to: string | number | null;
}

export interface CurrentGameSyncItem {
  readonly internalGameId: string;
  readonly internalSnapshot: CurrentGameInternalSnapshot;
  readonly providerGameId: string | null;
  readonly outcome: CurrentGameOutcome;
  readonly matchMethod: 'PROVIDER_MAPPING' | 'SCHEDULE' | null;
  readonly changes: readonly CurrentGameFieldChange[];
  readonly mappingChange: 'CREATE' | 'NONE';
  readonly reason: string | null;
  readonly providerSnapshot: CurrentGameProviderSnapshot | null;
  readonly resultCoverage: CurrentGameResultCoverage;
  readonly resultReconciliation: CurrentGameResultReconciliation;
}

export interface CurrentGameInternalSnapshot {
  readonly season: number;
  readonly seasonType: CurrentGameRecord['seasonType'];
  readonly week: number | null;
  readonly startTime: string | null;
  readonly status: CurrentGameRecord['status'];
  readonly homeAbbreviation: string;
  readonly awayAbbreviation: string;
  readonly providerMappingPresent: boolean;
}

export interface CurrentGameProviderSnapshot {
  readonly season: number;
  readonly seasonType: NormalizedGame['seasonType'];
  readonly week: number | null;
  readonly startTime: string;
  readonly status: NormalizedGame['status'];
  readonly homeAbbreviation: string | null;
  readonly awayAbbreviation: string | null;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly quarter: number | null;
  readonly clock: string | null;
  readonly venueName: string | null;
  readonly venueCity: string | null;
  readonly broadcastNetwork: string | null;
}

export interface CurrentGameSyncReport {
  readonly provider: string;
  readonly usageMode: 'evaluation' | 'approved';
  readonly dryRun: boolean;
  readonly internalReviewed: number;
  readonly providerRecordsReceived: number;
  readonly fetched: number;
  readonly matched: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly unmatched: number;
  readonly providerMissing: number;
  readonly providerOnlyUnmatched: number;
  readonly ambiguous: number;
  readonly failed: number;
  readonly resultConflict: number;
  readonly requestsUsed: number;
  readonly performance: {
    readonly providerResponseMs: number;
    readonly normalizationMs: number;
    readonly matchingMs: number;
    readonly databaseMs: number;
    readonly totalMs: number;
  };
  readonly results: readonly CurrentGameSyncItem[];
  readonly providerOnly: readonly CurrentGameProviderSnapshot[];
}

export interface CurrentGameExecutionPolicy {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly evaluationMode: boolean;
  readonly publicationApproved: boolean;
}

export interface SyncCurrentGameOptions {
  readonly gameId: string;
  readonly apply: boolean;
  readonly policy: CurrentGameExecutionPolicy;
}

export interface SyncCurrentGameWindowOptions extends CurrentGameWindowScope {
  readonly apply: boolean;
  readonly policy: CurrentGameExecutionPolicy;
}

export class CurrentGameSyncError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CurrentGameSyncError';
  }
}

export class CurrentGameSyncService {
  constructor(
    private readonly provider: CurrentGameProvider,
    private readonly repository: CurrentGameSyncRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async sync(options: SyncCurrentGameOptions): Promise<CurrentGameSyncReport> {
    const totalStarted = performance.now();
    assertCurrentGameMutationAllowed(this.provider.providerKey, options.apply, options.policy);
    const usageMode = options.policy.publicationApproved ? 'approved' : 'evaluation';

    const databaseStarted = performance.now();
    const game = await this.repository.findGame(options.gameId, this.provider.providerKey);
    let databaseMs = performance.now() - databaseStarted;
    if (game === null) {
      throw new CurrentGameSyncError('GAME_NOT_FOUND', 'The internal game was not found.');
    }
    if (game.startTime === null) {
      throw new CurrentGameSyncError(
        'GAME_KICKOFF_REQUIRED',
        'Current-game matching requires a reviewed kickoff.',
      );
    }

    const batch = await this.provider.getCurrentGames({
      season: game.season,
      startTime: new Date(game.startTime.getTime() - MATCH_TOLERANCE_MS),
      endTime: new Date(game.startTime.getTime() + MATCH_TOLERANCE_MS),
    });
    if (batch.provider !== this.provider.providerKey) {
      throw new CurrentGameSyncError(
        'PROVIDER_BATCH_MISMATCH',
        'Current-game provider returned an inconsistent provider key.',
      );
    }

    const matchingStarted = performance.now();
    const match = matchCurrentGame(game, batch.records);
    const matchingMs = performance.now() - matchingStarted;
    let item: CurrentGameSyncItem;

    if (match.kind === 'unmatched') {
      item =
        batch.failures.length === 0
          ? resultItem(game, 'UNMATCHED', match.reason)
          : resultItem(
              game,
              'FAILED',
              `Provider records in the matching window failed normalization (${String(batch.failures.length)}).`,
            );
    } else if (match.kind === 'ambiguous') {
      item = resultItem(game, 'AMBIGUOUS', 'Multiple provider games matched safely.');
    } else if (match.kind === 'failed') {
      item = resultItem(game, 'FAILED', match.reason, match.providerGameId);
    } else {
      const mappedLookupStarted = performance.now();
      const mappedGameId = await this.repository.findMappedGameId(
        this.provider.providerKey,
        match.game.providerGameId,
      );
      databaseMs += performance.now() - mappedLookupStarted;
      if (mappedGameId !== null && mappedGameId !== game.id) {
        item = resultItem(
          game,
          'FAILED',
          'The provider game ID is already mapped to a different internal game.',
          match.game.providerGameId,
        );
      } else {
        item = await this.planAndMaybeApply(
          game,
          match.game,
          match.method,
          usageMode,
          options,
          (duration) => {
            databaseMs += duration;
          },
        );
      }
    }

    return buildReport({
      provider: this.provider.providerKey,
      usageMode,
      dryRun: !options.apply,
      batch,
      item,
      providerOnly: [],
      matchingMs: Math.round(matchingMs),
      databaseMs: Math.round(databaseMs),
      totalMs: Math.round(performance.now() - totalStarted),
    });
  }

  async syncWindow(options: SyncCurrentGameWindowOptions): Promise<CurrentGameSyncReport> {
    const totalStarted = performance.now();
    assertCurrentGameMutationAllowed(this.provider.providerKey, options.apply, options.policy);
    assertBoundedWindow(options);
    if (this.repository.findReviewedGames === undefined) {
      throw new CurrentGameSyncError(
        'WINDOW_SYNC_UNSUPPORTED',
        'The repository does not support window synchronization.',
      );
    }
    const usageMode = options.policy.publicationApproved ? 'approved' : 'evaluation';
    const databaseStarted = performance.now();
    const games = await this.repository.findReviewedGames(options, this.provider.providerKey);
    let databaseMs = performance.now() - databaseStarted;
    if (games.length === 0) {
      throw new CurrentGameSyncError(
        'NO_REVIEWED_GAMES',
        'No reviewed internal games matched the requested scope.',
      );
    }
    if (games.some((game) => game.startTime === null)) {
      throw new CurrentGameSyncError(
        'GAME_KICKOFF_REQUIRED',
        'Every game in a current-game window requires a reviewed kickoff.',
      );
    }
    const kickoffs = games.map((game) => game.startTime?.getTime() ?? 0);
    const batch = await this.provider.getCurrentGames({
      season: options.season,
      startTime: options.startTime ?? new Date(Math.min(...kickoffs) - MATCH_TOLERANCE_MS),
      endTime: options.endTime ?? new Date(Math.max(...kickoffs) + MATCH_TOLERANCE_MS),
    });
    if (batch.provider !== this.provider.providerKey) {
      throw new CurrentGameSyncError(
        'PROVIDER_BATCH_MISMATCH',
        'Current-game provider returned an inconsistent provider key.',
      );
    }

    const matchingStarted = performance.now();
    const results: CurrentGameSyncItem[] = [];
    const consumedProviderIds = new Set<string>();
    const mappedLookupStarted = performance.now();
    const mappedOwners = await this.repository.findMappedGameOwners(
      this.provider.providerKey,
      batch.records.map((record) => record.providerGameId),
    );
    databaseMs += performance.now() - mappedLookupStarted;
    for (const game of games) {
      const match = matchCurrentGame(game, batch.records);
      if (match.kind === 'unmatched') {
        results.push(
          resultItem(game, 'UNMATCHED', 'Provider omitted this reviewed internal game.'),
        );
        continue;
      }
      if (match.kind === 'ambiguous') {
        results.push(resultItem(game, 'AMBIGUOUS', 'Multiple provider games matched safely.'));
        continue;
      }
      if (match.kind === 'failed') {
        results.push(resultItem(game, 'FAILED', match.reason, match.providerGameId));
        continue;
      }
      consumedProviderIds.add(match.game.providerGameId);
      const mappedGameId = mappedOwners.get(match.game.providerGameId) ?? null;
      if (mappedGameId !== null && mappedGameId !== game.id) {
        results.push(
          resultItem(
            game,
            'FAILED',
            'The provider game ID is already mapped to a different internal game.',
            match.game.providerGameId,
          ),
        );
        continue;
      }
      results.push(
        await this.planAndMaybeApply(
          game,
          match.game,
          match.method,
          usageMode,
          options,
          (duration) => {
            databaseMs += duration;
          },
        ),
      );
    }
    const matchingMs = performance.now() - matchingStarted;
    return buildMultiReport({
      provider: this.provider.providerKey,
      usageMode,
      dryRun: !options.apply,
      batch,
      results,
      providerOnly: batch.records
        .filter((game) => !consumedProviderIds.has(game.providerGameId))
        .map(toProviderSnapshot),
      matchingMs: Math.round(matchingMs),
      databaseMs: Math.round(databaseMs),
      totalMs: Math.round(performance.now() - totalStarted),
    });
  }

  private async planAndMaybeApply(
    game: CurrentGameRecord,
    providerGame: NormalizedGame,
    matchMethod: 'PROVIDER_MAPPING' | 'SCHEDULE',
    usageMode: 'evaluation' | 'approved',
    options: Pick<SyncCurrentGameOptions, 'apply'>,
    captureDatabaseDuration: (duration: number) => void,
  ): Promise<CurrentGameSyncItem> {
    const invalidReason = validateScoreSemantics(providerGame);
    if (invalidReason !== null) {
      return resultItem(game, 'FAILED', invalidReason, providerGame.providerGameId);
    }
    const reconciliation = reconcileEditorialResult(game, providerGame);
    if (reconciliation === 'DISAGREES') {
      return {
        internalGameId: game.id,
        internalSnapshot: toInternalSnapshot(game),
        providerGameId: providerGame.providerGameId,
        outcome: 'RESULT_CONFLICT',
        matchMethod,
        changes: [],
        mappingChange: 'NONE',
        reason: 'Provider final result conflicts with the active reviewed editorial fallback.',
        providerSnapshot: toProviderSnapshot(providerGame),
        resultCoverage: 'RESULT_CONFLICT',
        resultReconciliation: 'DISAGREES',
      };
    }
    const state = toStateWrite(game, providerGame);
    const changes = compareState(game, state);
    const createMapping = game.providerMapping === null;
    if (changes.length === 0 && !createMapping) {
      return {
        internalGameId: game.id,
        internalSnapshot: toInternalSnapshot(game),
        providerGameId: providerGame.providerGameId,
        outcome: 'UNCHANGED',
        matchMethod,
        changes,
        mappingChange: 'NONE',
        reason: null,
        providerSnapshot: toProviderSnapshot(providerGame),
        resultCoverage:
          reconciliation === 'AGREES' ? 'EDITORIAL_RESULT_FALLBACK' : 'PROVIDER_COMPLETE',
        resultReconciliation: reconciliation,
      };
    }
    if (options.apply) {
      const started = performance.now();
      await this.repository.applyCurrentGame({
        game,
        provider: this.provider.providerKey,
        providerGameId: providerGame.providerGameId,
        state,
        createMapping,
        usageMode,
        updatedAt: this.now(),
      });
      captureDatabaseDuration(performance.now() - started);
    }
    return {
      internalGameId: game.id,
      internalSnapshot: toInternalSnapshot(game),
      providerGameId: providerGame.providerGameId,
      outcome: options.apply ? 'UPDATED' : 'WOULD_UPDATE',
      matchMethod,
      changes,
      mappingChange: createMapping ? 'CREATE' : 'NONE',
      reason: null,
      providerSnapshot: toProviderSnapshot(providerGame),
      resultCoverage:
        reconciliation === 'AGREES' ? 'EDITORIAL_RESULT_FALLBACK' : 'PROVIDER_COMPLETE',
      resultReconciliation: reconciliation,
    };
  }
}

export function assertCurrentGameMutationAllowed(
  provider: string,
  apply: boolean,
  policy: CurrentGameExecutionPolicy,
): void {
  if (!apply || provider !== 'highlightly') return;
  if (policy.nodeEnv === 'production' && !policy.publicationApproved) {
    throw new CurrentGameSyncError(
      'HIGHLIGHTLY_PUBLICATION_NOT_APPROVED',
      'Highlightly current-game mutation is disabled in production.',
    );
  }
  if (!policy.evaluationMode && !policy.publicationApproved) {
    throw new CurrentGameSyncError(
      'HIGHLIGHTLY_USAGE_MODE_REQUIRED',
      'Highlightly current-game mutation requires an approved usage mode.',
    );
  }
}

type MatchResult =
  | {
      readonly kind: 'matched';
      readonly game: NormalizedGame;
      readonly method: 'PROVIDER_MAPPING' | 'SCHEDULE';
    }
  | { readonly kind: 'unmatched'; readonly reason: string }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'failed'; readonly reason: string; readonly providerGameId: string | null };

export function matchCurrentGame(
  target: CurrentGameRecord,
  candidates: readonly NormalizedGame[],
): MatchResult {
  if (target.providerMapping !== null) {
    const mapped = candidates.filter(
      (candidate) => candidate.providerGameId === target.providerMapping?.providerGameId,
    );
    if (mapped.length === 0) {
      return { kind: 'unmatched', reason: 'The existing provider mapping was not returned.' };
    }
    if (mapped.length > 1) return { kind: 'ambiguous' };
    const candidate = mapped[0];
    if (candidate === undefined) return { kind: 'ambiguous' };
    const identityError = identityMismatch(target, candidate);
    return identityError === null
      ? { kind: 'matched', game: candidate, method: 'PROVIDER_MAPPING' }
      : {
          kind: 'failed',
          reason: identityError,
          providerGameId: candidate.providerGameId,
        };
  }

  const compatible = candidates.filter((candidate) => identityMismatch(target, candidate) === null);
  const exactKickoff = compatible.filter(
    (candidate) => target.startTime?.getTime() === new Date(candidate.startTime).getTime(),
  );
  const exact = exactKickoff.length > 0 ? exactKickoff : compatible;
  if (exact.length === 1) {
    const game = exact[0];
    return game === undefined
      ? { kind: 'ambiguous' }
      : { kind: 'matched', game, method: 'SCHEDULE' };
  }
  if (exact.length > 1) return { kind: 'ambiguous' };

  const reversed = candidates.find(
    (candidate) =>
      candidate.season === target.season &&
      candidate.seasonType === target.seasonType &&
      withinKickoffTolerance(target, candidate) &&
      teamMatches(target.homeTeam, candidate.awayProviderTeamId, candidate.awayAbbreviation) &&
      teamMatches(target.awayTeam, candidate.homeProviderTeamId, candidate.homeAbbreviation),
  );
  if (reversed !== undefined) {
    return {
      kind: 'failed',
      reason: 'Provider home/away orientation conflicts with the reviewed schedule.',
      providerGameId: reversed.providerGameId,
    };
  }
  return { kind: 'unmatched', reason: 'No provider game matched the reviewed schedule identity.' };
}

function identityMismatch(target: CurrentGameRecord, candidate: NormalizedGame): string | null {
  if (candidate.season !== target.season) return 'Provider season does not match.';
  if (candidate.seasonType !== target.seasonType) return 'Provider season type does not match.';
  if (!withinKickoffTolerance(target, candidate)) return 'Provider kickoff is outside tolerance.';
  if (
    !teamMatches(target.homeTeam, candidate.homeProviderTeamId, candidate.homeAbbreviation) ||
    !teamMatches(target.awayTeam, candidate.awayProviderTeamId, candidate.awayAbbreviation)
  ) {
    return 'Provider teams do not match the reviewed home/away identity.';
  }
  return null;
}

function withinKickoffTolerance(target: CurrentGameRecord, candidate: NormalizedGame): boolean {
  return (
    target.startTime !== null &&
    Math.abs(new Date(candidate.startTime).getTime() - target.startTime.getTime()) <=
      MATCH_TOLERANCE_MS
  );
}

function teamMatches(
  target: CurrentGameRecord['homeTeam'],
  providerTeamId: string,
  abbreviation: string | undefined,
): boolean {
  return target.providerTeamId !== null
    ? target.providerTeamId === providerTeamId
    : abbreviation !== undefined &&
        canonicalAbbreviation(abbreviation) === canonicalAbbreviation(target.abbreviation);
}

function canonicalAbbreviation(value: string): string {
  const abbreviation = value.trim().toUpperCase();
  return abbreviation === 'WSH' ? 'WAS' : abbreviation;
}

function validateScoreSemantics(game: NormalizedGame): string | null {
  const bothPresent = game.homeScore !== null && game.awayScore !== null;
  if ((game.status === 'SCHEDULED' || game.status === 'PREGAME') && bothPresent) {
    return 'Scheduled provider games must not carry scores.';
  }
  if (game.status === 'FINAL' && !bothPresent) {
    return 'Final provider games require both scores.';
  }
  return null;
}

function toStateWrite(
  game: CurrentGameRecord,
  providerGame: NormalizedGame,
): CurrentGameStateWrite {
  return {
    status: providerGame.status,
    homeScore: providerGame.homeScore,
    awayScore: providerGame.awayScore,
    quarter: providerGame.quarter,
    clock: providerGame.clock,
    venueName: providerGame.venueName ?? game.venueName,
    venueCity: providerGame.venueCity ?? game.venueCity,
    broadcastNetwork: providerGame.broadcastNetwork ?? game.broadcastNetwork,
  };
}

function compareState(
  game: CurrentGameRecord,
  state: CurrentGameStateWrite,
): CurrentGameFieldChange[] {
  const fields = [
    'status',
    'homeScore',
    'awayScore',
    'quarter',
    'clock',
    'venueName',
    'venueCity',
    'broadcastNetwork',
  ] as const satisfies readonly (keyof CurrentGameStateWrite)[];
  return fields.flatMap((field) =>
    game[field] === state[field] ? [] : [{ field, from: game[field], to: state[field] }],
  );
}

function resultItem(
  game: CurrentGameRecord,
  outcome: Extract<CurrentGameOutcome, 'UNMATCHED' | 'AMBIGUOUS' | 'FAILED'>,
  reason: string,
  providerGameId: string | null = null,
): CurrentGameSyncItem {
  return {
    internalGameId: game.id,
    internalSnapshot: toInternalSnapshot(game),
    providerGameId,
    outcome,
    matchMethod: null,
    changes: [],
    mappingChange: 'NONE',
    reason,
    providerSnapshot: null,
    resultCoverage: hasEditorialResultFallback(game)
      ? 'EDITORIAL_RESULT_FALLBACK'
      : 'PROVIDER_MISSING',
    resultReconciliation: hasEditorialResultFallback(game)
      ? 'PROVIDER_STILL_MISSING'
      : 'NOT_APPLICABLE',
  };
}

function hasEditorialResultFallback(game: CurrentGameRecord): boolean {
  const override = game.editorialResultOverride;
  return override?.status === 'FINAL' && override.homeScore !== null && override.awayScore !== null;
}

export function reconcileEditorialResult(
  game: CurrentGameRecord,
  providerGame: NormalizedGame,
): CurrentGameResultReconciliation {
  if (!hasEditorialResultFallback(game)) return 'NOT_APPLICABLE';
  const override = game.editorialResultOverride;
  if (override === null) return 'NOT_APPLICABLE';
  return providerGame.status === override.status &&
    providerGame.homeScore === override.homeScore &&
    providerGame.awayScore === override.awayScore
    ? 'AGREES'
    : 'DISAGREES';
}

function toInternalSnapshot(game: CurrentGameRecord): CurrentGameInternalSnapshot {
  return {
    season: game.season,
    seasonType: game.seasonType,
    week: game.week,
    startTime: game.startTime?.toISOString() ?? null,
    status: game.status,
    homeAbbreviation: game.homeTeam.abbreviation,
    awayAbbreviation: game.awayTeam.abbreviation,
    providerMappingPresent: game.providerMapping !== null,
  };
}

function toProviderSnapshot(game: NormalizedGame): CurrentGameProviderSnapshot {
  return {
    season: game.season,
    seasonType: game.seasonType,
    week: game.week,
    startTime: game.startTime,
    status: game.status,
    homeAbbreviation: game.homeAbbreviation ?? null,
    awayAbbreviation: game.awayAbbreviation ?? null,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    quarter: game.quarter,
    clock: game.clock,
    venueName: game.venueName,
    venueCity: game.venueCity,
    broadcastNetwork: game.broadcastNetwork,
  };
}

function buildReport(input: {
  readonly provider: string;
  readonly usageMode: 'evaluation' | 'approved';
  readonly dryRun: boolean;
  readonly batch: Awaited<ReturnType<CurrentGameProvider['getCurrentGames']>>;
  readonly item: CurrentGameSyncItem;
  readonly providerOnly: readonly CurrentGameProviderSnapshot[];
  readonly matchingMs: number;
  readonly databaseMs: number;
  readonly totalMs: number;
}): CurrentGameSyncReport {
  const outcome = input.item.outcome;
  return {
    provider: input.provider,
    usageMode: input.usageMode,
    dryRun: input.dryRun,
    internalReviewed: 1,
    providerRecordsReceived: input.batch.received,
    fetched: input.batch.records.length,
    matched: ['WOULD_UPDATE', 'UPDATED', 'UNCHANGED'].includes(outcome) ? 1 : 0,
    updated: outcome === 'UPDATED' ? 1 : 0,
    unchanged: outcome === 'UNCHANGED' ? 1 : 0,
    unmatched: outcome === 'UNMATCHED' ? 1 : 0,
    providerMissing: outcome === 'UNMATCHED' ? 1 : 0,
    providerOnlyUnmatched: input.providerOnly.length,
    ambiguous: outcome === 'AMBIGUOUS' ? 1 : 0,
    failed: outcome === 'FAILED' ? 1 : 0,
    resultConflict: outcome === 'RESULT_CONFLICT' ? 1 : 0,
    requestsUsed: input.batch.requestsUsed,
    performance: {
      providerResponseMs:
        input.batch.responseDurationMs - (input.batch.normalizationDurationMs ?? 0),
      normalizationMs: input.batch.normalizationDurationMs ?? 0,
      matchingMs: input.matchingMs,
      databaseMs: input.databaseMs,
      totalMs: input.totalMs,
    },
    results: [input.item],
    providerOnly: input.providerOnly,
  };
}

function buildMultiReport(input: {
  readonly provider: string;
  readonly usageMode: 'evaluation' | 'approved';
  readonly dryRun: boolean;
  readonly batch: Awaited<ReturnType<CurrentGameProvider['getCurrentGames']>>;
  readonly results: readonly CurrentGameSyncItem[];
  readonly providerOnly: readonly CurrentGameProviderSnapshot[];
  readonly matchingMs: number;
  readonly databaseMs: number;
  readonly totalMs: number;
}): CurrentGameSyncReport {
  const count = (outcome: CurrentGameOutcome): number =>
    input.results.filter((item) => item.outcome === outcome).length;
  return {
    provider: input.provider,
    usageMode: input.usageMode,
    dryRun: input.dryRun,
    internalReviewed: input.results.length,
    providerRecordsReceived: input.batch.received,
    fetched: input.batch.records.length,
    matched: count('WOULD_UPDATE') + count('UPDATED') + count('UNCHANGED'),
    updated: count('UPDATED'),
    unchanged: count('UNCHANGED'),
    unmatched: count('UNMATCHED'),
    providerMissing: count('UNMATCHED'),
    providerOnlyUnmatched: input.providerOnly.length,
    ambiguous: count('AMBIGUOUS'),
    failed: count('FAILED'),
    resultConflict: count('RESULT_CONFLICT'),
    requestsUsed: input.batch.requestsUsed,
    performance: {
      providerResponseMs:
        input.batch.responseDurationMs - (input.batch.normalizationDurationMs ?? 0),
      normalizationMs: input.batch.normalizationDurationMs ?? 0,
      matchingMs: input.matchingMs,
      databaseMs: input.databaseMs,
      totalMs: input.totalMs,
    },
    results: input.results,
    providerOnly: input.providerOnly,
  };
}

function assertBoundedWindow(options: SyncCurrentGameWindowOptions): void {
  const hasWeek = options.week !== undefined;
  const hasDates = options.startTime !== undefined && options.endTime !== undefined;
  if (!hasWeek && !hasDates) {
    throw new CurrentGameSyncError(
      'BOUNDED_SCOPE_REQUIRED',
      'Window sync requires a week or a start/end date range.',
    );
  }
  if ((options.startTime === undefined) !== (options.endTime === undefined)) {
    throw new CurrentGameSyncError(
      'INVALID_DATE_RANGE',
      'Both start and end dates are required together.',
    );
  }
  if (
    options.startTime !== undefined &&
    options.endTime !== undefined &&
    options.endTime.getTime() - options.startTime.getTime() > 31 * 24 * 60 * 60 * 1_000
  ) {
    throw new CurrentGameSyncError(
      'DATE_RANGE_TOO_LARGE',
      'Current-game date ranges cannot exceed 31 days.',
    );
  }
}

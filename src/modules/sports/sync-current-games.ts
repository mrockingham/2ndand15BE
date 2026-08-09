import type { CurrentGameProvider } from './current-game-provider.js';
import type {
  CurrentGameRecord,
  CurrentGameStateWrite,
  CurrentGameSyncRepository,
} from './current-game-sync.repository.js';
import type { NormalizedGame } from './normalized-game.js';

const MATCH_TOLERANCE_MS = 12 * 60 * 60 * 1_000;

export type CurrentGameOutcome =
  'WOULD_UPDATE' | 'UPDATED' | 'UNCHANGED' | 'UNMATCHED' | 'AMBIGUOUS' | 'FAILED';

export interface CurrentGameFieldChange {
  readonly field: keyof CurrentGameStateWrite;
  readonly from: string | number | null;
  readonly to: string | number | null;
}

export interface CurrentGameSyncItem {
  readonly internalGameId: string;
  readonly providerGameId: string | null;
  readonly outcome: CurrentGameOutcome;
  readonly matchMethod: 'PROVIDER_MAPPING' | 'SCHEDULE' | null;
  readonly changes: readonly CurrentGameFieldChange[];
  readonly mappingChange: 'CREATE' | 'NONE';
  readonly reason: string | null;
  readonly providerSnapshot: CurrentGameProviderSnapshot | null;
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
  readonly providerRecordsReceived: number;
  readonly fetched: number;
  readonly matched: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly unmatched: number;
  readonly ambiguous: number;
  readonly failed: number;
  readonly requestsUsed: number;
  readonly performance: {
    readonly providerResponseMs: number;
    readonly matchingMs: number;
    readonly databaseMs: number;
    readonly totalMs: number;
  };
  readonly results: readonly CurrentGameSyncItem[];
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
          ? resultItem(game.id, 'UNMATCHED', match.reason)
          : resultItem(
              game.id,
              'FAILED',
              `Provider records in the matching window failed normalization (${String(batch.failures.length)}).`,
            );
    } else if (match.kind === 'ambiguous') {
      item = resultItem(game.id, 'AMBIGUOUS', 'Multiple provider games matched safely.');
    } else if (match.kind === 'failed') {
      item = resultItem(game.id, 'FAILED', match.reason, match.providerGameId);
    } else {
      const mappedLookupStarted = performance.now();
      const mappedGameId = await this.repository.findMappedGameId(
        this.provider.providerKey,
        match.game.providerGameId,
      );
      databaseMs += performance.now() - mappedLookupStarted;
      if (mappedGameId !== null && mappedGameId !== game.id) {
        item = resultItem(
          game.id,
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
    options: SyncCurrentGameOptions,
    captureDatabaseDuration: (duration: number) => void,
  ): Promise<CurrentGameSyncItem> {
    const invalidReason = validateScoreSemantics(providerGame);
    if (invalidReason !== null) {
      return resultItem(game.id, 'FAILED', invalidReason, providerGame.providerGameId);
    }
    const state = toStateWrite(game, providerGame);
    const changes = compareState(game, state);
    const createMapping = game.providerMapping === null;
    if (changes.length === 0 && !createMapping) {
      return {
        internalGameId: game.id,
        providerGameId: providerGame.providerGameId,
        outcome: 'UNCHANGED',
        matchMethod,
        changes,
        mappingChange: 'NONE',
        reason: null,
        providerSnapshot: toProviderSnapshot(providerGame),
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
      providerGameId: providerGame.providerGameId,
      outcome: options.apply ? 'UPDATED' : 'WOULD_UPDATE',
      matchMethod,
      changes,
      mappingChange: createMapping ? 'CREATE' : 'NONE',
      reason: null,
      providerSnapshot: toProviderSnapshot(providerGame),
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

  const exact = candidates.filter((candidate) => identityMismatch(target, candidate) === null);
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
    : abbreviation?.toUpperCase() === target.abbreviation.toUpperCase();
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
  gameId: string,
  outcome: Extract<CurrentGameOutcome, 'UNMATCHED' | 'AMBIGUOUS' | 'FAILED'>,
  reason: string,
  providerGameId: string | null = null,
): CurrentGameSyncItem {
  return {
    internalGameId: gameId,
    providerGameId,
    outcome,
    matchMethod: null,
    changes: [],
    mappingChange: 'NONE',
    reason,
    providerSnapshot: null,
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
  readonly matchingMs: number;
  readonly databaseMs: number;
  readonly totalMs: number;
}): CurrentGameSyncReport {
  const outcome = input.item.outcome;
  return {
    provider: input.provider,
    usageMode: input.usageMode,
    dryRun: input.dryRun,
    providerRecordsReceived: input.batch.received,
    fetched: input.batch.records.length,
    matched: ['WOULD_UPDATE', 'UPDATED', 'UNCHANGED'].includes(outcome) ? 1 : 0,
    updated: outcome === 'UPDATED' ? 1 : 0,
    unchanged: outcome === 'UNCHANGED' ? 1 : 0,
    unmatched: outcome === 'UNMATCHED' ? 1 : 0,
    ambiguous: outcome === 'AMBIGUOUS' ? 1 : 0,
    failed: outcome === 'FAILED' ? 1 : 0,
    requestsUsed: input.batch.requestsUsed,
    performance: {
      providerResponseMs: input.batch.responseDurationMs,
      matchingMs: input.matchingMs,
      databaseMs: input.databaseMs,
      totalMs: input.totalMs,
    },
    results: [input.item],
  };
}

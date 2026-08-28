import type {
  CurrentGameDetailsBatch,
  CurrentGameDetailsProvider,
  NormalizedCurrentGameDetails,
  NormalizedCurrentGamePeriodScores,
  NormalizedCurrentGamePlayerStats,
  NormalizedCurrentGameTeamStats,
} from '../../current-game-details-provider.js';
import type {
  CurrentPlayerIdentityProvider,
  CurrentPlayerProfileBatch,
  NormalizedCurrentPlayerProfile,
} from '../../current-player-identity-provider.js';
import type { HighlightlyEvaluationHttpClient } from '../../evaluation/highlightly/highlightly-http-client.js';
import {
  highlightlyBoxScoreResponseSchema,
  highlightlyDetailedMatchSchema,
  highlightlyPlayerProfileResponseSchema,
  highlightlyRawMatchDetailResponseSchema,
  type HighlightlyBoxScoreResponse,
  type HighlightlyDetailedMatch,
  type HighlightlyPlayerProfileResponse,
} from '../../evaluation/highlightly/highlightly-schemas.js';
import { HIGHLIGHTLY_PROVIDER_KEY } from './highlightly-current-game-provider.js';

type StatisticValue = string | number | boolean | null;
interface Statistic {
  readonly name?: string | undefined;
  readonly displayName?: string | undefined;
  readonly value: StatisticValue;
}

/** Provider field allowlist used by the sanitized audit to surface schema expansion. */
export const HIGHLIGHTLY_PLAYER_STATISTIC_NAMES = new Set([
  'Total Successful Passes',
  'Total Passes',
  'Total Passing Yards',
  'Total Passing Touchdowns',
  'Total Passing Interceptions',
  'Total Sacks',
  'Total Sack Yards Lost',
  'Total Rushing Attempts',
  'Total Rushing Yards',
  'Total Rushing Touchdowns',
  'Long Rushing',
  'Total Receiving Targets',
  'Total Receptions',
  'Total Receiving Yards',
  'Total Receiving Touchdowns',
  'Total Long Receptions',
  'Total Fumbles',
  'Total Recovered Fumbles',
  'Total Defensive Tackles',
  'Total Defensive Solo Tackles',
  'Total Defensive Sacks',
  'Total Defensive Tackles For Loss',
  'Total Defended Passes',
  'Total Defensive Touchdowns',
  'Successful Field Goals Kicks',
  'Attempted Field Goal Kicks',
  'Long Field Goals Kicks Made',
  'Total Extra Kicking Points Made',
  'Total Extra Kicking Point Attempts',
  'Total Punts',
  'Total Punting Yards',
  'Average Gross Punting Yards',
  'Punts Inside 20 Yards',
  'Punting Touchbacks',
  'Longest Punt Yardage',
  'Total Kick Returns',
  'Total Kick Return Yards',
  'Total Kick Return Touchdowns',
  'Longest Kick Return',
  'Total Punt Returns',
  'Total Punt Return Yards',
  'Total Punt Return Touchdowns',
  'Longest Punt Return',
]);

export class HighlightlyCurrentGameDetailsProvider
  implements CurrentGameDetailsProvider, CurrentPlayerIdentityProvider
{
  readonly providerKey = HIGHLIGHTLY_PROVIDER_KEY;

  constructor(
    private readonly client: HighlightlyEvaluationHttpClient,
    private readonly profileRequestIntervalMs = 1_050,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async getGameDetails(
    providerGameId: string,
    options: { readonly includePlayerStats?: boolean } = {},
  ): Promise<CurrentGameDetailsBatch> {
    const startedAt = performance.now();
    const detailPayload = await this.client.get(
      `/matches/${providerGameId}`,
      {},
      highlightlyRawMatchDetailResponseSchema,
    );
    const boxScore =
      options.includePlayerStats === false
        ? []
        : await this.client.get(
            `/box-score/${providerGameId}`,
            {},
            highlightlyBoxScoreResponseSchema,
          );
    const parsed = highlightlyDetailedMatchSchema.safeParse(detailPayload[0]);
    if (!parsed.success) {
      return failedBatch(
        this.client,
        providerGameId,
        startedAt,
        'Detailed match failed validation.',
      );
    }
    try {
      const normalizationStarted = performance.now();
      const record = normalizeHighlightlyCurrentGameDetails(
        parsed.data,
        boxScore,
        providerGameId,
        options.includePlayerStats !== false,
      );
      return {
        provider: HIGHLIGHTLY_PROVIDER_KEY,
        record,
        failures: [],
        requestsUsed: this.client.getRequestCount(),
        responseDurationMs: Math.round(performance.now() - startedAt),
        normalizationDurationMs: Math.round(performance.now() - normalizationStarted),
      };
    } catch (error: unknown) {
      return failedBatch(
        this.client,
        providerGameId,
        startedAt,
        error instanceof Error
          ? error.message
          : 'Provider detail has inconsistent identities or statistic values.',
      );
    }
  }

  async getPlayerProfiles(
    providerPlayerIds: readonly string[],
  ): Promise<CurrentPlayerProfileBatch> {
    const startedAt = performance.now();
    const requestCountBefore = this.client.getRequestCount();
    const profiles: NormalizedCurrentPlayerProfile[] = [];
    const failures: CurrentPlayerProfileBatch['failures'][number][] = [];
    let index = 0;
    for (const providerPlayerId of new Set(providerPlayerIds)) {
      if (index > 0 && this.profileRequestIntervalMs > 0) {
        await this.sleep(this.profileRequestIntervalMs);
      }
      index += 1;
      try {
        const payload = await this.client.get(
          `/players/${providerPlayerId}`,
          {},
          highlightlyPlayerProfileResponseSchema,
        );
        const record = payload[0];
        if (record === undefined || String(record.id) !== providerPlayerId) {
          failures.push({
            providerRecordId: providerPlayerId,
            reason: 'Player profile identity mismatch.',
          });
          continue;
        }
        profiles.push(normalizeHighlightlyPlayerProfile(record));
      } catch {
        failures.push({
          providerRecordId: providerPlayerId,
          reason: 'Player profile unavailable.',
        });
      }
    }
    return {
      provider: HIGHLIGHTLY_PROVIDER_KEY,
      profiles,
      failures,
      requestsUsed: this.client.getRequestCount() - requestCountBefore,
      responseDurationMs: Math.round(performance.now() - startedAt),
    };
  }
}

export function normalizeHighlightlyPlayerProfile(
  record: HighlightlyPlayerProfileResponse[number],
): NormalizedCurrentPlayerProfile {
  const profile = record.profile;
  return {
    providerPlayerId: String(record.id),
    displayName: profile.fullName,
    birthDate: normalizeProviderBirthDate(profile.birthDate ?? null),
    position: cleanText(profile.position?.abbreviation ?? null)?.toUpperCase() ?? null,
    sourcePosition: cleanText(profile.position?.main ?? null),
    jerseyNumber: parseProfileInteger(profile.jersey ?? null),
    teamProviderId:
      profile.team === null || profile.team === undefined ? null : String(profile.team.id),
    teamAbbreviation: cleanText(profile.team?.abbreviation ?? null)?.toUpperCase() ?? null,
    heightInches: parseHeightInches(profile.height ?? null),
    weightPounds: parseWeightPounds(profile.weight ?? null),
    draftYear: profile.draft?.year ?? null,
    draftRound: profile.draft?.round ?? null,
    draftPick: profile.draft?.pick ?? null,
    isActive: profile.isActive ?? null,
  };
}

function normalizeProviderBirthDate(value: string | null): string | null {
  const cleaned = cleanText(value);
  if (cleaned === null) return null;
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(cleaned);
  if (match === null) throw new Error('Invalid player birth date.');
  const day = match[1];
  const month = match[2];
  const year = match[3];
  if (day === undefined || month === undefined || year === undefined) {
    throw new Error('Invalid player birth date.');
  }
  return `${year}-${month}-${day}`;
}

function parseHeightInches(value: string | null): number | null {
  const cleaned = cleanText(value);
  if (cleaned === null) return null;
  const match = /^(\d)'\s*(\d{1,2})"$/.exec(cleaned);
  if (match === null) return null;
  return Number(match[1]) * 12 + Number(match[2]);
}

function parseWeightPounds(value: string | null): number | null {
  const cleaned = cleanText(value);
  if (cleaned === null) return null;
  const match = /^(\d{2,3})\s*lbs?$/i.exec(cleaned);
  return match === null ? null : Number(match[1]);
}

function parseProfileInteger(value: string | number | null): number | null {
  if (value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function cleanText(value: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned === undefined || cleaned === '' ? null : cleaned;
}

export function normalizeHighlightlyCurrentGameDetails(
  detail: HighlightlyDetailedMatch,
  boxScore: HighlightlyBoxScoreResponse,
  expectedProviderGameId = String(detail.id),
  requireBoxScore = true,
): NormalizedCurrentGameDetails {
  if (String(detail.id) !== expectedProviderGameId) throw new Error('Provider game ID mismatch.');
  if (detail.matchStatistics === null || detail.matchStatistics === undefined) {
    throw new Error('Team statistics are unavailable.');
  }
  const homeStatistics = detail.matchStatistics.homeTeam?.statistics;
  const awayStatistics = detail.matchStatistics.awayTeam?.statistics;
  if (homeStatistics === undefined || awayStatistics === undefined) {
    throw new Error('Both team-stat sides are required.');
  }
  const homeProviderTeamId = String(detail.homeTeam.id);
  const awayProviderTeamId = String(detail.awayTeam.id);
  const boxTeams = new Map(boxScore.map(({ team }) => [String(team.id), team]));
  if (
    requireBoxScore &&
    (boxTeams.size !== 2 || !boxTeams.has(homeProviderTeamId) || !boxTeams.has(awayProviderTeamId))
  ) {
    throw new Error('Box-score teams do not match the detailed game.');
  }
  const homePeriods = emptyPeriodScores();
  const awayPeriods = emptyPeriodScores();
  const periodFields = [
    ['firstPeriod', 'period1'],
    ['secondPeriod', 'period2'],
    ['thirdPeriod', 'period3'],
    ['fourthPeriod', 'period4'],
    ['firstOvertimePeriod', 'overtime1'],
    ['secondOvertimePeriod', 'overtime2'],
  ] as const;
  for (const [source, target] of periodFields) {
    const pair = parseScorePair(detail.state.score?.[source] ?? null);
    homePeriods[target] = pair?.home ?? null;
    awayPeriods[target] = pair?.away ?? null;
  }
  const plays = (detail.events ?? []).flatMap((event) => event.plays ?? []);
  return {
    provider: HIGHLIGHTLY_PROVIDER_KEY,
    providerGameId: expectedProviderGameId,
    homeProviderTeamId,
    awayProviderTeamId,
    homeAbbreviation: detail.homeTeam.abbreviation.toUpperCase(),
    awayAbbreviation: detail.awayTeam.abbreviation.toUpperCase(),
    homeTeamStats: normalizeTeamStats(homeStatistics),
    awayTeamStats: normalizeTeamStats(awayStatistics),
    homePeriodScores: homePeriods,
    awayPeriodScores: awayPeriods,
    playerStats: requireBoxScore
      ? normalizeHighlightlyCurrentGamePlayerStats(detail, boxScore, expectedProviderGameId)
      : [],
    scoringEventCount: (detail.events ?? []).filter((event) => event.isScoringPlay === true).length,
    playCount: plays.length,
    structuredPlayCount: plays.filter((play) => typeof play !== 'string').length,
  };
}

/**
 * Normalizes the standalone Highlightly box-score response against identity from the already
 * fetched match detail. The live poller uses this narrower entry point so a due player-stat
 * refresh costs only one additional `/box-score/{id}` request and never repeats `/matches/{id}`.
 */
export function normalizeHighlightlyCurrentGamePlayerStats(
  detail: HighlightlyDetailedMatch,
  boxScore: HighlightlyBoxScoreResponse,
  expectedProviderGameId = String(detail.id),
): readonly NormalizedCurrentGamePlayerStats[] {
  if (String(detail.id) !== expectedProviderGameId) throw new Error('Provider game ID mismatch.');
  const homeProviderTeamId = String(detail.homeTeam.id);
  const awayProviderTeamId = String(detail.awayTeam.id);
  const boxTeams = new Map(boxScore.map(({ team }) => [String(team.id), team]));
  if (
    boxTeams.size !== 2 ||
    !boxTeams.has(homeProviderTeamId) ||
    !boxTeams.has(awayProviderTeamId)
  ) {
    throw new Error('Box-score teams do not match the detailed game.');
  }
  return boxScore.flatMap(({ team }) =>
    team.boxScores.map((row) => normalizePlayerStats(String(team.id), row.player, row.statistics)),
  );
}

function normalizeTeamStats(statistics: readonly Statistic[]): NormalizedCurrentGameTeamStats {
  const values = statisticMap(statistics);
  const sacks = parseCompoundCount(integerOrString(values, 'Sacks-Yards Lost'));
  return {
    firstDowns: integerStat(values, 'First Downs'),
    firstDownsPassing: integerStat(values, 'First Down Passing'),
    firstDownsRushing: integerStat(values, 'First Down Rushing'),
    firstDownsPenalty: integerStat(values, 'First Down Penalties'),
    totalPlays: integerStat(values, 'Total Offensive Plays'),
    totalYards: integerStat(values, 'Total Yards'),
    passingCompletions: integerStat(values, 'Completed Passes'),
    passingAttempts: integerStat(values, 'Attempted Passes'),
    passingYards: integerStat(values, 'Team Passing Yards'),
    passingInterceptions: integerStat(values, 'Thrown Interceptions'),
    rushingAttempts: integerStat(values, 'Rushing Attempts'),
    rushingYards: integerStat(values, 'Rushing Yards'),
    turnovers: integerStat(values, 'Turnovers'),
    fumblesLost: integerStat(values, 'Fumbles Lost'),
    sacks: sacks?.count ?? null,
    sackYardsLost: sacks?.yards ?? null,
    thirdDownConversions: integerStat(values, 'Third Down Conversions'),
    thirdDownAttempts: integerStat(values, 'Third Down Attempts'),
    fourthDownConversions: integerStat(values, 'Fourth Down Conversions'),
    fourthDownAttempts: integerStat(values, 'Forth Down Attempts'),
    penalties: integerStat(values, 'Penalties Commited'),
    penaltyYards: integerStat(values, 'Penalty Yards'),
    possessionSeconds: possessionSeconds(stringStat(values, 'Possession')),
    redZoneConversions: integerStat(values, 'Red Zone Conversions'),
    redZoneAttempts: integerStat(values, 'Red Zone Attempts'),
    totalDrives: integerStat(values, 'Total Drives'),
  };
}

function normalizePlayerStats(
  teamProviderId: string,
  player: HighlightlyBoxScoreResponse[number]['team']['boxScores'][number]['player'],
  statistics: readonly Statistic[],
): NormalizedCurrentGamePlayerStats {
  if (player.id === undefined) throw new Error('Player provider ID is required.');
  const displayName = player.fullName ?? player.name;
  if (displayName === undefined) throw new Error('Player display name is required.');
  const values = statisticMap(statistics);
  return {
    providerPlayerId: String(player.id),
    teamProviderId,
    displayName,
    passingCompletions: integerStat(values, 'Total Successful Passes'),
    passingAttempts: integerStat(values, 'Total Passes'),
    passingYards: signedIntegerStat(values, 'Total Passing Yards'),
    passingTouchdowns: integerStat(values, 'Total Passing Touchdowns'),
    passingInterceptions: integerStat(values, 'Total Passing Interceptions'),
    sacksSuffered: integerStat(values, 'Total Sacks'),
    sackYardsLost: integerStat(values, 'Total Sack Yards Lost'),
    rushingAttempts: integerStat(values, 'Total Rushing Attempts'),
    rushingYards: signedIntegerStat(values, 'Total Rushing Yards'),
    rushingTouchdowns: integerStat(values, 'Total Rushing Touchdowns'),
    longestRush: signedIntegerStat(values, 'Long Rushing'),
    targets: integerStat(values, 'Total Receiving Targets'),
    receptions: integerStat(values, 'Total Receptions'),
    receivingYards: signedIntegerStat(values, 'Total Receiving Yards'),
    receivingTouchdowns: integerStat(values, 'Total Receiving Touchdowns'),
    longestReception: signedIntegerStat(values, 'Total Long Receptions'),
    fumbles: integerStat(values, 'Total Fumbles'),
    fumbleRecoveries: integerStat(values, 'Total Recovered Fumbles'),
    tacklesTotal: integerStat(values, 'Total Defensive Tackles'),
    tacklesSolo: integerStat(values, 'Total Defensive Solo Tackles'),
    defensiveSacks: numberStat(values, 'Total Defensive Sacks'),
    tacklesForLoss: integerStat(values, 'Total Defensive Tackles For Loss'),
    passesDefended: integerStat(values, 'Total Defended Passes'),
    defensiveTouchdowns: integerStat(values, 'Total Defensive Touchdowns'),
    fieldGoalsMade: integerStat(values, 'Successful Field Goals Kicks'),
    fieldGoalsAttempted: integerStat(values, 'Attempted Field Goal Kicks'),
    longestFieldGoal: integerStat(values, 'Long Field Goals Kicks Made'),
    extraPointsMade: integerStat(values, 'Total Extra Kicking Points Made'),
    extraPointsAttempted: integerStat(values, 'Total Extra Kicking Point Attempts'),
    punts: integerStat(values, 'Total Punts'),
    puntYards: integerStat(values, 'Total Punting Yards'),
    puntAverage: numberStat(values, 'Average Gross Punting Yards'),
    puntsInside20: integerStat(values, 'Punts Inside 20 Yards'),
    puntTouchbacks: integerStat(values, 'Punting Touchbacks'),
    longestPunt: integerStat(values, 'Longest Punt Yardage'),
    kickReturns: integerStat(values, 'Total Kick Returns'),
    kickReturnYards: signedIntegerStat(values, 'Total Kick Return Yards'),
    kickReturnTouchdowns: integerStat(values, 'Total Kick Return Touchdowns'),
    longestKickReturn: signedIntegerStat(values, 'Longest Kick Return'),
    puntReturns: integerStat(values, 'Total Punt Returns'),
    puntReturnYards: signedIntegerStat(values, 'Total Punt Return Yards'),
    puntReturnTouchdowns: integerStat(values, 'Total Punt Return Touchdowns'),
    longestPuntReturn: signedIntegerStat(values, 'Longest Punt Return'),
  };
}

function statisticMap(
  statistics: readonly Statistic[],
): ReadonlyMap<string, readonly StatisticValue[]> {
  const values = new Map<string, StatisticValue[]>();
  for (const statistic of statistics) {
    const name = statistic.name ?? statistic.displayName;
    if (name === undefined) continue;
    values.set(name, [...(values.get(name) ?? []), statistic.value]);
  }
  return values;
}

function valueStat(
  values: ReadonlyMap<string, readonly StatisticValue[]>,
  name: string,
): StatisticValue | undefined {
  const candidates = values.get(name) ?? [];
  const defined = candidates.filter((value) => value !== null);
  if (defined.length === 0) return undefined;
  const first = defined[0];
  if (defined.some((value) => value !== first)) throw new Error(`Conflicting ${name} values.`);
  return first;
}

function integerStat(
  values: ReadonlyMap<string, readonly StatisticValue[]>,
  name: string,
): number | null {
  const value = valueStat(values, name);
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name} integer.`);
  }
  return value;
}

function signedIntegerStat(
  values: ReadonlyMap<string, readonly StatisticValue[]>,
  name: string,
): number | null {
  const value = valueStat(values, name);
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Invalid ${name} integer.`);
  }
  return value;
}

function numberStat(
  values: ReadonlyMap<string, readonly StatisticValue[]>,
  name: string,
): number | null {
  const value = valueStat(values, name);
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${name} number.`);
  }
  return value;
}

function stringStat(
  values: ReadonlyMap<string, readonly StatisticValue[]>,
  name: string,
): string | null {
  const value = valueStat(values, name);
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`Invalid ${name} string.`);
  return value;
}

function integerOrString(
  values: ReadonlyMap<string, readonly StatisticValue[]>,
  name: string,
): string | number | null {
  const value = valueStat(values, name);
  if (value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`Invalid ${name} value.`);
  }
  return value;
}

function parseCompoundCount(
  value: string | number | null,
): { count: number; yards: number } | null {
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) throw new Error('Invalid sack count.');
    return { count: value, yards: 0 };
  }
  const match = /^(\d+)\s*-\s*(\d+)$/.exec(value.trim());
  if (match?.[1] === undefined || match[2] === undefined) throw new Error('Invalid sacks-yards.');
  return { count: Number(match[1]), yards: Number(match[2]) };
}

function possessionSeconds(value: string | null): number | null {
  if (value === null) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match?.[1] === undefined || match[2] === undefined) throw new Error('Invalid possession.');
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (seconds > 59) throw new Error('Invalid possession seconds.');
  return minutes * 60 + seconds;
}

function parseScorePair(value: string | null): { home: number; away: number } | null {
  if (value === null) return null;
  const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) throw new Error('Invalid period score.');
  return { home: Number(match[1]), away: Number(match[2]) };
}

function emptyPeriodScores(): {
  -readonly [Key in keyof NormalizedCurrentGamePeriodScores]: number | null;
} {
  return {
    period1: null,
    period2: null,
    period3: null,
    period4: null,
    overtime1: null,
    overtime2: null,
  };
}

function failedBatch(
  client: HighlightlyEvaluationHttpClient,
  providerGameId: string,
  startedAt: number,
  reason: string,
): CurrentGameDetailsBatch {
  return {
    provider: HIGHLIGHTLY_PROVIDER_KEY,
    record: null,
    failures: [{ providerRecordId: providerGameId, reason }],
    requestsUsed: client.getRequestCount(),
    responseDurationMs: Math.round(performance.now() - startedAt),
  };
}

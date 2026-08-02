import { writeFile } from 'node:fs/promises';

import type { z } from 'zod';

import { mockNflTeamsFixture } from '../../providers/mock/nfl-teams.fixture.js';
import {
  assertCredentialSafeText,
  type ProviderEvaluationReport,
  type ProviderEvaluator,
  unavailableFact,
  untestedFact,
  verifiedFact,
} from '../provider-evaluation.js';
import {
  HighlightlyEvaluationError,
  type HighlightlyEvaluationHttpClient,
} from './highlightly-http-client.js';
import {
  highlightlyDetailedMatchSchema,
  highlightlyMatchSchema,
  highlightlyRawMatchDetailResponseSchema,
  highlightlyRawMatchListResponseSchema,
  highlightlyRawStandingListResponseSchema,
  highlightlyRawTeamsResponseSchema,
  highlightlyStandingResponseSchema,
  highlightlyTeamSchema,
  type HighlightlyDetailedMatch,
  type HighlightlyEvent,
  type HighlightlyMatch,
  type HighlightlyStandingResponse,
  type HighlightlyStructuredPlay,
  type HighlightlyTeam,
} from './highlightly-schemas.js';

const DOCUMENTATION_VERSION = '8.1.5';
const DOCUMENTATION_URL = 'https://highlightly.net/nfl-api/documentation/';
const TERMS_URL = 'https://highlightly.net/terms/';
const MAX_SCHEDULE_PAGES = 4;
const PAGE_LIMIT = 100;

type EvidenceLabel = 'directly_verified' | 'officially_documented' | 'inferred' | 'unverified';
type FieldState = 'present_populated' | 'present_nullable' | 'absent' | 'unverified';
type CapabilityState =
  'accessible_validated' | 'documented_not_tested' | 'unavailable' | 'unverified';
type AnimationState = 'supported' | 'partially_supported' | 'unsupported' | 'unverified';
type Suitability = 'passed' | 'passed_with_warnings' | 'failed' | 'unverified';

export interface HighlightlyFieldAssessment {
  readonly state: FieldState;
  readonly populated: number;
  readonly total: number;
  readonly note: string;
}

export interface HighlightlyCapabilityAssessment {
  readonly endpoint: string | null;
  readonly state: CapabilityState;
  readonly evidence: EvidenceLabel;
  readonly note: string;
}

export interface HighlightlyEvaluationResult {
  readonly summary: ProviderEvaluationReport;
  readonly documentation: {
    readonly version: string;
    readonly openApiVersion: '3.0.0';
    readonly documentationUrl: string;
    readonly evaluatedAt: string;
    readonly requiredEndpoints: readonly string[];
  };
  readonly accountPlan: string | null;
  readonly requestCount: number;
  readonly nflLeagueIdentifier: string;
  readonly availableSeasons: readonly number[];
  readonly currentSeasonSuitability: Suitability;
  readonly teams: {
    readonly returned: number;
    readonly malformedRecords: number;
    readonly uniqueIds: number;
    readonly deterministicallyMapped: number;
    readonly allCurrentTeamsMapped: boolean;
    readonly logoUrlPresent: number;
    readonly cityAndNameSeparated: boolean;
    readonly conferenceAvailable: boolean;
    readonly divisionAvailable: boolean;
    readonly inactiveOrHistoricTeamsObserved: number;
    readonly records: readonly {
      readonly providerTeamId: string;
      readonly fullName: string;
      readonly abbreviation: string;
      readonly mappedInternalAbbreviation: string | null;
      readonly logoUrlPresent: boolean;
    }[];
  };
  readonly schedule: {
    readonly season: number;
    readonly totalReported: number;
    readonly retrieved: number;
    readonly malformedRecords: number;
    readonly paginationRequired: boolean;
    readonly paginationComplete: boolean;
    readonly countsBySeasonType: Readonly<Record<'PRE' | 'REG' | 'POST' | 'OTHER', number>>;
    readonly earliestKickoff: string | null;
    readonly latestKickoff: string | null;
    readonly allKickoffsValidUtc: boolean;
    readonly uniqueTeamsObserved: number;
    readonly scheduledGamesWithNullableScore: number;
    readonly statusesObserved: readonly string[];
    readonly exceptionalStatusesObserved: readonly string[];
    readonly documentedExceptionalStatuses: readonly string[];
    readonly rescheduledStatusDocumented: boolean;
  };
  readonly gameFieldCoverage: Readonly<Record<string, HighlightlyFieldAssessment>>;
  readonly playByPlay: {
    readonly sourceEndpoint: '/matches/{id}';
    readonly completedGameInspected: boolean;
    readonly eventCount: number;
    readonly playCount: number;
    readonly appearsToBeDetailedPlayByPlay: boolean;
    readonly fields: Readonly<Record<string, HighlightlyFieldAssessment>>;
  };
  readonly animationSuitability: Readonly<
    Record<
      'level1BasicField' | 'level2DetailedReconstruction' | 'level3ExactReplay',
      {
        readonly state: AnimationState;
        readonly evidence: EvidenceLabel;
        readonly note: string;
      }
    >
  >;
  readonly liveUpdate: readonly {
    readonly topic: string;
    readonly value: string;
    readonly evidence: EvidenceLabel;
  }[];
  readonly capabilities: Readonly<Record<string, HighlightlyCapabilityAssessment>>;
  readonly rateLimit: {
    readonly limit: number | null;
    readonly remaining: number | null;
    readonly documentedPlanBehavior: string;
  };
  readonly licensing: {
    readonly termsVersion: string;
    readonly publishedFindings: readonly string[];
    readonly questionsRequiringWrittenConfirmation: readonly string[];
  };
  readonly finalRecommendation: string;
}

export interface HighlightlyEvaluatorOptions {
  readonly client: HighlightlyEvaluationHttpClient;
  readonly season: number;
  readonly priorRequestCount?: number;
  readonly now?: () => Date;
}

interface PlayRecord {
  readonly event: HighlightlyEvent;
  readonly play: string | HighlightlyStructuredPlay;
  readonly order: number;
}

interface ValidatedMatchPage {
  readonly data: readonly HighlightlyMatch[];
  readonly pagination: {
    readonly totalCount: number;
    readonly offset: number;
    readonly limit: number;
  };
  readonly plan?: {
    readonly tier?: string | undefined;
    readonly message?: string | undefined;
  };
  readonly failures: number;
}

export class HighlightlyEvaluator implements ProviderEvaluator {
  readonly providerName = 'Highlightly';
  private readonly client: HighlightlyEvaluationHttpClient;
  private readonly season: number;
  private readonly priorRequestCount: number;
  private readonly now: () => Date;
  private evaluationPromise: Promise<HighlightlyEvaluationResult> | undefined;

  constructor(options: HighlightlyEvaluatorOptions) {
    this.client = options.client;
    this.season = options.season;
    this.priorRequestCount = options.priorRequestCount ?? 0;
    this.now = options.now ?? (() => new Date());
  }

  async evaluate(): Promise<ProviderEvaluationReport> {
    return (await this.evaluateDetailed()).summary;
  }

  evaluateDetailed(): Promise<HighlightlyEvaluationResult> {
    this.evaluationPromise ??= this.performEvaluation();
    return this.evaluationPromise;
  }

  private async performEvaluation(): Promise<HighlightlyEvaluationResult> {
    const evaluatedAt = this.now().toISOString();
    const teamPayload = await this.client.get(
      '/teams',
      { league: 'NFL' },
      highlightlyRawTeamsResponseSchema,
    );
    const teamBatch = validateRecords(teamPayload, highlightlyTeamSchema);
    const firstPage = validateMatchPage(
      await this.client.get(
        '/matches',
        { league: 'NFL', season: this.season, limit: PAGE_LIMIT, offset: 0, timezone: 'Etc/UTC' },
        highlightlyRawMatchListResponseSchema,
      ),
    );

    if (firstPage.data.length === 0) {
      return buildResult({
        teams: teamBatch.records,
        malformedTeamRecords: teamBatch.failures,
        matches: [],
        malformedGameRecords: firstPage.failures,
        scheduleTotal: firstPage.pagination.totalCount,
        paginationRequired: firstPage.pagination.totalCount > firstPage.pagination.limit,
        paginationComplete: firstPage.pagination.totalCount === 0,
        plan: firstPage.plan?.tier ?? null,
        detail: null,
        standings: null,
        season: this.season,
        availableSeasons: [],
        requestCount: this.priorRequestCount + this.client.getRequestCount(),
        evaluatedAt,
        rateLimit: this.client.getRateLimitObservation(),
      });
    }

    const schedule = await this.fetchRemainingSchedule(firstPage);
    const availableSeasons = [this.season];
    let completedMatch = schedule.matches.find(isCompletedMatch);
    if (completedMatch === undefined && this.client.getRequestCount() < 7) {
      const historicalPayload = await this.tryOptionalGet(
        '/matches',
        {
          league: 'NFL',
          season: this.season - 1,
          limit: PAGE_LIMIT,
          offset: 0,
          timezone: 'Etc/UTC',
        },
        highlightlyRawMatchListResponseSchema,
      );
      const historicalPage =
        historicalPayload === null ? null : validateMatchPage(historicalPayload);
      completedMatch = historicalPage?.data.find(isCompletedMatch);
      if (historicalPage !== null && historicalPage.data.length > 0) {
        availableSeasons.push(this.season - 1);
      }
    }

    const detailPayload =
      completedMatch === undefined || this.client.getRequestCount() >= 8
        ? null
        : await this.tryOptionalGet(
            `/matches/${String(completedMatch.id)}`,
            {},
            highlightlyRawMatchDetailResponseSchema,
          );
    const detail =
      detailPayload === null
        ? null
        : (validateRecords(detailPayload, highlightlyDetailedMatchSchema).records.at(0) ?? null);
    const standingsPayload =
      this.client.getRequestCount() >= 8
        ? null
        : await this.tryOptionalGet(
            '/standings',
            { leagueType: 'NFL', year: this.season, limit: 10, offset: 0 },
            highlightlyRawStandingListResponseSchema,
          );
    const standings =
      standingsPayload === null
        ? null
        : (validateRecords(standingsPayload.data, highlightlyStandingResponseSchema).records.at(
            0,
          ) ?? null);

    return buildResult({
      teams: teamBatch.records,
      malformedTeamRecords: teamBatch.failures,
      matches: schedule.matches,
      malformedGameRecords: schedule.failures,
      scheduleTotal: firstPage.pagination.totalCount,
      paginationRequired: firstPage.pagination.totalCount > firstPage.pagination.limit,
      paginationComplete: schedule.complete,
      plan: firstPage.plan?.tier ?? null,
      detail,
      standings,
      season: this.season,
      availableSeasons,
      requestCount: this.priorRequestCount + this.client.getRequestCount(),
      evaluatedAt,
      rateLimit: this.client.getRateLimitObservation(),
    });
  }

  private async fetchRemainingSchedule(firstPage: ValidatedMatchPage): Promise<{
    readonly matches: readonly HighlightlyMatch[];
    readonly complete: boolean;
    readonly failures: number;
  }> {
    const matches = [...firstPage.data];
    let failures = firstPage.failures;
    let offset = firstPage.pagination.offset + firstPage.pagination.limit;
    let pages = 1;
    while (offset < firstPage.pagination.totalCount && pages < MAX_SCHEDULE_PAGES) {
      const page = validateMatchPage(
        await this.client.get(
          '/matches',
          {
            league: 'NFL',
            season: this.season,
            limit: PAGE_LIMIT,
            offset,
            timezone: 'Etc/UTC',
          },
          highlightlyRawMatchListResponseSchema,
        ),
      );
      matches.push(...page.data);
      failures += page.failures;
      offset += page.pagination.limit;
      pages += 1;
      if (page.data.length === 0) break;
    }
    const unique = new Map(matches.map((match) => [String(match.id), match]));
    return {
      matches: [...unique.values()],
      complete: unique.size >= firstPage.pagination.totalCount,
      failures,
    };
  }

  private async tryOptionalGet<T extends z.ZodType>(
    path: string,
    parameters: Readonly<Record<string, string | number | undefined>>,
    schema: T,
  ): Promise<z.output<T> | null> {
    try {
      return await this.client.get(path, parameters, schema);
    } catch (error: unknown) {
      if (
        error instanceof HighlightlyEvaluationError &&
        error.code === 'INVALID_REQUEST' &&
        error.statusCode !== null
      ) {
        return null;
      }
      throw error;
    }
  }
}

function validateMatchPage(
  payload: z.output<typeof highlightlyRawMatchListResponseSchema>,
): ValidatedMatchPage {
  const batch = validateRecords(payload.data, highlightlyMatchSchema);
  return {
    data: batch.records,
    pagination: payload.pagination,
    ...(payload.plan === undefined ? {} : { plan: payload.plan }),
    failures: batch.failures,
  };
}

function validateRecords<T>(
  payload: readonly unknown[],
  schema: z.ZodType<T>,
): { readonly records: readonly T[]; readonly failures: number } {
  const records: T[] = [];
  let failures = 0;
  for (const candidate of payload) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) records.push(parsed.data);
    else failures += 1;
  }
  return { records, failures };
}

interface ResultInput {
  readonly teams: readonly HighlightlyTeam[];
  readonly malformedTeamRecords: number;
  readonly matches: readonly HighlightlyMatch[];
  readonly malformedGameRecords: number;
  readonly scheduleTotal: number;
  readonly paginationRequired: boolean;
  readonly paginationComplete: boolean;
  readonly plan: string | null;
  readonly detail: HighlightlyDetailedMatch | null;
  readonly standings: HighlightlyStandingResponse | null;
  readonly season: number;
  readonly availableSeasons: readonly number[];
  readonly requestCount: number;
  readonly evaluatedAt: string;
  readonly rateLimit: { readonly limit: number | null; readonly remaining: number | null };
}

function buildResult(input: ResultInput): HighlightlyEvaluationResult {
  const teamAnalysis = analyzeTeams(input.teams, input.malformedTeamRecords);
  const schedule = analyzeSchedule(
    input.matches,
    input.scheduleTotal,
    input.paginationRequired,
    input.paginationComplete,
    input.season,
    input.malformedGameRecords,
  );
  const playRecords = toPlayRecords(input.detail?.events ?? []);
  const playFields = analyzePlayFields(playRecords, input.detail !== null);
  const gameFields = analyzeGameFields(input.matches, input.detail);
  const currentSeasonSuitability = classifyCurrentSeasonSuitability(
    schedule,
    teamAnalysis,
    input.paginationComplete,
  );
  const summary = buildProviderSummary(
    input,
    teamAnalysis,
    schedule,
    gameFields,
    playFields,
    currentSeasonSuitability,
  );
  const capabilities = buildCapabilities(input.detail, input.standings);
  const animationSuitability = classifyAnimation(playRecords, playFields, input.detail !== null);

  return {
    summary,
    documentation: {
      version: DOCUMENTATION_VERSION,
      openApiVersion: '3.0.0',
      documentationUrl: DOCUMENTATION_URL,
      evaluatedAt: input.evaluatedAt,
      requiredEndpoints: [
        '/teams',
        '/matches',
        '/matches/{id}',
        '/standings',
        '/lineups/{matchId}',
        '/players',
        '/players/{id}/statistics',
        '/box-score/{matchId}',
      ],
    },
    accountPlan: input.plan,
    requestCount: input.requestCount,
    nflLeagueIdentifier: 'NFL',
    availableSeasons: [...input.availableSeasons].sort(),
    currentSeasonSuitability,
    teams: teamAnalysis,
    schedule,
    gameFieldCoverage: gameFields,
    playByPlay: {
      sourceEndpoint: '/matches/{id}',
      completedGameInspected: input.detail !== null && isCompletedMatch(input.detail),
      eventCount: input.detail?.events?.length ?? 0,
      playCount: playRecords.length,
      appearsToBeDetailedPlayByPlay: hasDetailedPlayByPlay(playFields),
      fields: playFields,
    },
    animationSuitability,
    liveUpdate: buildLiveUpdateFindings(input.detail),
    capabilities,
    rateLimit: {
      ...input.rateLimit,
      documentedPlanBehavior:
        'Official docs expose daily quota headers; published terms describe daily quotas and per-minute throttling. Match lists document a one-minute refresh interval.',
    },
    licensing: buildLicensingQuestions(),
    finalRecommendation: buildRecommendation(currentSeasonSuitability, animationSuitability),
  };
}

function analyzeTeams(
  teams: readonly HighlightlyTeam[],
  malformedRecords: number,
): HighlightlyEvaluationResult['teams'] {
  const internalByAbbreviation = new Map(
    mockNflTeamsFixture.map((team) => [team.abbreviation.toUpperCase(), team]),
  );
  const internalByName = new Map(
    mockNflTeamsFixture.map((team) => [normalizeName(team.fullName), team]),
  );
  const records = teams.map((team) => {
    const mapped =
      internalByAbbreviation.get(team.abbreviation.toUpperCase()) ??
      internalByName.get(normalizeName(team.displayName)) ??
      null;
    return {
      providerTeamId: String(team.id),
      fullName: team.displayName,
      abbreviation: team.abbreviation,
      mappedInternalAbbreviation: mapped?.abbreviation ?? null,
      logoUrlPresent: team.logo !== undefined && team.logo !== null,
    };
  });
  const mapped = new Set(
    records.flatMap((record) =>
      record.mappedInternalAbbreviation === null ? [] : [record.mappedInternalAbbreviation],
    ),
  );
  return {
    returned: teams.length,
    malformedRecords,
    uniqueIds: new Set(teams.map((team) => String(team.id))).size,
    deterministicallyMapped: mapped.size,
    allCurrentTeamsMapped: mapped.size === mockNflTeamsFixture.length,
    logoUrlPresent: teams.filter((team) => team.logo !== undefined && team.logo !== null).length,
    cityAndNameSeparated: teams.every(
      (team) => team.displayName.length > team.name.length && team.displayName.endsWith(team.name),
    ),
    conferenceAvailable: false,
    divisionAvailable: false,
    inactiveOrHistoricTeamsObserved: records.filter(
      (record) => record.mappedInternalAbbreviation === null,
    ).length,
    records,
  };
}

function analyzeSchedule(
  matches: readonly HighlightlyMatch[],
  totalReported: number,
  paginationRequired: boolean,
  paginationComplete: boolean,
  season: number,
  malformedRecords: number,
): HighlightlyEvaluationResult['schedule'] {
  const dates = matches.map((match) => match.date).sort();
  const statuses = [...new Set(matches.map(observedStatus))].sort();
  const exceptional = new Set(['Postponed', 'Suspended', 'Cancelled', 'Abandoned']);
  const counts = { PRE: 0, REG: 0, POST: 0, OTHER: 0 };
  for (const match of matches) counts[classifySeasonType(match.round)] += 1;
  const teams = matches.flatMap((match) => [String(match.homeTeam.id), String(match.awayTeam.id)]);
  return {
    season,
    totalReported,
    retrieved: matches.length,
    malformedRecords,
    paginationRequired,
    paginationComplete,
    countsBySeasonType: counts,
    earliestKickoff: dates.at(0) ?? null,
    latestKickoff: dates.at(-1) ?? null,
    allKickoffsValidUtc: matches.every(
      (match) => !Number.isNaN(Date.parse(match.date)) && match.date.endsWith('Z'),
    ),
    uniqueTeamsObserved: new Set(teams).size,
    scheduledGamesWithNullableScore: matches.filter(
      (match) =>
        observedStatus(match).toLowerCase() === 'scheduled' &&
        (match.state.score?.current === undefined || match.state.score.current === null),
    ).length,
    statusesObserved: statuses,
    exceptionalStatusesObserved: statuses.filter((status) => exceptional.has(status)),
    documentedExceptionalStatuses: ['Postponed', 'Suspended', 'Cancelled', 'Abandoned'],
    rescheduledStatusDocumented: false,
  };
}

function analyzeGameFields(
  matches: readonly HighlightlyMatch[],
  detail: HighlightlyDetailedMatch | null,
): Readonly<Record<string, HighlightlyFieldAssessment>> {
  if (matches.length === 0) return unverifiedFields(GAME_FIELD_NAMES, 'No 2026 games returned.');
  return {
    providerGameId: assess(matches, (match) => match.id, 'Provider match ID.'),
    season: assess(matches, (match) => match.season, 'Explicit season field.'),
    seasonType: assess(
      matches,
      (match) =>
        classifySeasonType(match.round) === 'OTHER' ? null : classifySeasonType(match.round),
      'Derived from the round string; no dedicated season-type field is documented.',
    ),
    week: assess(
      matches,
      () => undefined,
      'No dedicated week field is documented; some round strings may encode a week.',
    ),
    startTime: assess(matches, (match) => match.date, 'ISO kickoff timestamp.'),
    status: assess(matches, observedStatus, 'State description or report.'),
    homeTeam: assess(matches, (match) => match.homeTeam.id, 'Home team record.'),
    awayTeam: assess(matches, (match) => match.awayTeam.id, 'Away team record.'),
    homeScore: assess(
      matches,
      () => undefined,
      'The list response exposes a combined score string, not separate home and away fields.',
    ),
    awayScore: assess(
      matches,
      () => undefined,
      'The list response exposes a combined score string, not separate home and away fields.',
    ),
    quarter: assess(matches, (match) => match.state.period, 'State period field.'),
    gameClock: assess(matches, (match) => match.state.clock, 'State clock field.'),
    venue: assessDetail(detail, (match) => match.venue?.name, 'Detailed-match sample.'),
    neutralSite: assessDetail(
      detail,
      (match) => match.neutralSite,
      'Not present in the documented list response.',
    ),
    broadcast: assessDetail(
      detail,
      (match) => match.broadcast,
      'Not present in the documented list response.',
    ),
    lastUpdated: assessDetail(
      detail,
      (match) => match.updatedAt,
      'Not present in the documented list response.',
    ),
  };
}

const GAME_FIELD_NAMES = [
  'providerGameId',
  'season',
  'seasonType',
  'week',
  'startTime',
  'status',
  'homeTeam',
  'awayTeam',
  'homeScore',
  'awayScore',
  'quarter',
  'gameClock',
  'venue',
  'neutralSite',
  'broadcast',
  'lastUpdated',
] as const;

const PLAY_FIELD_NAMES = [
  'playId',
  'playSequence',
  'driveId',
  'quarter',
  'gameClock',
  'down',
  'distance',
  'possession',
  'yardLine',
  'sideOfField',
  'startPosition',
  'endPosition',
  'playType',
  'description',
  'yardsGained',
  'firstDown',
  'scoringResult',
  'touchdown',
  'passDirection',
  'passDepth',
  'rushDirection',
  'passer',
  'receiverOrTarget',
  'rusher',
  'tacklers',
  'sackParticipants',
  'interceptionParticipants',
  'fumbleParticipants',
  'recoveryParticipants',
  'penalties',
  'kickDetails',
  'puntDetails',
  'reviewsOrOverturns',
  'correctionOrDeletion',
  'teamStatistics',
  'playerStatistics',
  'trackingCoordinates',
] as const;

function analyzePlayFields(
  records: readonly PlayRecord[],
  detailInspected: boolean,
): Readonly<Record<string, HighlightlyFieldAssessment>> {
  if (!detailInspected)
    return unverifiedFields(PLAY_FIELD_NAMES, 'No completed game was inspected.');
  if (records.length === 0)
    return absentFields(
      PLAY_FIELD_NAMES,
      'The inspected detailed match contained no play records.',
    );
  const structured = (record: PlayRecord): HighlightlyStructuredPlay | null =>
    typeof record.play === 'string' ? null : record.play;
  return {
    playId: assess(records, (record) => structured(record)?.id, 'Structured play ID.'),
    playSequence: assess(
      records,
      (record) => structured(record)?.sequence,
      'Array order exists, but this field measures an explicit provider sequence.',
    ),
    driveId: assess(
      records,
      (record) => structured(record)?.driveId ?? record.event.id,
      'Explicit play or event identifier.',
    ),
    quarter: assess(
      records,
      (record) => structured(record)?.quarter ?? record.event.start?.period,
      'Play or enclosing-event period.',
    ),
    gameClock: assess(
      records,
      (record) => structured(record)?.clock ?? record.event.start?.clock,
      'Play or enclosing-event clock.',
    ),
    down: assess(records, (record) => structured(record)?.down, 'Structured play field.'),
    distance: assess(records, (record) => structured(record)?.distance, 'Structured play field.'),
    possession: assess(
      records,
      (record) => structured(record)?.possession ?? record.event.team?.displayName,
      'Play possession or enclosing-event team.',
    ),
    yardLine: assess(
      records,
      (record) => structured(record)?.yardLine ?? record.event.start?.yardLine,
      'Play or enclosing-event start yard line.',
    ),
    sideOfField: assess(
      records,
      (record) => structured(record)?.sideOfField ?? record.event.start?.sideOfField,
      'Structured play or enclosing-event field.',
    ),
    startPosition: assess(
      records,
      (record) => structured(record)?.startPosition ?? record.event.start?.yardLine,
      'Structured value or enclosing-event start yard line.',
    ),
    endPosition: assess(
      records,
      (record) => structured(record)?.endPosition ?? record.event.end?.yardLine,
      'Structured value or enclosing-event end yard line.',
    ),
    playType: assess(
      records,
      (record) => structured(record)?.type ?? record.event.result,
      'Structured play type or enclosing-event result.',
    ),
    description: assess(
      records,
      (record) => (typeof record.play === 'string' ? record.play : record.play.description),
      'Play text.',
    ),
    yardsGained: assess(
      records,
      (record) => structured(record)?.yardsGained,
      'Structured play field.',
    ),
    firstDown: assess(records, (record) => structured(record)?.firstDown, 'Structured play field.'),
    scoringResult: assess(
      records,
      (record) => structured(record)?.scoringPlay ?? record.event.isScoringPlay,
      'Play or enclosing-event scoring flag.',
    ),
    touchdown: assess(records, (record) => structured(record)?.touchdown, 'Structured play field.'),
    passDirection: assess(
      records,
      (record) => structured(record)?.passDirection,
      'Structured play field.',
    ),
    passDepth: assess(records, (record) => structured(record)?.passDepth, 'Structured play field.'),
    rushDirection: assess(
      records,
      (record) => structured(record)?.rushDirection,
      'Structured play field.',
    ),
    passer: assess(records, (record) => structured(record)?.passer, 'Structured participant.'),
    receiverOrTarget: assess(
      records,
      (record) => structured(record)?.receiver ?? structured(record)?.target,
      'Structured participant.',
    ),
    rusher: assess(records, (record) => structured(record)?.rusher, 'Structured participant.'),
    tacklers: assess(records, (record) => structured(record)?.tacklers, 'Structured participants.'),
    sackParticipants: assess(
      records,
      (record) => structured(record)?.sacks,
      'Structured participants.',
    ),
    interceptionParticipants: assess(
      records,
      (record) => structured(record)?.interceptions,
      'Structured participants.',
    ),
    fumbleParticipants: assess(
      records,
      (record) => structured(record)?.fumbles,
      'Structured participants.',
    ),
    recoveryParticipants: assess(
      records,
      (record) => structured(record)?.recoveries,
      'Structured participants.',
    ),
    penalties: assess(records, (record) => structured(record)?.penalties, 'Structured play field.'),
    kickDetails: assess(records, (record) => structured(record)?.kick, 'Structured play field.'),
    puntDetails: assess(records, (record) => structured(record)?.punt, 'Structured play field.'),
    reviewsOrOverturns: assess(
      records,
      (record) => structured(record)?.review,
      'Structured play field.',
    ),
    correctionOrDeletion: assess(
      records,
      (record) => structured(record)?.corrected ?? structured(record)?.deleted,
      'Structured correction indicator.',
    ),
    teamStatistics: assess(
      records,
      (record) => structured(record)?.teamStatistics,
      'Statistics attached to an individual play.',
    ),
    playerStatistics: assess(
      records,
      (record) => structured(record)?.playerStatistics,
      'Statistics attached to an individual play.',
    ),
    trackingCoordinates: assess(
      records,
      (record) => structured(record)?.trackingCoordinates,
      'Time-series player or football coordinates.',
    ),
  };
}

function buildProviderSummary(
  input: ResultInput,
  teams: HighlightlyEvaluationResult['teams'],
  schedule: HighlightlyEvaluationResult['schedule'],
  gameFields: Readonly<Record<string, HighlightlyFieldAssessment>>,
  playFields: Readonly<Record<string, HighlightlyFieldAssessment>>,
  suitability: Suitability,
): ProviderEvaluationReport {
  const coverage = (name: string) => {
    const assessment = gameFields[name];
    return {
      present: assessment?.populated ?? 0,
      total: assessment?.total ?? 0,
      percentage:
        assessment === undefined || assessment.total === 0
          ? 0
          : (assessment.populated / assessment.total) * 100,
    };
  };
  const playCoverage = Object.fromEntries(
    Object.entries(playFields).map(([name, assessment]) => [
      name,
      {
        present: assessment.populated,
        total: assessment.total,
        percentage: assessment.total === 0 ? 0 : (assessment.populated / assessment.total) * 100,
      },
    ]),
  );
  return {
    providerName: 'Highlightly',
    availableNflSeasons: verifiedFact([...input.availableSeasons].sort()),
    currentSeasonAvailability: verifiedFact(input.matches.length > 0),
    teamCount: verifiedFact(teams.returned),
    gameCountBySeasonType: {
      [String(input.season)]: {
        PRE: verifiedFact(schedule.countsBySeasonType.PRE),
        REG: verifiedFact(schedule.countsBySeasonType.REG),
        POST: verifiedFact(schedule.countsBySeasonType.POST),
      },
    },
    earliestGameDate:
      schedule.earliestKickoff === null
        ? unavailableFact('No current-season kickoff was returned.')
        : verifiedFact(schedule.earliestKickoff),
    latestGameDate:
      schedule.latestKickoff === null
        ? unavailableFact('No current-season kickoff was returned.')
        : verifiedFact(schedule.latestKickoff),
    statusValuesObserved:
      schedule.statusesObserved.length === 0
        ? unavailableFact('No current-season status was returned.')
        : verifiedFact([...schedule.statusesObserved]),
    requiredFieldCoverage:
      input.matches.length === 0
        ? unavailableFact('No current-season games were available for field inspection.')
        : verifiedFact({
            providerGameId: coverage('providerGameId'),
            season: coverage('season'),
            seasonType: coverage('seasonType'),
            startTime: coverage('startTime'),
            status: coverage('status'),
            homeTeam: coverage('homeTeam'),
            awayTeam: coverage('awayTeam'),
          }),
    nullableFieldCoverage:
      input.matches.length === 0
        ? unavailableFact('No current-season games were available for nullable-field inspection.')
        : verifiedFact({
            scores: coverage('homeScore'),
            quarter: coverage('quarter'),
            clock: coverage('gameClock'),
            venue: coverage('venue'),
            neutralSite: coverage('neutralSite'),
            broadcast: coverage('broadcast'),
            providerLastUpdatedAt: coverage('lastUpdated'),
          }),
    playByPlayEndpointAvailability:
      input.detail === null
        ? untestedFact('No completed-game detail response was available.')
        : verifiedFact((input.detail.events?.length ?? 0) > 0),
    playByPlayFieldCoverage:
      input.detail === null
        ? untestedFact('No completed-game event fields were inspected.')
        : verifiedFact(playCoverage),
    estimatedRequestCount: input.requestCount,
    evaluationTimestamp: input.evaluatedAt,
    findings: [
      {
        level: input.matches.length > 0 ? 'pass' : 'failure',
        code: 'CURRENT_SEASON_SUITABILITY',
        message:
          input.matches.length > 0
            ? `Highlightly returned ${String(input.matches.length)} validated ${String(input.season)} NFL schedule records.`
            : `Highlightly returned no validated ${String(input.season)} NFL schedule records.`,
        evidenceState: 'verified',
      },
      {
        level: teams.allCurrentTeamsMapped ? 'pass' : 'warning',
        code: 'TEAM_MAPPING',
        message: `${String(teams.deterministicallyMapped)} of 32 current NFL teams mapped deterministically.`,
        evidenceState: 'verified',
      },
      {
        level: input.paginationComplete ? 'pass' : 'warning',
        code: 'SCHEDULE_PAGINATION',
        message: input.paginationComplete
          ? 'The bounded schedule retrieval was complete.'
          : 'The schedule exceeded the bounded four-page evaluation limit.',
        evidenceState: 'verified',
      },
      {
        level: input.malformedTeamRecords + input.malformedGameRecords === 0 ? 'pass' : 'warning',
        code: 'RECORD_VALIDATION',
        message:
          input.malformedTeamRecords + input.malformedGameRecords === 0
            ? 'All inspected team and schedule records passed runtime validation.'
            : `${String(input.malformedTeamRecords)} team and ${String(input.malformedGameRecords)} schedule records were rejected safely.`,
        evidenceState: 'verified',
      },
      {
        level: suitability === 'passed' ? 'pass' : suitability === 'failed' ? 'failure' : 'warning',
        code: 'PRIMARY_PROVIDER_RECOMMENDATION',
        message: `Current-season technical suitability was classified as ${suitability.replaceAll('_', ' ')}.`,
        evidenceState: 'verified',
      },
      {
        level: 'warning',
        code: 'LICENSING_CONFIRMATION_REQUIRED',
        message:
          'Published terms do not grant publication or logo rights; written rights confirmation is required.',
        evidenceState: 'verified',
      },
      {
        level: 'warning',
        code: 'LIVE_LATENCY_UNVERIFIED',
        message: 'Live latency and correction behavior were not directly tested.',
        evidenceState: 'untested',
      },
    ],
  };
}

function buildCapabilities(
  detail: HighlightlyDetailedMatch | null,
  standings: HighlightlyStandingResponse | null,
): HighlightlyEvaluationResult['capabilities'] {
  const detailCapability = (present: boolean, note: string): HighlightlyCapabilityAssessment => ({
    endpoint: '/matches/{id}',
    state: detail === null ? 'unverified' : present ? 'accessible_validated' : 'unavailable',
    evidence: detail === null ? 'unverified' : 'directly_verified',
    note,
  });
  return {
    teamGameStatistics: detailCapability(
      detail?.matchStatistics !== undefined && detail.matchStatistics !== null,
      'Team match statistics are documented in detailed match responses.',
    ),
    playerGameStatistics: detailCapability(
      detail?.boxScores !== undefined && detail.boxScores !== null,
      'Player box scores are documented in detailed matches and at /box-score/{matchId}.',
    ),
    seasonTeamStatistics: {
      endpoint: '/teams/statistics/{id}',
      state: 'documented_not_tested',
      evidence: 'officially_documented',
      note: 'Not called to conserve requests.',
    },
    seasonPlayerStatistics: {
      endpoint: '/players/{id}/statistics',
      state: 'documented_not_tested',
      evidence: 'officially_documented',
      note: 'Not called to conserve requests.',
    },
    standings: {
      endpoint: '/standings',
      state: standings === null ? 'unavailable' : 'accessible_validated',
      evidence: 'directly_verified',
      note:
        standings === null ? 'No validated response was obtained.' : 'Runtime response validated.',
    },
    depthCharts: {
      endpoint: null,
      state: 'unverified',
      evidence: 'officially_documented',
      note: 'Marketing and the docs introduction mention depth charts, but OpenAPI 8.1.5 has no depth-chart path.',
    },
    rosters: {
      endpoint: '/lineups/{matchId}',
      state: 'documented_not_tested',
      evidence: 'officially_documented',
      note: 'Lineups are documented; full roster semantics are unverified.',
    },
    injuries: detailCapability(
      detail?.injuries !== undefined && detail.injuries !== null,
      'Injuries are documented in detailed match responses.',
    ),
    predictions: detailCapability(
      detail?.predictions !== undefined && detail.predictions !== null,
      'Predictions are documented in detailed match responses.',
    ),
    odds: {
      endpoint: '/odds',
      state: 'documented_not_tested',
      evidence: 'officially_documented',
      note: 'The endpoint is documented as unavailable on the Basic/free plan and was not called.',
    },
  };
}

function classifyAnimation(
  records: readonly PlayRecord[],
  fields: Readonly<Record<string, HighlightlyFieldAssessment>>,
  detailInspected: boolean,
): HighlightlyEvaluationResult['animationSuitability'] {
  if (!detailInspected) {
    const unverified = {
      state: 'unverified',
      evidence: 'unverified',
      note: 'No completed game was inspected.',
    } as const;
    return {
      level1BasicField: unverified,
      level2DetailedReconstruction: unverified,
      level3ExactReplay: unverified,
    };
  }
  const hasEvents = records.length > 0;
  const level1Fields = ['possession', 'startPosition', 'endPosition', 'playType', 'description'];
  const level1Populated = level1Fields.filter((name) => (fields[name]?.populated ?? 0) > 0).length;
  const level2Fields = [
    'down',
    'distance',
    'rusher',
    'tacklers',
    'penalties',
    'startPosition',
    'endPosition',
  ];
  const level2Populated = level2Fields.filter((name) => (fields[name]?.populated ?? 0) > 0).length;
  const hasDirection =
    (fields.passDirection?.populated ?? 0) > 0 || (fields.rushDirection?.populated ?? 0) > 0;
  const coordinates = fields.trackingCoordinates?.populated ?? 0;
  return {
    level1BasicField: {
      state: !hasEvents
        ? 'unsupported'
        : level1Populated === level1Fields.length
          ? 'supported'
          : 'partially_supported',
      evidence: 'directly_verified',
      note: 'Classification uses possession, field position, result/type, array order, and description coverage.',
    },
    level2DetailedReconstruction: {
      state:
        !hasEvents || level2Populated === 0
          ? 'unsupported'
          : level2Populated === level2Fields.length && hasDirection
            ? 'supported'
            : 'partially_supported',
      evidence: 'directly_verified',
      note: 'Requires structured down, distance, direction, participants, penalties, turnovers, and positions.',
    },
    level3ExactReplay: {
      state: coordinates > 0 ? 'supported' : 'unsupported',
      evidence: 'directly_verified',
      note: 'Exact replay requires time-series X/Y coordinates for every player and the football.',
    },
  };
}

function buildLiveUpdateFindings(
  detail: HighlightlyDetailedMatch | null,
): HighlightlyEvaluationResult['liveUpdate'] {
  return [
    {
      topic: 'polling frequency',
      value: 'Match lists document a one-minute refresh interval.',
      evidence: 'officially_documented',
    },
    {
      topic: 'live latency',
      value: 'Marketing says near real time; latency was not measured.',
      evidence: 'officially_documented',
    },
    {
      topic: 'delta updates',
      value: 'No delta cursor or revision stream appears in OpenAPI 8.1.5.',
      evidence: 'inferred',
    },
    {
      topic: 'push transport',
      value: 'No WebSocket, SSE, webhook, or push endpoint appears in OpenAPI 8.1.5.',
      evidence: 'inferred',
    },
    {
      topic: 'full-game polling',
      value: 'The REST match-detail endpoint returns the current full detail representation.',
      evidence: detail === null ? 'officially_documented' : 'directly_verified',
    },
    {
      topic: 'completed-play corrections',
      value:
        'The docs say match details may be updated, but play correction/replacement semantics are not documented.',
      evidence: 'unverified',
    },
  ];
}

function buildLicensingQuestions(): HighlightlyEvaluationResult['licensing'] {
  return {
    termsVersion: 'July 24, 2026',
    publishedFindings: [
      `Published terms (${TERMS_URL}) say Highlightly does not grant a license to publish or redistribute API data.`,
      'Published terms prohibit systematic extraction or reuse of the whole or a substantial part of the database without prior written authorization.',
      'Published terms state that team logos, league marks, player images, and other third-party assets are not licensed by the subscription.',
      'Published terms allow applications built with factual data but prohibit reselling or proxying direct API access.',
      'Published terms describe plan-specific daily quotas and per-minute throttling; overage behavior beyond blocking/throttling is not specified.',
    ],
    questionsRequiringWrittenConfirmation: [
      'Commercial public display and use behind paid subscriptions',
      'Caching and long-term storage of schedules, statistics, standings, and play descriptions',
      'Derived analytics and AI model training',
      'Team-logo display, caching, or CDN hosting and required NFL/team trademark permissions',
      'Transformation of play-by-play into generated play animations',
      'Republishing full play descriptions',
      'Video-highlight embedding, source-specific rights, and attribution',
      'Required provider attribution',
      'Rate-limit overages and higher-volume production polling terms',
    ],
  };
}

function classifyCurrentSeasonSuitability(
  schedule: HighlightlyEvaluationResult['schedule'],
  teams: HighlightlyEvaluationResult['teams'],
  paginationComplete: boolean,
): Suitability {
  if (schedule.retrieved === 0) return 'failed';
  if (!schedule.allKickoffsValidUtc || schedule.uniqueTeamsObserved < 32) return 'failed';
  if (!teams.allCurrentTeamsMapped || !paginationComplete || schedule.countsBySeasonType.OTHER > 0)
    return 'passed_with_warnings';
  return 'passed_with_warnings';
}

function buildRecommendation(
  suitability: Suitability,
  animation: HighlightlyEvaluationResult['animationSuitability'],
): string {
  if (suitability === 'failed')
    return 'Do not implement Highlightly as the primary 2026 NFL adapter for this account because the real current-season schedule requirement failed.';
  if (suitability === 'unverified')
    return 'Do not implement a full adapter until current-season schedule access is directly verified.';
  return `Do not promote Highlightly to the primary provider yet. Technical schedule suitability is ${suitability.replaceAll('_', ' ')}, Level 2 animation is ${animation.level2DetailedReconstruction.state.replaceAll('_', ' ')}, and published terms require written publication, storage, transformation, and logo-rights confirmation.`;
}

function hasDetailedPlayByPlay(
  fields: Readonly<Record<string, HighlightlyFieldAssessment>>,
): boolean {
  return ['down', 'distance', 'possession', 'yardLine', 'description'].every(
    (field) => (fields[field]?.populated ?? 0) > 0,
  );
}

function toPlayRecords(events: readonly HighlightlyEvent[]): readonly PlayRecord[] {
  let order = 0;
  return events.flatMap((event) =>
    (event.plays ?? []).map((play) => ({ event, play, order: order++ })),
  );
}

function assess<T>(
  records: readonly T[],
  read: (record: T) => unknown,
  note: string,
): HighlightlyFieldAssessment {
  const values = records.map(read);
  const populated = values.filter(isPopulated).length;
  const nullable = values.some((value) => value === null || value === undefined);
  return {
    state: populated === 0 ? 'absent' : nullable ? 'present_nullable' : 'present_populated',
    populated,
    total: records.length,
    note,
  };
}

function assessDetail(
  detail: HighlightlyDetailedMatch | null,
  read: (detail: HighlightlyDetailedMatch) => unknown,
  note: string,
): HighlightlyFieldAssessment {
  return detail === null
    ? { state: 'unverified', populated: 0, total: 0, note }
    : assess([detail], read, note);
}

function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function unverifiedFields(
  names: readonly string[],
  note: string,
): Readonly<Record<string, HighlightlyFieldAssessment>> {
  return Object.fromEntries(
    names.map((name) => [name, { state: 'unverified', populated: 0, total: 0, note }]),
  );
}

function absentFields(
  names: readonly string[],
  note: string,
): Readonly<Record<string, HighlightlyFieldAssessment>> {
  return Object.fromEntries(
    names.map((name) => [name, { state: 'absent', populated: 0, total: 0, note }]),
  );
}

function isCompletedMatch(match: HighlightlyMatch): boolean {
  const status = observedStatus(match).toLowerCase();
  return status === 'finished' || status === 'final';
}

function observedStatus(match: HighlightlyMatch): string {
  return match.state.description ?? match.state.report ?? 'Unknown';
}

function classifySeasonType(round: string | null | undefined): 'PRE' | 'REG' | 'POST' | 'OTHER' {
  const value = round?.toLowerCase() ?? '';
  if (value.includes('preseason') || value.includes('pre-season')) return 'PRE';
  if (
    value.includes('postseason') ||
    value.includes('playoff') ||
    value.includes('wild card') ||
    value.includes('divisional') ||
    value.includes('conference championship') ||
    value.includes('super bowl')
  )
    return 'POST';
  if (value.includes('regular')) return 'REG';
  return 'OTHER';
}

function normalizeName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

export function serializeHighlightlyEvaluationReport(
  report: HighlightlyEvaluationResult,
  forbiddenSecrets: readonly string[] = [],
): string {
  const findings = report.summary.findings
    .map((finding) => `- **${finding.level.toUpperCase()} - ${finding.code}:** ${finding.message}`)
    .join('\n');
  const content = `# Highlightly NFL provider evaluation\n\nGenerated: ${report.documentation.evaluatedAt}\n\nOfficial documentation: ${report.documentation.documentationUrl} (version ${report.documentation.version}, OpenAPI ${report.documentation.openApiVersion})\n\nThis report contains sanitized aggregates and limited team identifiers only. It contains no raw payloads, account identifiers, credentials, or authorization headers.\n\n## Findings\n\n${findings}\n\n## Final recommendation\n\n${report.finalRecommendation}\n\n## Structured evidence\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
  assertCredentialSafeText(content, forbiddenSecrets);
  return content;
}

export async function writeHighlightlyEvaluationReport(
  report: HighlightlyEvaluationResult,
  outputPath: string,
  forbiddenSecrets: readonly string[] = [],
): Promise<void> {
  await writeFile(
    outputPath,
    serializeHighlightlyEvaluationReport(report, forbiddenSecrets),
    'utf8',
  );
}

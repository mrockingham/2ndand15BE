import type { z } from 'zod';

import type { SportsConfig } from '../../../../config/env.js';
import {
  type GameQuery,
  type GameStatus,
  type NormalizedGame,
  normalizedGameSchema,
  type SeasonType,
} from '../../normalized-game.js';
import { type NormalizedTeam, normalizedTeamSchema } from '../../normalized-team.js';
import type {
  ProviderRecordFailure,
  SportsDataBatch,
  SportsDataProvider,
} from '../../sports-data-provider.js';
import { mockNflTeamsFixture } from '../mock/nfl-teams.fixture.js';
import { ApiSportsError } from './api-sports-error.js';
import type { ApiSportsHttpClient } from './api-sports-http-client.js';
import {
  type ApiSportsGame,
  type ApiSportsTeam,
  apiSportsEnvelopeSchema,
  apiSportsGameSchema,
  apiSportsTeamSchema,
} from './api-sports-schemas.js';

export const API_SPORTS_PROVIDER_KEY = 'api-sports';
const API_SPORTS_NFL_LEAGUE_ID = 1;

const statusMap = {
  NS: 'SCHEDULED',
  TBD: 'SCHEDULED',
  PREG: 'PREGAME',
  Q1: 'IN_PROGRESS',
  Q2: 'IN_PROGRESS',
  HT: 'HALFTIME',
  Q3: 'IN_PROGRESS',
  Q4: 'IN_PROGRESS',
  OT: 'IN_PROGRESS',
  BT: 'IN_PROGRESS',
  P: 'IN_PROGRESS',
  FT: 'FINAL',
  AOT: 'FINAL',
  POST: 'POSTPONED',
  CANC: 'CANCELED',
  SUSP: 'SUSPENDED',
  INT: 'SUSPENDED',
} as const satisfies Readonly<Record<string, GameStatus>>;

export interface ApiSportsDataProviderOptions {
  readonly config: SportsConfig['apiSports'];
  readonly client: ApiSportsHttpClient;
}

export class ApiSportsDataProvider implements SportsDataProvider {
  private readonly config: SportsConfig['apiSports'];
  private readonly client: ApiSportsHttpClient;

  constructor(options: ApiSportsDataProviderOptions) {
    this.config = options.config;
    this.client = options.client;
  }

  async getTeams(): Promise<SportsDataBatch<NormalizedTeam>> {
    const envelope = parseEnvelope(
      await this.client.get('teams', {
        league: API_SPORTS_NFL_LEAGUE_ID,
        season: this.config.syncSeason,
      }),
    );
    throwForProviderErrors(envelope.errors);

    const records: NormalizedTeam[] = [];
    const failures: ProviderRecordFailure[] = [];
    const seenCanonicalTeams = new Set<string>();

    for (const rawRecord of envelope.response) {
      const parsed = apiSportsTeamSchema.safeParse(rawRecord);
      if (!parsed.success) {
        failures.push(invalidRecordFailure(rawRecord, parsed.error));
        continue;
      }

      const canonical = findCanonicalTeam(parsed.data);
      if (canonical === undefined) continue;
      if (seenCanonicalTeams.has(canonical.abbreviation)) {
        failures.push({
          providerRecordId: String(parsed.data.id),
          reason: `Duplicate NFL catalog match for ${canonical.abbreviation}.`,
        });
        continue;
      }

      seenCanonicalTeams.add(canonical.abbreviation);
      records.push(
        normalizedTeamSchema.parse({
          ...canonical,
          provider: API_SPORTS_PROVIDER_KEY,
          providerTeamId: String(parsed.data.id),
          logoUrl: this.config.storeLogoUrls ? parsed.data.logo : null,
          logoSource: this.config.storeLogoUrls && parsed.data.logo !== null ? 'API-Sports' : null,
        }),
      );
    }

    return {
      provider: API_SPORTS_PROVIDER_KEY,
      received: envelope.results,
      records,
      failures,
    };
  }

  async getGames(query: GameQuery): Promise<SportsDataBatch<NormalizedGame>> {
    const season = query.season ?? this.config.syncSeason;
    const envelope = parseEnvelope(
      await this.client.get('games', {
        league: API_SPORTS_NFL_LEAGUE_ID,
        season,
        team: query.teamId,
        date:
          query.startDate !== undefined && query.startDate === query.endDate
            ? query.startDate.slice(0, 10)
            : undefined,
      }),
    );
    throwForProviderErrors(envelope.errors);

    return normalizeGameEnvelope(envelope, query, this.config.syncSeasonType);
  }

  async getGameByProviderId(providerGameId: string): Promise<NormalizedGame | null> {
    const envelope = parseEnvelope(await this.client.get('games', { id: providerGameId }));
    throwForProviderErrors(envelope.errors);
    const batch = normalizeGameEnvelope(envelope, {}, null);
    return batch.records.at(0) ?? null;
  }
}

export function mapApiSportsStatus(status: string): GameStatus | null {
  const mapping = statusMap as Partial<Record<string, GameStatus>>;
  return mapping[status] ?? null;
}

export function normalizeApiSportsGame(record: ApiSportsGame): NormalizedGame | null {
  if (record.league.id !== API_SPORTS_NFL_LEAGUE_ID || record.league.name !== 'NFL') return null;

  const status = mapApiSportsStatus(record.game.status.short);
  const seasonType = mapSeasonType(record.game.stage);
  if (status === null || seasonType === null) return null;

  const startTime = new Date(record.game.date.timestamp * 1_000);
  if (Number.isNaN(startTime.getTime())) return null;

  const bothScoresPresent = record.scores.home.total !== null && record.scores.away.total !== null;
  return normalizedGameSchema.parse({
    provider: API_SPORTS_PROVIDER_KEY,
    providerGameId: String(record.game.id),
    league: 'NFL',
    season: Number(record.league.season),
    seasonType,
    week: parseWeek(record.game.week),
    startTime: startTime.toISOString(),
    status,
    homeProviderTeamId: String(record.teams.home.id),
    awayProviderTeamId: String(record.teams.away.id),
    homeScore: bothScoresPresent ? record.scores.home.total : null,
    awayScore: bothScoresPresent ? record.scores.away.total : null,
    quarter: mapQuarter(record.game.status.short),
    clock: record.game.status.timer === null ? null : String(record.game.status.timer).slice(0, 16),
    venueName: record.game.venue.name,
    venueCity: record.game.venue.city,
    broadcastNetwork: null,
    isNeutralSite: false,
    providerLastUpdatedAt: null,
  });
}

function normalizeGameEnvelope(
  envelope: z.infer<typeof apiSportsEnvelopeSchema>,
  query: GameQuery,
  configuredSeasonType: SeasonType | null,
): SportsDataBatch<NormalizedGame> {
  const records: NormalizedGame[] = [];
  const failures: ProviderRecordFailure[] = [];
  const requestedSeasonType = query.seasonType ?? configuredSeasonType ?? undefined;

  for (const rawRecord of envelope.response) {
    const parsed = apiSportsGameSchema.safeParse(rawRecord);
    if (!parsed.success) {
      failures.push(invalidRecordFailure(rawRecord, parsed.error));
      continue;
    }

    const normalized = normalizeApiSportsGame(parsed.data);
    if (normalized === null) {
      failures.push({
        providerRecordId: String(parsed.data.game.id),
        reason: `Unsupported NFL stage or status (${parsed.data.game.stage}/${parsed.data.game.status.short}).`,
      });
      continue;
    }

    if (matchesGameQuery(normalized, query, requestedSeasonType)) records.push(normalized);
  }

  return {
    provider: API_SPORTS_PROVIDER_KEY,
    received: envelope.results,
    records,
    failures,
  };
}

function matchesGameQuery(
  game: NormalizedGame,
  query: GameQuery,
  seasonType: SeasonType | undefined,
): boolean {
  return (
    (seasonType === undefined || game.seasonType === seasonType) &&
    (query.week === undefined || game.week === query.week) &&
    (query.startDate === undefined || game.startTime >= query.startDate) &&
    (query.endDate === undefined || game.startTime <= query.endDate) &&
    (query.status === undefined || game.status === query.status)
  );
}

function mapSeasonType(stage: string): SeasonType | null {
  if (stage === 'Pre Season') return 'PRE';
  if (stage === 'Regular Season') return 'REG';
  if (stage === 'Post Season') return 'POST';
  return null;
}

function mapQuarter(status: string): number | null {
  if (status === 'Q1') return 1;
  if (status === 'Q2' || status === 'HT') return 2;
  if (status === 'Q3') return 3;
  if (status === 'Q4') return 4;
  if (status === 'OT' || status === 'AOT') return 5;
  return null;
}

function parseWeek(value: string | null): number | null {
  if (value === null) return null;
  const match = /\b(\d{1,2})\b/.exec(value);
  if (match?.[1] === undefined) return null;
  const week = Number(match[1]);
  return week >= 1 && week <= 22 ? week : null;
}

function findCanonicalTeam(team: ApiSportsTeam): NormalizedTeam | undefined {
  const code = team.code?.toUpperCase();
  const byCode = mockNflTeamsFixture.find((candidate) => candidate.abbreviation === code);
  if (byCode !== undefined) return byCode;

  const normalizedName = normalizeName(team.name);
  return mockNflTeamsFixture.find(
    (candidate) => normalizeName(candidate.fullName) === normalizedName,
  );
}

function normalizeName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function parseEnvelope(payload: unknown): z.infer<typeof apiSportsEnvelopeSchema> {
  const result = apiSportsEnvelopeSchema.safeParse(payload);
  if (!result.success) {
    throw new ApiSportsError({
      code: 'INVALID_RESPONSE',
      message: 'API-Sports response envelope failed validation.',
      cause: result.error,
    });
  }
  return result.data;
}

function throwForProviderErrors(errors: z.infer<typeof apiSportsEnvelopeSchema>['errors']): void {
  const keys = Array.isArray(errors)
    ? errors.length === 0
      ? []
      : ['provider']
    : Object.keys(errors);
  if (keys.length === 0) return;

  const quotaOrPlanError = keys.some((key) => /plan|limit|quota|request/i.test(key));
  throw new ApiSportsError({
    code: quotaOrPlanError ? 'QUOTA_EXHAUSTED' : 'PROVIDER_RESPONSE_ERROR',
    message: quotaOrPlanError
      ? 'API-Sports quota or plan access was exhausted.'
      : `API-Sports reported an error (${keys.join(', ')}).`,
  });
}

function invalidRecordFailure(rawRecord: unknown, error: z.ZodError): ProviderRecordFailure {
  const issuePath = error.issues[0]?.path.join('.');
  return {
    providerRecordId: extractProviderRecordId(rawRecord),
    reason: `Provider record failed validation: ${issuePath === undefined || issuePath === '' ? 'record' : issuePath}.`,
  };
}

function extractProviderRecordId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  if ('id' in value && (typeof value.id === 'number' || typeof value.id === 'string')) {
    return String(value.id);
  }
  if (
    'game' in value &&
    typeof value.game === 'object' &&
    value.game !== null &&
    'id' in value.game
  ) {
    const id = value.game.id;
    if (typeof id === 'number' || typeof id === 'string') return String(id);
  }
  return null;
}

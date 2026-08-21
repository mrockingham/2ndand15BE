import {
  highlightlyMatchSchema,
  highlightlyRawMatchListResponseSchema,
  type HighlightlyMatch,
} from '../../evaluation/highlightly/highlightly-schemas.js';
import type { HighlightlyEvaluationHttpClient } from '../../evaluation/highlightly/highlightly-http-client.js';
import type {
  CurrentGameBatch,
  CurrentGameFetchQuery,
  CurrentGameProvider,
} from '../../current-game-provider.js';
import {
  type GameStatus,
  type NormalizedGame,
  normalizedGameSchema,
  type SeasonType,
} from '../../normalized-game.js';
import type { ProviderRecordFailure } from '../../sports-data-provider.js';

export const HIGHLIGHTLY_PROVIDER_KEY = 'highlightly';
const MAX_CURRENT_SEASON_RECORDS = 100;

export class HighlightlyCurrentGameProvider implements CurrentGameProvider {
  readonly providerKey = HIGHLIGHTLY_PROVIDER_KEY;

  constructor(private readonly client: HighlightlyEvaluationHttpClient) {}

  async getCurrentGames(query: CurrentGameFetchQuery): Promise<CurrentGameBatch> {
    const startedAt = performance.now();
    const payload = await this.client.get(
      '/matches',
      {
        league: 'NFL',
        season: query.season,
        limit: MAX_CURRENT_SEASON_RECORDS,
        offset: 0,
        timezone: 'Etc/UTC',
      },
      highlightlyRawMatchListResponseSchema,
    );
    if (payload.pagination.totalCount > MAX_CURRENT_SEASON_RECORDS) {
      throw new Error('Highlightly current-game response exceeded the bounded one-page limit.');
    }

    const normalizationStarted = performance.now();
    const records: NormalizedGame[] = [];
    const failures: ProviderRecordFailure[] = [];
    for (const candidate of payload.data) {
      const parsed = highlightlyMatchSchema.safeParse(candidate);
      if (!parsed.success) {
        failures.push({ providerRecordId: null, reason: 'Provider record failed validation.' });
        continue;
      }
      const kickoff = new Date(parsed.data.date);
      if (kickoff < query.startTime || kickoff > query.endTime) continue;
      const normalized = normalizeHighlightlyCurrentGame(parsed.data);
      if (normalized === null) {
        failures.push({
          providerRecordId: String(parsed.data.id),
          reason: 'Provider record has an unsupported status, round, or score state.',
        });
        continue;
      }
      records.push(normalized);
    }

    return {
      provider: HIGHLIGHTLY_PROVIDER_KEY,
      received: payload.data.length,
      records,
      failures,
      requestsUsed: this.client.getRequestCount(),
      responseDurationMs: Math.round(performance.now() - startedAt),
      normalizationDurationMs: Math.round(performance.now() - normalizationStarted),
    };
  }
}

export function normalizeHighlightlyCurrentGame(match: HighlightlyMatch): NormalizedGame | null {
  if (match.league.toUpperCase() !== 'NFL') return null;
  const status = mapHighlightlyStatus(match.state.description ?? match.state.report ?? '');
  const seasonType = mapHighlightlySeasonType(match.round);
  if (status === null || seasonType === null) return null;

  let score = parseHighlightlyScore(match.state.score?.current ?? null);
  if (status === 'SCHEDULED' || status === 'PREGAME') {
    if (score?.home === 0 && score.away === 0) score = null;
    else if (score !== null) return null;
  } else if (status === 'FINAL' && score === null) return null;

  return normalizedGameSchema.parse({
    provider: HIGHLIGHTLY_PROVIDER_KEY,
    providerGameId: String(match.id),
    league: 'NFL',
    season: match.season,
    seasonType,
    week: parseWeek(match.round),
    startTime: match.date,
    status,
    homeProviderTeamId: String(match.homeTeam.id),
    awayProviderTeamId: String(match.awayTeam.id),
    homeAbbreviation: match.homeTeam.abbreviation,
    awayAbbreviation: match.awayTeam.abbreviation,
    homeScore: score?.home ?? null,
    awayScore: score?.away ?? null,
    quarter: parseQuarter(match.state.period),
    clock:
      match.state.clock === undefined ||
      match.state.clock === null ||
      ((status === 'SCHEDULED' || status === 'PREGAME') && Number(match.state.clock) === 0)
        ? null
        : String(match.state.clock).slice(0, 16),
    venueName: null,
    venueCity: null,
    broadcastNetwork: null,
    isNeutralSite: false,
    providerLastUpdatedAt: null,
  });
}

export function mapHighlightlyStatus(value: string): GameStatus | null {
  const normalized = value.trim().toLowerCase().replaceAll(/[_-]+/g, ' ');
  if (['not started', 'scheduled'].includes(normalized)) return 'SCHEDULED';
  if (['pregame', 'pre game'].includes(normalized)) return 'PREGAME';
  if (
    [
      'in progress',
      'live',
      '1st quarter',
      '2nd quarter',
      '3rd quarter',
      '4th quarter',
      'overtime',
    ].includes(normalized)
  )
    return 'IN_PROGRESS';
  if (['halftime', 'half time'].includes(normalized)) return 'HALFTIME';
  if (['finished', 'final'].includes(normalized)) return 'FINAL';
  if (normalized === 'postponed') return 'POSTPONED';
  if (['canceled', 'cancelled'].includes(normalized)) return 'CANCELED';
  if (['suspended', 'interrupted'].includes(normalized)) return 'SUSPENDED';
  return null;
}

function mapHighlightlySeasonType(round: string | null | undefined): SeasonType | null {
  const normalized = round?.toLowerCase() ?? '';
  if (normalized.includes('preseason') || normalized.includes('pre season')) return 'PRE';
  if (normalized.includes('postseason') || normalized.includes('playoff')) return 'POST';
  if (normalized.includes('regular') || /week\s*\d+/.test(normalized)) return 'REG';
  return null;
}

function parseWeek(round: string | null | undefined): number | null {
  const match = /(?:week|round)\s*(\d{1,2})/i.exec(round ?? '');
  if (match?.[1] === undefined) return null;
  const week = Number(match[1]);
  return week >= 1 && week <= 22 ? week : null;
}

function parseHighlightlyScore(value: string | null): { home: number; away: number } | null {
  if (value === null) return null;
  const match = /^\s*(\d+)\s*[-:]\s*(\d+)\s*$/.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return { home: Number(match[1]), away: Number(match[2]) };
}

function parseQuarter(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const quarter = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(quarter) && quarter >= 1 && quarter <= 10 ? quarter : null;
}

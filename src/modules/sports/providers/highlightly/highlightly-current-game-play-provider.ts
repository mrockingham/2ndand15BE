import type {
  CurrentGamePlayBatch,
  CurrentGamePlayProvider,
  NormalizedCurrentGamePlay,
  NormalizedCurrentGamePlaySnapshot,
} from '../../current-game-play-provider.js';
import type { HighlightlyEvaluationHttpClient } from '../../evaluation/highlightly/highlightly-http-client.js';
import {
  highlightlyDetailedMatchSchema,
  highlightlyRawMatchDetailResponseSchema,
  type HighlightlyDetailedMatch,
  type HighlightlyPlayDetail,
} from '../../evaluation/highlightly/highlightly-schemas.js';
import { HIGHLIGHTLY_PROVIDER_KEY } from './highlightly-current-game-provider.js';

export class HighlightlyCurrentGamePlayProvider implements CurrentGamePlayProvider {
  readonly providerKey = HIGHLIGHTLY_PROVIDER_KEY;

  constructor(private readonly client: HighlightlyEvaluationHttpClient) {}

  async getGamePlays(providerGameId: string): Promise<CurrentGamePlayBatch> {
    const requestCountBefore = this.client.getRequestCount();
    const startedAt = performance.now();
    const payload = await this.client.get(
      `/matches/${providerGameId}`,
      {},
      highlightlyRawMatchDetailResponseSchema,
    );
    const responseDurationMs = performance.now() - startedAt;
    const parsed = highlightlyDetailedMatchSchema.safeParse(payload[0]);
    if (!parsed.success || String(parsed.data.id) !== providerGameId) {
      return {
        provider: HIGHLIGHTLY_PROVIDER_KEY,
        record: null,
        failures: [{ providerRecordId: providerGameId, reason: 'Play detail failed validation.' }],
        requestsUsed: this.client.getRequestCount() - requestCountBefore,
        responseDurationMs: Math.round(responseDurationMs),
        normalizationDurationMs: 0,
      };
    }
    const normalizationStarted = performance.now();
    const record = normalizeHighlightlyCurrentGamePlays(parsed.data, providerGameId);
    return {
      provider: HIGHLIGHTLY_PROVIDER_KEY,
      record,
      failures: [],
      requestsUsed: this.client.getRequestCount() - requestCountBefore,
      responseDurationMs: Math.round(responseDurationMs),
      normalizationDurationMs: Math.round(performance.now() - normalizationStarted),
    };
  }
}

export function normalizeHighlightlyCurrentGamePlays(
  detail: HighlightlyDetailedMatch,
  expectedProviderGameId = String(detail.id),
): NormalizedCurrentGamePlaySnapshot {
  if (String(detail.id) !== expectedProviderGameId) throw new Error('Provider game ID mismatch.');
  const normalizedEvents = (detail.events ?? []).map((event) => {
    const plays = (event.playDetails ?? []).map((play) =>
      normalizePlay(play, 0, event.team === null ? null : event.team),
    );
    return { signature: eventSignature(event, plays), plays };
  });
  const seenEvents = new Set<string>();
  const uniqueEvents: typeof normalizedEvents = [];
  for (let index = normalizedEvents.length - 1; index >= 0; index -= 1) {
    const event = normalizedEvents[index];
    if (event === undefined || seenEvents.has(event.signature)) continue;
    seenEvents.add(event.signature);
    uniqueEvents.unshift(event);
  }
  const plays = uniqueEvents
    .flatMap((event) => event.plays)
    .map((play, providerOrder) => ({ ...play, providerOrder }));
  return {
    provider: HIGHLIGHTLY_PROVIDER_KEY,
    providerGameId: expectedProviderGameId,
    homeProviderTeamId: String(detail.homeTeam.id),
    awayProviderTeamId: String(detail.awayTeam.id),
    homeAbbreviation: detail.homeTeam.abbreviation.toUpperCase(),
    awayAbbreviation: detail.awayTeam.abbreviation.toUpperCase(),
    plays,
    providerUpdatedAt: detail.updatedAt ?? null,
  };
}

function eventSignature(
  event: NonNullable<HighlightlyDetailedMatch['events']>[number],
  plays: readonly NormalizedCurrentGamePlay[],
): string {
  return JSON.stringify([
    event.team === null || event.team === undefined ? null : String(event.team.id),
    event.description ?? null,
    event.result ?? null,
    plays.map(({ providerOrder: _providerOrder, ...play }) => {
      void _providerOrder;
      return play;
    }),
  ]);
}

function normalizePlay(
  play: HighlightlyPlayDetail,
  providerOrder: number,
  eventTeam: HighlightlyDetailedMatch['homeTeam'] | null | undefined,
): NormalizedCurrentGamePlay {
  const startYardLine = normalizeYardLine(play.start.yardsToEndzone);
  const endYardLine = normalizeYardLine(play.end.yardsToEndzone);
  const sourcePlayType = play.type.trim();
  return {
    providerOrder,
    period: play.period,
    clock: normalizeClock(play.clock),
    possessionProviderTeamId:
      eventTeam === null || eventTeam === undefined ? null : String(eventTeam.id),
    playType: normalizePlayType(sourcePlayType),
    sourcePlayType,
    description: normalizeDescription(play.text),
    startDown: normalizeDown(play.start.down),
    startDistance: normalizeDistance(play.start.distance),
    startYardLine,
    endDown: normalizeDown(play.end.down),
    endDistance: normalizeDistance(play.end.distance),
    endYardLine,
    isScoringPlay: isScoringType(sourcePlayType),
    isPenalty: play.isPenalty,
    isTurnover: isTurnoverType(sourcePlayType),
    fieldPositionFailure:
      (play.start.yardsToEndzone !== null &&
        play.start.yardsToEndzone !== undefined &&
        startYardLine === null) ||
      (play.end.yardsToEndzone !== null &&
        play.end.yardsToEndzone !== undefined &&
        endYardLine === null),
  };
}

export function normalizeHighlightlyPlayType(value: string): NormalizedCurrentGamePlay['playType'] {
  return normalizePlayType(value);
}

function normalizePlayType(value: string): NormalizedCurrentGamePlay['playType'] {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'kickoff') return 'KICKOFF';
  if (normalized === 'punt' || normalized === 'punt return touchdown') return 'PUNT';
  if (normalized === 'sack') return 'SACK';
  if (normalized === 'penalty') return 'PENALTY';
  if (normalized === 'field goal good' || normalized === 'field goal no good') return 'FIELD_GOAL';
  if (normalized.includes('interception')) return 'INTERCEPTION';
  if (normalized.includes('fumble recovery')) return 'FUMBLE';
  if (normalized === 'rush' || normalized === 'rushing touchdown') return 'RUSH';
  if (normalized.startsWith('pass')) return 'PASS';
  if (['timeout', 'official timeout', 'two-minute warning'].includes(normalized)) return 'TIMEOUT';
  if (['end period', 'end of half', 'end of game'].includes(normalized)) return 'END_PERIOD';
  return 'OTHER';
}

function normalizeClock(value: string): string {
  const normalized = value.trim();
  if (!/^\d{1,2}:\d{2}$/.test(normalized)) throw new Error('Invalid play clock.');
  const [minutesText, secondsText] = normalized.split(':');
  if (minutesText === undefined || secondsText === undefined || Number(secondsText) > 59) {
    throw new Error('Invalid play clock.');
  }
  return `${String(Number(minutesText))}:${secondsText}`;
}

function normalizeDescription(value: string): string {
  return value.trim().replaceAll(/\s+/g, ' ');
}

function normalizeDown(value: number | null | undefined): number | null {
  return Number.isInteger(value) &&
    value !== null &&
    value !== undefined &&
    value >= 1 &&
    value <= 4
    ? value
    : null;
}

function normalizeDistance(value: number | null | undefined): number | null {
  return Number.isInteger(value) &&
    value !== null &&
    value !== undefined &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}

export function normalizeHighlightlyYardLine(value: number | null | undefined): number | null {
  return normalizeYardLine(value);
}

function normalizeYardLine(yardsToEndzone: number | null | undefined): number | null {
  return Number.isInteger(yardsToEndzone) &&
    yardsToEndzone !== null &&
    yardsToEndzone !== undefined &&
    yardsToEndzone >= 0 &&
    yardsToEndzone <= 100
    ? 100 - yardsToEndzone
    : null;
}

function isScoringType(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.endsWith('touchdown') || normalized === 'field goal good';
}

function isTurnoverType(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.includes('interception') || normalized.includes('opp fumble recovery');
}

import type { SeasonType } from '../../../../generated/prisma/client.js';
import type { NormalizedStanding, StandingProvider } from '../../../standings/standings.types.js';
import type { HighlightlyEvaluationHttpClient } from '../../evaluation/highlightly/highlightly-http-client.js';
import { highlightlyStandingsResponseSchema } from '../../evaluation/highlightly/highlightly-schemas.js';

export class HighlightlyStandingsProvider implements StandingProvider {
  readonly providerKey = 'highlightly';

  constructor(private readonly client: HighlightlyEvaluationHttpClient) {}

  async getStandings(query: {
    readonly season: number;
    readonly seasonType: SeasonType;
  }): Promise<readonly NormalizedStanding[]> {
    if (query.seasonType === 'POST') {
      throw new Error('Highlightly does not publish postseason standings.');
    }
    const response = await this.client.get(
      'standings',
      { leagueType: 'NFL', year: query.season, limit: 10, offset: 0 },
      highlightlyStandingsResponseSchema,
    );
    const providerSeasonType = query.seasonType === 'PRE' ? 'Preseason' : 'Regular Season';
    const candidates = response.data.filter(
      (group) =>
        group.leagueType === 'NFL' &&
        group.year === query.season &&
        group.seasonType === providerSeasonType,
    );
    const selected = (['AFC', 'NFC'] as const).map((conference) => {
      const matches = candidates.filter((group) => group.abbreviation === conference);
      if (matches.length === 0) throw new Error(`Highlightly returned no ${conference} standings.`);
      return matches.reduce((best, candidate) =>
        recordedGames(candidate.data) >= recordedGames(best.data) ? candidate : best,
      );
    });
    const records = selected.flatMap((group, conferenceIndex) =>
      group.data.map((row, index) =>
        normalizeRow(row, {
          season: query.season,
          seasonType: query.seasonType,
          conference: group.abbreviation,
          conferenceRank: index + 1,
          providerOrder: conferenceIndex * 100 + index,
        }),
      ),
    );
    if (records.length !== 32 || new Set(records.map((row) => row.providerTeamId)).size !== 32) {
      throw new Error(
        `Highlightly standings must contain 32 unique NFL teams; received ${String(records.length)}.`,
      );
    }
    return records;
  }
}

type RawRow =
  (typeof highlightlyStandingsResponseSchema)['_output']['data'][number]['data'][number];

function normalizeRow(
  row: RawRow,
  identity: Pick<
    NormalizedStanding,
    'season' | 'seasonType' | 'conference' | 'conferenceRank' | 'providerOrder'
  >,
): NormalizedStanding {
  const values = new Map(row.statistics.map((item) => [item.displayName, item.value]));
  const home = parseRecord(values.get('Home Record'));
  const away = parseRecord(values.get('Road Record'));
  const division = parseRecord(values.get('Versus Division') ?? values.get('Division Record'));
  const conference = parseRecord(values.get('Versus Conference'));
  const streak = parseStreak(values.get('Streak'));
  return {
    provider: 'highlightly',
    providerTeamId: String(row.team.id),
    teamAbbreviation: canonicalAbbreviation(row.team.abbreviation),
    ...identity,
    playoffSeed: positiveInteger(values.get('Playoff Seed')),
    wins: nonnegativeInteger(values.get('Wins')),
    losses: nonnegativeInteger(values.get('Losses')),
    ties: nonnegativeInteger(values.get('Ties')),
    winPercentage: percentage(values.get('Win Percentage')),
    homeWins: home?.wins ?? null,
    homeLosses: home?.losses ?? null,
    homeTies: home?.ties ?? null,
    awayWins: away?.wins ?? null,
    awayLosses: away?.losses ?? null,
    awayTies: away?.ties ?? null,
    divisionWins: division?.wins ?? null,
    divisionLosses: division?.losses ?? null,
    divisionTies: division?.ties ?? null,
    conferenceWins: conference?.wins ?? null,
    conferenceLosses: conference?.losses ?? null,
    conferenceTies: conference?.ties ?? null,
    pointsFor: nonnegativeInteger(values.get('Points For')),
    pointsAgainst: nonnegativeInteger(values.get('Points Against')),
    pointDifferential: integer(values.get('Point Differential') ?? values.get('Differential')),
    ...streak,
  };
}

function canonicalAbbreviation(value: string): string {
  const abbreviation = value.toUpperCase();
  return abbreviation === 'WSH' ? 'WAS' : abbreviation;
}

function recordedGames(rows: readonly RawRow[]): number {
  return rows.reduce((total, row) => {
    const values = new Map(row.statistics.map((item) => [item.displayName, item.value]));
    return (
      total +
      (nonnegativeInteger(values.get('Wins')) ?? 0) +
      (nonnegativeInteger(values.get('Losses')) ?? 0) +
      (nonnegativeInteger(values.get('Ties')) ?? 0)
    );
  }, 0);
}

function parseRecord(value: unknown): { wins: number; losses: number; ties: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)-(\d+)(?:-(\d+))?$/.exec(value.trim());
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return { wins: Number(match[1]), losses: Number(match[2]), ties: Number(match[3] ?? 0) };
}

function parseStreak(
  value: unknown,
): Pick<NormalizedStanding, 'streakType' | 'streakLength' | 'streakDisplay'> {
  if (typeof value !== 'string')
    return { streakType: null, streakLength: null, streakDisplay: null };
  const display = value.trim().toUpperCase();
  const match = /^([WLT])(\d+)$/.exec(display);
  return match?.[1] === undefined || match[2] === undefined
    ? { streakType: null, streakLength: null, streakDisplay: null }
    : {
        streakType: match[1] as 'W' | 'L' | 'T',
        streakLength: Number(match[2]),
        streakDisplay: display,
      };
}

function integer(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) ? parsed : null;
}
function nonnegativeInteger(value: unknown): number | null {
  const parsed = integer(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}
function positiveInteger(value: unknown): number | null {
  const parsed = integer(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}
function percentage(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

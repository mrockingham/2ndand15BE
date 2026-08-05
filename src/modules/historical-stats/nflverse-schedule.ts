import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { canonicalTeamAbbreviation } from './historical-normalization.js';

const REQUIRED_COLUMNS = [
  'game_id',
  'season',
  'game_type',
  'week',
  'gameday',
  'away_team',
  'away_score',
  'home_team',
  'home_score',
  'stadium',
] as const;

const scheduleRowSchema = z.object({
  game_id: z.string().regex(/^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/),
  season: z.coerce.number().int().min(2020).max(2025),
  game_type: z.enum(['REG', 'WC', 'DIV', 'CON', 'SB']),
  week: z.coerce.number().int().min(1).max(22),
  gameday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  away_team: z.string().min(2).max(3),
  away_score: z.string(),
  home_team: z.string().min(2).max(3),
  home_score: z.string(),
  stadium: z.string(),
});

export interface HistoricalScheduleRow {
  readonly providerGameId: string;
  readonly season: number;
  readonly seasonType: 'REG' | 'POST';
  readonly week: number;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly status: 'FINAL' | 'SCHEDULED';
  readonly venueName: string | null;
}

export interface HistoricalScheduleParseResult {
  readonly rows: readonly HistoricalScheduleRow[];
  readonly sourceColumns: readonly string[];
  readonly unknownColumns: readonly string[];
}

export async function readNflverseSchedule(
  path: string,
  seasons: ReadonlySet<number>,
): Promise<HistoricalScheduleParseResult> {
  const records = parseCsvRecords(await readFile(path, 'utf8'));
  const header = records.shift();
  if (header === undefined) throw new Error('nflverse schedule CSV is empty.');
  const indexes = new Map(header.map((column, index) => [column, index]));
  const missing = REQUIRED_COLUMNS.filter((column) => !indexes.has(column));
  if (missing.length > 0)
    throw new Error(`nflverse schedule is missing required columns: ${missing.join(', ')}.`);
  const rows: HistoricalScheduleRow[] = [];
  const identities = new Set<string>();
  for (const record of records) {
    const object = Object.fromEntries(header.map((column, index) => [column, record[index] ?? '']));
    const season = Number(object.season);
    if (!seasons.has(season)) continue;
    const parsed = scheduleRowSchema.parse(object);
    if (identities.has(parsed.game_id))
      throw new Error(`Duplicate nflverse game ID ${parsed.game_id}.`);
    identities.add(parsed.game_id);
    const homeTeam = canonicalTeamAbbreviation(parsed.home_team);
    const awayTeam = canonicalTeamAbbreviation(parsed.away_team);
    if (homeTeam === null || awayTeam === null)
      throw new Error(`Game ${parsed.game_id} has a non-team participant.`);
    const homeScore = parseScore(parsed.home_score);
    const awayScore = parseScore(parsed.away_score);
    rows.push({
      providerGameId: parsed.game_id,
      season: parsed.season,
      seasonType: parsed.game_type === 'REG' ? 'REG' : 'POST',
      week: parsed.week,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      status: homeScore === null || awayScore === null ? 'SCHEDULED' : 'FINAL',
      venueName: parsed.stadium.trim() || null,
    });
  }
  return { rows, sourceColumns: header, unknownColumns: [] };
}

function parseScore(value: string): number | null {
  if (value.trim() === '') return null;
  const score = Number(value);
  if (!Number.isInteger(score) || score < 0 || score > 100)
    throw new Error(`Invalid historical score ${value}.`);
  return score;
}

export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((entry) => entry.length > 0)) records.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('nflverse schedule contains an unterminated quoted field.');
  row.push(field.replace(/\r$/, ''));
  if (row.some((entry) => entry.length > 0)) records.push(row);
  return records;
}

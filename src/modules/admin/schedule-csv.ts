import { readFile, stat } from 'node:fs/promises';

import { AppError } from '../../common/errors/app-error.js';
import { scheduleImportRowSchema, type ScheduleImportRow } from './admin.schemas.js';

export const MAX_SCHEDULE_IMPORT_BYTES = 1_048_576;
export const MAX_SCHEDULE_IMPORT_ROWS = 500;
export const MAX_SCHEDULE_IMPORT_ROW_CHARACTERS = 16_384;

export const SCHEDULE_IMPORT_COLUMNS = [
  'season',
  'seasonType',
  'week',
  'startTime',
  'awayTeam',
  'homeTeam',
  'status',
  'venueName',
  'venueCity',
  'broadcastNetwork',
  'isNeutralSite',
  'sourceName',
  'sourceType',
  'sourceUrl',
  'externalReference',
  'notes',
] as const;

export async function readScheduleImportFile(
  filePath: string,
): Promise<readonly ScheduleImportRow[]> {
  const metadata = await stat(filePath);
  if (!metadata.isFile())
    throw importError('IMPORT_FILE_INVALID', 'The import path must identify a file.');
  if (metadata.size > MAX_SCHEDULE_IMPORT_BYTES) {
    throw importError(
      'IMPORT_FILE_TOO_LARGE',
      `Schedule imports may not exceed ${String(MAX_SCHEDULE_IMPORT_BYTES)} bytes.`,
    );
  }
  return parseScheduleCsv(await readFile(filePath, 'utf8'));
}

export function parseScheduleCsv(text: string): readonly ScheduleImportRow[] {
  if (Buffer.byteLength(text, 'utf8') > MAX_SCHEDULE_IMPORT_BYTES) {
    throw importError(
      'IMPORT_FILE_TOO_LARGE',
      `Schedule imports may not exceed ${String(MAX_SCHEDULE_IMPORT_BYTES)} bytes.`,
    );
  }
  const records = parseCsvRecords(text.replace(/^\uFEFF/, ''));
  const header = records.shift();
  if (header === undefined || !sameColumns(header, SCHEDULE_IMPORT_COLUMNS)) {
    throw importError(
      'IMPORT_HEADER_INVALID',
      `The CSV header must exactly match: ${SCHEDULE_IMPORT_COLUMNS.join(',')}.`,
    );
  }
  if (records.length === 0)
    throw importError('IMPORT_EMPTY', 'The schedule import has no data rows.');
  if (records.length > MAX_SCHEDULE_IMPORT_ROWS) {
    throw importError(
      'IMPORT_ROW_LIMIT_EXCEEDED',
      `Schedule imports may contain at most ${String(MAX_SCHEDULE_IMPORT_ROWS)} rows.`,
    );
  }

  const rows: ScheduleImportRow[] = [];
  const issues: { row: number; field: string; message: string }[] = [];
  for (const [index, record] of records.entries()) {
    const rowNumber = index + 2;
    if (record.length !== SCHEDULE_IMPORT_COLUMNS.length) {
      issues.push({
        row: rowNumber,
        field: 'row',
        message: 'Column count does not match the header.',
      });
      continue;
    }
    const candidate = toCandidate(record);
    const parsed = scheduleImportRowSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({ row: rowNumber, field: issue.path.join('.'), message: issue.message });
      }
      continue;
    }
    rows.push(parsed.data);
  }
  if (issues.length > 0) {
    throw new AppError({
      code: 'SCHEDULE_IMPORT_INVALID',
      message: 'One or more schedule rows are invalid.',
      statusCode: 400,
      details: issues,
    });
  }
  return rows;
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let rowCharacters = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';
    rowCharacters += 1;
    if (rowCharacters > MAX_SCHEDULE_IMPORT_ROW_CHARACTERS) {
      throw importError(
        'IMPORT_ROW_TOO_LARGE',
        `A CSV row exceeds ${String(MAX_SCHEDULE_IMPORT_ROW_CHARACTERS)} characters.`,
      );
    }
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"' && field.length === 0) quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value.length > 0)) records.push(row);
      row = [];
      field = '';
      rowCharacters = 0;
    } else field += character;
  }
  if (quoted)
    throw importError('IMPORT_CSV_INVALID', 'The CSV contains an unterminated quoted field.');
  row.push(field.replace(/\r$/, ''));
  if (row.some((value) => value.length > 0)) records.push(row);
  return records;
}

function toCandidate(record: readonly string[]): unknown {
  const value = (index: number): string => record[index]?.trim() ?? '';
  const nullable = (index: number): string | null => value(index) || null;
  const week = value(2);
  const neutral = value(10).toLowerCase();
  return {
    season: Number(value(0)),
    seasonType: value(1).toUpperCase(),
    week: week === '' ? null : Number(week),
    startTime: value(3),
    awayTeam: value(4),
    homeTeam: value(5),
    status: value(6).toUpperCase(),
    venueName: nullable(7),
    venueCity: nullable(8),
    broadcastNetwork: nullable(9),
    isNeutralSite: neutral === 'true' ? true : neutral === 'false' ? false : neutral,
    sourceName: value(11),
    sourceType: value(12).toUpperCase(),
    sourceUrl: nullable(13),
    externalReference: nullable(14),
    notes: nullable(15),
  };
}

function sameColumns(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value.trim() === expected[index])
  );
}

function importError(code: string, message: string): AppError {
  return new AppError({ code, message, statusCode: 400 });
}

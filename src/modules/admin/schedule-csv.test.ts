/* Vitest asymmetric error matchers carry intentionally dynamic values. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it } from 'vitest';

import {
  MAX_SCHEDULE_IMPORT_BYTES,
  MAX_SCHEDULE_IMPORT_ROW_CHARACTERS,
  parseScheduleCsv,
  SCHEDULE_IMPORT_COLUMNS,
} from './schedule-csv.js';

const header = SCHEDULE_IMPORT_COLUMNS.join(',');
const validRow =
  '2026,REG,1,2026-09-10T00:20:00Z,MIA,BUF,SCHEDULED,"Example Stadium",Buffalo,NBC,false,Official schedule,OFFICIAL_WEB,https://example.com/schedule,official-1,Verified fact';

describe('schedule CSV parsing', () => {
  it('parses the exact committed format with explicit UTC timestamps', () => {
    expect(parseScheduleCsv(`${header}\n${validRow}\n`)).toEqual([
      expect.objectContaining({
        season: 2026,
        seasonType: 'REG',
        awayTeam: 'MIA',
        homeTeam: 'BUF',
      }),
    ]);
  });

  it('preserves an explicit TBD kickoff without fabricating a timestamp', () => {
    const row = validRow.replace('2026-09-10T00:20:00Z', 'TBD');
    expect(parseScheduleCsv(`${header}\n${row}\n`)[0]?.startTime).toBe('TBD');
  });

  it('accepts a null week for the preseason Hall of Fame Game', () => {
    const row = validRow.replace(',REG,1,', ',PRE,,').replace(',MIA,BUF,', ',CAR,ARI,');
    expect(parseScheduleCsv(`${header}\n${row}\n`)[0]).toMatchObject({
      seasonType: 'PRE',
      week: null,
      awayTeam: 'CAR',
      homeTeam: 'ARI',
    });
  });

  it.each<[string, string]>([
    [validRow.replace('2026-09-10T00:20:00Z', '2026-09-10T00:20:00'), 'startTime'],
    [validRow.replace(',REG,', ',INVALID,'), 'seasonType'],
    [validRow.replace(',SCHEDULED,', ',UNKNOWN,'), 'status'],
    [validRow.replace(',MIA,BUF,', ',BUF,BUF,'), 'awayTeam'],
  ])('rejects invalid row content', (row, field) => {
    expect(() => parseScheduleCsv(`${header}\n${row}\n`)).toThrow(
      expect.objectContaining({
        code: 'SCHEDULE_IMPORT_INVALID',
        details: expect.arrayContaining([expect.objectContaining({ field })]),
      }),
    );
  });

  it('enforces file and individual-row size safeguards', () => {
    expect(() => parseScheduleCsv('x'.repeat(MAX_SCHEDULE_IMPORT_BYTES + 1))).toThrow(
      expect.objectContaining({ code: 'IMPORT_FILE_TOO_LARGE' }),
    );
    expect(() =>
      parseScheduleCsv(`${header}\n${'x'.repeat(MAX_SCHEDULE_IMPORT_ROW_CHARACTERS + 1)}`),
    ).toThrow(expect.objectContaining({ code: 'IMPORT_ROW_TOO_LARGE' }));
  });
});

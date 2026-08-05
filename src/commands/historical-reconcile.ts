import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createPrismaClient } from '../common/database/prisma.js';
import { loadDatabaseConfig } from '../config/env.js';
import { compareSummaryValues } from '../modules/historical-stats/historical-reconciliation.js';
import { readParquetBatches, verifyLocalFile } from '../modules/historical-stats/parquet-reader.js';

const SUMMARY_FIELDS = [
  ['games', 'games'],
  ['completions', 'completions'],
  ['attempts', 'attempts'],
  ['passing_yards', 'passingYards'],
  ['passing_tds', 'passingTouchdowns'],
  ['passing_interceptions', 'passingInterceptions'],
  ['carries', 'carries'],
  ['rushing_yards', 'rushingYards'],
  ['rushing_tds', 'rushingTouchdowns'],
  ['targets', 'targets'],
  ['receptions', 'receptions'],
  ['receiving_yards', 'receivingYards'],
  ['receiving_tds', 'receivingTouchdowns'],
  ['def_tackles_solo', 'tacklesSolo'],
  ['def_tackle_assists', 'tackleAssists'],
  ['def_sacks', 'defensiveSacks'],
  ['def_interceptions', 'defensiveInterceptions'],
  ['def_fumbles_forced', 'forcedFumbles'],
  ['def_tds', 'defensiveTouchdowns'],
  ['fg_made', 'fieldGoalsMade'],
  ['fg_att', 'fieldGoalsAttempted'],
  ['pat_made', 'extraPointsMade'],
  ['pat_att', 'extraPointsAttempted'],
  ['pt_att', 'punts'],
  ['pt_yards', 'puntYards'],
  ['fantasy_points', 'fantasyPointsStandard'],
  ['fantasy_points_ppr', 'fantasyPointsPpr'],
] as const;

const SUMMARY_FILES = {
  2020: {
    sha256: 'eaa25a7648f0c8b883677faf1e757d115b2c8c32ea2ce91557db6507b0892dd3',
    bytes: 284598,
  },
  2021: {
    sha256: 'e1659e1d2eeb0c2f1b0583dafec1407397e69966ef3d904e1ae689bd5a2bcd73',
    bytes: 294327,
  },
  2022: {
    sha256: '3cbcffcf0da25f0bcd3b0e506e2e1e6770e0543ac24ae614a5f87521bb35619d',
    bytes: 286786,
  },
  2023: {
    sha256: '8287a3312aa5012cd6f977bd16ab369ecd61ad175c3227c8a7aff78999ed4d62',
    bytes: 279558,
  },
  2024: {
    sha256: 'ab4693ce8efdabc578ce36f0aaa9922371e5427717517a1b9673736dfbd0c35b',
    bytes: 285081,
  },
  2025: {
    sha256: 'ff2daebd760c2479d42d2f6982b84bb8746cd1106f8f38022a059a75e2ae97f2',
    bytes: 284698,
  },
} as const;

const { values } = parseArgs({
  options: {
    seasons: { type: 'string', default: '2020-2025' },
    input: { type: 'string', default: './data/nflverse/season-summaries' },
    report: { type: 'string' },
  },
});
const seasons = parseSeasons(values.seasons);
const prisma = createPrismaClient(loadDatabaseConfig().databaseUrl);
try {
  const identifiers = await prisma.playerExternalIdentifier.findMany({
    where: { provider: 'GSIS' },
    select: { externalId: true, playerId: true },
  });
  const players = new Map(identifiers.map((row) => [row.externalId, row.playerId]));
  const reports = [];
  for (const season of seasons) {
    const metadata = SUMMARY_FILES[season];
    const path = resolve(values.input, `stats_player_reg_${String(season)}.parquet`);
    await verifyLocalFile(path, metadata.bytes, metadata.sha256);
    const localRows = await prisma.playerSeasonStat.findMany({
      where: { season, summaryType: 'REG' },
    });
    const local = new Map(localRows.map((row) => [row.playerId, row]));
    const comparedPlayers = new Set<string>();
    const fieldMismatches: Record<string, number> = {};
    const samples: {
      playerId: string;
      field: string;
      source: number | null;
      local: number | null;
    }[] = [];
    let sourceRows = 0;
    let unidentifiableSourceRows = 0;
    let missingPlayerMappings = 0;
    let missingLocalSummaries = 0;
    for await (const batch of readParquetBatches(path, [
      'player_id',
      'season',
      ...SUMMARY_FIELDS.map(([source]) => source),
    ])) {
      for (const sourceRow of batch) {
        sourceRows += 1;
        if (sourceRow.season !== season) throw new Error(`Wrong season in ${path}.`);
        const externalId = sourceRow.player_id;
        if (typeof externalId !== 'string' || externalId === '') {
          unidentifiableSourceRows += 1;
          continue;
        }
        const playerId = players.get(externalId);
        if (playerId === undefined) {
          missingPlayerMappings += 1;
          continue;
        }
        const summary = local.get(playerId);
        if (summary === undefined) {
          missingLocalSummaries += 1;
          continue;
        }
        comparedPlayers.add(playerId);
        for (const [sourceField, internalField] of SUMMARY_FIELDS) {
          const sourceValue = numericOrNull(sourceRow[sourceField]);
          const localValue = summary[internalField];
          if (!compareSummaryValues(sourceValue, localValue)) {
            fieldMismatches[sourceField] = (fieldMismatches[sourceField] ?? 0) + 1;
            if (samples.length < 20)
              samples.push({
                playerId,
                field: sourceField,
                source: sourceValue,
                local: localValue,
              });
          }
        }
      }
    }
    const localOnlySummaries = localRows.filter((row) => !comparedPlayers.has(row.playerId)).length;
    const mismatchCount = Object.values(fieldMismatches).reduce((sum, count) => sum + count, 0);
    reports.push({
      season,
      status:
        unidentifiableSourceRows + missingPlayerMappings + missingLocalSummaries + mismatchCount ===
        0
          ? 'PASS'
          : 'WARNING',
      sourceRows,
      localRows: localRows.length,
      comparedPlayers: comparedPlayers.size,
      unidentifiableSourceRows,
      missingPlayerMappings,
      missingLocalSummaries,
      localOnlySummaries,
      mismatchCount,
      fieldMismatches,
      samples,
      source: {
        url: `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${String(season)}.parquet`,
        sha256: metadata.sha256,
        fileSizeBytes: metadata.bytes,
      },
    });
  }
  const result = {
    status: reports.every((report) => report.status === 'PASS') ? 'PASS' : 'WARNING',
    comparison: 'Locally derived REG summaries versus nflverse stats_player regular-season files',
    fields: SUMMARY_FIELDS.map(([source, internal]) => ({ source, internal })),
    seasons: reports,
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values.report !== undefined) {
    await mkdir(dirname(values.report), { recursive: true });
    await writeFile(values.report, json, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(json);
} finally {
  await prisma.$disconnect();
}

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Season-summary value must be a finite number or null.');
  return value;
}

function parseSeasons(value: string): (keyof typeof SUMMARY_FILES)[] {
  const match = /^(202[0-5])(?:-(202[0-5]))?$/.exec(value);
  if (match === null) throw new Error('--seasons must be one season or a 2020-2025 range.');
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (end < start) throw new Error('--seasons range must be ascending.');
  return Array.from(
    { length: end - start + 1 },
    (_, index) => (start + index) as keyof typeof SUMMARY_FILES,
  );
}

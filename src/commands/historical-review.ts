import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

import { createPrismaClient } from '../common/database/prisma.js';
import { loadDatabaseConfig } from '../config/env.js';
import { HistoricalImportService } from '../modules/historical-stats/historical-import.service.js';
import {
  loadHistoricalManifest,
  selectHistoricalSeason,
} from '../modules/historical-stats/historical-manifest.js';
import { PrismaHistoricalImportRepository } from '../modules/historical-stats/historical.repository.js';

const { values } = parseArgs({
  options: {
    manifest: { type: 'string', default: './data/nflverse/manifests/nflverse-2025-pilot.json' },
    report: { type: 'string' },
    season: { type: 'string' },
    'skip-players': { type: 'boolean', default: false },
  },
});
const config = loadDatabaseConfig();
const prisma = createPrismaClient(config.databaseUrl);
try {
  const manifest = await loadHistoricalManifest(values.manifest);
  const season = parseOptionalSeason(values.season);
  const loaded =
    season === null ? manifest : selectHistoricalSeason(manifest, season, !values['skip-players']);
  const report = await new HistoricalImportService(
    new PrismaHistoricalImportRepository(prisma),
  ).review(loaded);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (values.report !== undefined) {
    await mkdir(dirname(values.report), { recursive: true });
    await writeFile(values.report, json, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(json);
  if (report.status === 'FAIL') process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

function parseOptionalSeason(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^202[0-5]$/.test(value)) throw new Error('--season must be between 2020 and 2025.');
  return Number(value);
}

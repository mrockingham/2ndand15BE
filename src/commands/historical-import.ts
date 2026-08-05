import 'dotenv/config';

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
    write: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'max-growth-mb': { type: 'string', default: '500' },
    actor: { type: 'string', default: 'historical-import-cli' },
    season: { type: 'string' },
    'skip-players': { type: 'boolean', default: false },
  },
});
if (values.write && values['dry-run'])
  throw new Error('Use either --write or --dry-run, not both.');
const maxGrowthMb = Number(values['max-growth-mb']);
if (!Number.isFinite(maxGrowthMb) || maxGrowthMb <= 0 || maxGrowthMb > 10_000)
  throw new Error('--max-growth-mb must be between 1 and 10000.');
const config = loadDatabaseConfig();
const prisma = createPrismaClient(config.databaseUrl);
try {
  const manifest = await loadHistoricalManifest(values.manifest);
  const season = parseOptionalSeason(values.season);
  const loaded =
    season === null ? manifest : selectHistoricalSeason(manifest, season, !values['skip-players']);
  const result = await new HistoricalImportService(
    new PrismaHistoricalImportRepository(prisma),
  ).execute(loaded, {
    write: values.write,
    initiatedBy: values.actor,
    maxGrowthBytes: Math.floor(maxGrowthMb * 1024 * 1024),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await prisma.$disconnect();
}

function parseOptionalSeason(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^202[0-5]$/.test(value)) throw new Error('--season must be between 2020 and 2025.');
  return Number(value);
}

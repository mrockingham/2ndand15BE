import { readFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute, relative } from 'node:path';

import { z } from 'zod';

export const HISTORICAL_SEASONS = [2020, 2021, 2022, 2023, 2024, 2025] as const;

const manifestFileSchema = z.object({
  dataset: z.enum(['PLAYERS', 'WEEKLY_ROSTERS', 'PLAYER_STATS', 'SCHEDULES']),
  season: z.number().int().min(2020).max(2025).nullable(),
  sourceUrl: z
    .url()
    .refine((value) => new URL(value).protocol === 'https:', 'Source URL must use HTTPS.'),
  releaseId: z.string().min(1).max(96),
  expectedFilename: z
    .string()
    .regex(/^[A-Za-z0-9._/-]+$/)
    .max(240),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  fileSizeBytes: z.number().int().positive().max(250_000_000),
  downloadedAt: z.iso.datetime(),
  schemaVersion: z.string().min(1).max(64),
  mappingVersion: z.string().min(1).max(64),
  importStatus: z.enum(['NOT_IMPORTED', 'DRY_RUN_PASSED', 'IMPORTED']),
});

export const historicalManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    attribution: z.string().min(1).max(500),
    license: z.literal('CC BY 4.0'),
    files: z.array(manifestFileSchema).min(1).max(32),
  })
  .superRefine((manifest, context) => {
    const identities = new Set<string>();
    for (const [index, file] of manifest.files.entries()) {
      const key = `${file.dataset}:${String(file.season)}`;
      if (identities.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['files', index],
          message: `Duplicate dataset/season entry ${key}.`,
        });
      }
      identities.add(key);
      if (file.dataset === 'PLAYERS' && file.season !== null) {
        context.addIssue({
          code: 'custom',
          path: ['files', index, 'season'],
          message: 'PLAYERS season must be null.',
        });
      }
      if (file.dataset !== 'PLAYERS' && file.season === null) {
        context.addIssue({
          code: 'custom',
          path: ['files', index, 'season'],
          message: 'Season is required for season-scoped datasets.',
        });
      }
    }
  });

export type HistoricalManifest = z.output<typeof historicalManifestSchema>;
export type HistoricalManifestFile = HistoricalManifest['files'][number];

export interface LoadedHistoricalManifest {
  readonly manifest: HistoricalManifest;
  readonly manifestPath: string;
  readonly baseDirectory: string;
}

export async function loadHistoricalManifest(path: string): Promise<LoadedHistoricalManifest> {
  const manifestPath = resolve(path);
  const parsed = historicalManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  return { manifest: parsed, manifestPath, baseDirectory: resolve(dirname(manifestPath), '..') };
}

export function selectHistoricalSeason(
  loaded: LoadedHistoricalManifest,
  season: number,
  includePlayers: boolean,
): LoadedHistoricalManifest {
  if (!HISTORICAL_SEASONS.includes(season as (typeof HISTORICAL_SEASONS)[number])) {
    throw new Error('Historical season must be between 2020 and 2025.');
  }
  const files = loaded.manifest.files.filter(
    (file) => file.season === season || (includePlayers && file.dataset === 'PLAYERS'),
  );
  if (files.length === 0) throw new Error(`Manifest has no files for season ${String(season)}.`);
  return { ...loaded, manifest: { ...loaded.manifest, files } };
}

export function resolveManifestFilePath(
  loaded: LoadedHistoricalManifest,
  file: HistoricalManifestFile,
): string {
  const absolute = resolve(loaded.baseDirectory, file.expectedFilename);
  const relativePath = relative(loaded.baseDirectory, absolute);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Manifest file path escapes its manifest directory.');
  }
  return absolute;
}

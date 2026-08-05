import { describe, expect, it } from 'vitest';
import {
  historicalManifestSchema,
  resolveManifestFilePath,
  selectHistoricalSeason,
} from './historical-manifest.js';

const file = {
  dataset: 'PLAYER_STATS',
  season: 2025,
  sourceUrl:
    'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2025.parquet',
  releaseId: 'stats_player',
  expectedFilename: '../player-stats/stats_player_week_2025.parquet',
  sha256: 'a'.repeat(64),
  fileSizeBytes: 10,
  downloadedAt: '2026-08-03T00:00:00.000Z',
  schemaVersion: 'v1',
  mappingVersion: 'v1',
  importStatus: 'NOT_IMPORTED',
} as const;

describe('historical manifest', () => {
  it('accepts a bounded season-scoped nflverse manifest', () => {
    expect(
      historicalManifestSchema.parse({
        manifestVersion: 1,
        attribution: 'nflverse contributors',
        license: 'CC BY 4.0',
        files: [file],
      }).files,
    ).toHaveLength(1);
  });
  it('rejects a missing season and malformed checksum', () => {
    expect(
      historicalManifestSchema.safeParse({
        manifestVersion: 1,
        attribution: 'nflverse contributors',
        license: 'CC BY 4.0',
        files: [{ ...file, season: null, sha256: 'bad' }],
      }).success,
    ).toBe(false);
  });
  it('rejects duplicate dataset-season identities', () => {
    expect(
      historicalManifestSchema.safeParse({
        manifestVersion: 1,
        attribution: 'nflverse contributors',
        license: 'CC BY 4.0',
        files: [file, file],
      }).success,
    ).toBe(false);
  });
  it('selects one season and can omit the shared player snapshot', () => {
    const manifest = historicalManifestSchema.parse({
      manifestVersion: 1,
      attribution: 'nflverse contributors',
      license: 'CC BY 4.0',
      files: [
        file,
        { ...file, dataset: 'WEEKLY_ROSTERS', season: 2024 },
        { ...file, dataset: 'PLAYERS', season: null },
      ],
    });
    const selected = selectHistoricalSeason(
      { manifest, manifestPath: 'manifest.json', baseDirectory: '.' },
      2024,
      false,
    );
    expect(selected.manifest.files.map((entry) => entry.dataset)).toEqual(['WEEKLY_ROSTERS']);
  });

  it('rejects a manifest path that escapes the approved data directory', () => {
    const manifest = historicalManifestSchema.parse({
      manifestVersion: 1,
      attribution: 'nflverse contributors',
      license: 'CC BY 4.0',
      files: [file],
    });
    const manifestFile = manifest.files[0];
    expect(manifestFile).toBeDefined();
    if (manifestFile === undefined) throw new Error('Expected a manifest file fixture.');
    expect(() =>
      resolveManifestFilePath(
        { manifest, manifestPath: 'manifest.json', baseDirectory: 'C:/safe/data' },
        manifestFile,
      ),
    ).toThrow(/escapes/);
  });
});

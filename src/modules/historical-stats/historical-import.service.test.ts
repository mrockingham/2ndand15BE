import { describe, expect, it, vi } from 'vitest';

import type { HistoricalImportRepository } from './historical.repository.js';
import {
  HistoricalImportService,
  type HistoricalReviewReport,
} from './historical-import.service.js';
import type { LoadedHistoricalManifest } from './historical-manifest.js';

function repository(): HistoricalImportRepository {
  return {
    loadLookupState: vi.fn(),
    upsertSchedules: vi.fn(),
    upsertPlayers: vi.fn(),
    upsertRosters: vi.fn(),
    upsertPlayerStats: vi.fn(),
    rebuildSeasonSummaries: vi.fn(),
    measureDatabase: vi.fn().mockResolvedValue({ databaseBytes: 100n, relations: [] }),
    beginImport: vi.fn(),
    beginImportFile: vi.fn(),
    finishImportFile: vi.fn(),
    finishImport: vi.fn(),
  };
}

const loaded = {
  manifestPath: 'manifest.json',
  baseDirectory: '.',
  manifest: {
    manifestVersion: 1,
    attribution: 'nflverse contributors',
    license: 'CC BY 4.0',
    files: [
      {
        dataset: 'PLAYER_STATS',
        season: 2025,
        sourceUrl:
          'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2025.parquet',
        releaseId: 'stats_player',
        expectedFilename: 'player-stats/stats_player_week_2025.parquet',
        sha256: 'a'.repeat(64),
        fileSizeBytes: 100,
        downloadedAt: '2026-08-03T00:00:00.000Z',
        schemaVersion: 'v1',
        mappingVersion: 'v1',
        importStatus: 'NOT_IMPORTED',
      },
    ],
  },
} as const satisfies LoadedHistoricalManifest;

const passReview: HistoricalReviewReport = {
  status: 'PASS',
  files: [],
  totals: { sourceRows: 0, acceptedRows: 0, warnings: 0, failures: 0 },
};

describe('historical import safety gates', () => {
  it('returns a review-only result with no writes when write is false', async () => {
    const fake = repository();
    const service = new HistoricalImportService(fake);
    vi.spyOn(service, 'review').mockResolvedValue(passReview);
    const result = await service.execute(loaded, {
      write: false,
      initiatedBy: 'test',
      maxGrowthBytes: 1_000,
    });
    expect(result.writeStatus).toBe('NOT_REQUESTED');
  });

  it('stops before writes on review failure and excessive projected growth', async () => {
    const fake = repository();
    const service = new HistoricalImportService(fake);
    vi.spyOn(service, 'review').mockResolvedValueOnce({ ...passReview, status: 'FAIL' });
    await expect(
      service.execute(loaded, { write: true, initiatedBy: 'test', maxGrowthBytes: 1_000 }),
    ).rejects.toThrow(/review failed/);
    vi.spyOn(service, 'review').mockResolvedValueOnce(passReview);
    await expect(
      service.execute(loaded, { write: true, initiatedBy: 'test', maxGrowthBytes: 399 }),
    ).rejects.toThrow(/exceeds configured threshold/);
  });
});

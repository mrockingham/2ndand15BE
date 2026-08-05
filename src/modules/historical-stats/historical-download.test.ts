import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadHistoricalFile,
  validateInitialUrl,
  validateRedirectUrl,
} from './historical-download.js';

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('historical download allowlist', () => {
  it('accepts only the nflverse-data release path and supported file types', () => {
    expect(
      validateInitialUrl(
        'https://github.com/nflverse/nflverse-data/releases/download/players/players.parquet',
      ).hostname,
    ).toBe('github.com');
    expect(() =>
      validateInitialUrl('https://github.com/other/repo/releases/download/data/file.parquet'),
    ).toThrow(/Only HTTPS/);
    expect(() =>
      validateInitialUrl(
        'http://github.com/nflverse/nflverse-data/releases/download/players/players.parquet',
      ),
    ).toThrow(/Only HTTPS/);
    expect(() =>
      validateInitialUrl(
        'https://github.com/nflverse/nflverse-data/releases/download/players/file.zip',
      ),
    ).toThrow(/Parquet and CSV/);
  });
  it('rejects redirects outside GitHub release asset hosts', () => {
    expect(
      validateRedirectUrl(
        new URL('https://release-assets.githubusercontent.com/file?token=redacted'),
      ).hostname,
    ).toBe('release-assets.githubusercontent.com');
    expect(() => validateRedirectUrl(new URL('https://example.com/file.parquet'))).toThrow(
      /redirected outside/,
    );
  });

  it('streams a bounded file and computes its checksum', async () => {
    directory = await mkdtemp(join(tmpdir(), 'historical-download-'));
    const destination = join(directory, 'source.parquet');
    const response = new Response('parquet-bytes', { status: 200 });
    const result = await downloadHistoricalFile({
      url: 'https://github.com/nflverse/nflverse-data/releases/download/players/players.parquet',
      destination,
      maxBytes: 100,
      fetchImplementation: vi.fn().mockResolvedValue(response),
    });
    expect(await readFile(destination, 'utf8')).toBe('parquet-bytes');
    expect(result.fileSizeBytes).toBe(13);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a declared source larger than the configured limit', async () => {
    directory = await mkdtemp(join(tmpdir(), 'historical-download-'));
    const response = new Response('small', {
      status: 200,
      headers: { 'content-length': '101' },
    });
    await expect(
      downloadHistoricalFile({
        url: 'https://github.com/nflverse/nflverse-data/releases/download/players/players.parquet',
        destination: join(directory, 'source.parquet'),
        maxBytes: 100,
        fetchImplementation: vi.fn().mockResolvedValue(response),
      }),
    ).rejects.toThrow(/exceeds/);
  });
});

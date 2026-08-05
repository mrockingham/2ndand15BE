import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parquetWriteFile } from 'hyparquet-writer';
import { afterEach, describe, expect, it } from 'vitest';

import {
  detectSchemaDrift,
  inspectParquet,
  readParquetBatches,
  verifyLocalFile,
} from './parquet-reader.js';

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('Parquet reader and schema drift', () => {
  it('reads metadata and bounded batches from a synthetic Parquet file', async () => {
    directory = await mkdtemp(join(tmpdir(), 'historical-parquet-'));
    const path = join(directory, 'sample.parquet');
    parquetWriteFile({
      filename: path,
      columnData: [
        { name: 'player_id', data: ['00-0000001', '00-0000002'], type: 'STRING' },
        { name: 'season', data: [2025, 2025], type: 'INT32' },
        { name: 'new_column', data: [1, 2], type: 'INT32' },
      ],
    });
    const inspection = await inspectParquet(path);
    expect(inspection.rowCount).toBe(2);
    const drift = detectSchemaDrift(inspection, {
      approvedColumns: ['player_id', 'season'],
      requiredColumns: ['player_id'],
      expectedTypes: { player_id: 'BYTE_ARRAY', season: 'INT32' },
    });
    expect(drift.status).toBe('WARNING');
    expect(drift.unknownColumns).toEqual(['new_column']);
    const rows = [];
    for await (const batch of readParquetBatches(path, ['player_id'], 1)) rows.push(...batch);
    expect(rows).toEqual([{ player_id: '00-0000001' }, { player_id: '00-0000002' }]);
  });

  it('fails drift review when a required identity column disappears', () => {
    const drift = detectSchemaDrift(
      { rowCount: 0, columns: [] },
      { approvedColumns: ['player_id'], requiredColumns: ['player_id'] },
    );
    expect(drift.status).toBe('FAIL');
    expect(drift.missingRequiredColumns).toEqual(['player_id']);
  });

  it('fails drift review on an incompatible source type', () => {
    const drift = detectSchemaDrift(
      {
        rowCount: 1,
        columns: [{ name: 'player_id', physicalType: 'INT32', logicalType: null, nullable: false }],
      },
      {
        approvedColumns: ['player_id'],
        requiredColumns: ['player_id'],
        expectedTypes: { player_id: 'BYTE_ARRAY' },
      },
    );
    expect(drift.status).toBe('FAIL');
    expect(drift.incompatibleTypes).toHaveLength(1);
  });

  it('verifies exact file size and checksum', async () => {
    directory = await mkdtemp(join(tmpdir(), 'historical-checksum-'));
    const path = join(directory, 'source.parquet');
    const bytes = Buffer.from('synthetic-source');
    await writeFile(path, bytes);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    await expect(verifyLocalFile(path, bytes.length, checksum)).resolves.toBeUndefined();
    await expect(verifyLocalFile(path, bytes.length, '0'.repeat(64))).rejects.toThrow(/checksum/);
    await expect(verifyLocalFile(path, bytes.length + 1, checksum)).rejects.toThrow(/size/);
  });
});

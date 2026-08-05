import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import {
  asyncBufferFromFile,
  parquetMetadataAsync,
  parquetReadObjects,
  parquetSchema,
  type SchemaTree,
} from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

import type { SourcePhysicalType } from './nflverse-field-mappings.js';

export interface ParquetColumnSchema {
  readonly name: string;
  readonly physicalType: string;
  readonly logicalType: string | null;
  readonly nullable: boolean;
}

export interface ParquetInspection {
  readonly rowCount: number;
  readonly columns: readonly ParquetColumnSchema[];
}

export interface SchemaExpectation {
  readonly approvedColumns: readonly string[];
  readonly requiredColumns: readonly string[];
  readonly expectedTypes?: Readonly<Record<string, SourcePhysicalType>>;
}

export interface SchemaDriftReport {
  readonly status: 'PASS' | 'WARNING' | 'FAIL';
  readonly columns: readonly ParquetColumnSchema[];
  readonly missingRequiredColumns: readonly string[];
  readonly unknownColumns: readonly string[];
  readonly incompatibleTypes: readonly { column: string; expected: string; actual: string }[];
}

export async function inspectParquet(path: string): Promise<ParquetInspection> {
  const file = await asyncBufferFromFile(path);
  const metadata = await parquetMetadataAsync(file);
  const schema = parquetSchema(metadata);
  return {
    rowCount: Number(metadata.num_rows),
    columns: schema.children.map(toColumnSchema),
  };
}

export function detectSchemaDrift(
  inspection: ParquetInspection,
  expectation: SchemaExpectation,
): SchemaDriftReport {
  const actual = new Map(inspection.columns.map((column) => [column.name, column]));
  const approved = new Set(expectation.approvedColumns);
  const missingRequiredColumns = expectation.requiredColumns.filter(
    (column) => !actual.has(column),
  );
  const unknownColumns = inspection.columns
    .map((column) => column.name)
    .filter((column) => !approved.has(column));
  const incompatibleTypes = Object.entries(expectation.expectedTypes ?? {}).flatMap(
    ([column, expected]) => {
      const found = actual.get(column);
      return found !== undefined && found.physicalType !== expected
        ? [{ column, expected, actual: found.physicalType }]
        : [];
    },
  );
  const status =
    missingRequiredColumns.length > 0 || incompatibleTypes.length > 0
      ? 'FAIL'
      : unknownColumns.length > 0
        ? 'WARNING'
        : 'PASS';
  return {
    status,
    columns: inspection.columns,
    missingRequiredColumns,
    unknownColumns,
    incompatibleTypes,
  };
}

export async function* readParquetBatches(
  path: string,
  columns: readonly string[],
  batchSize = 1_000,
): AsyncGenerator<readonly Readonly<Record<string, unknown>>[]> {
  const file = await asyncBufferFromFile(path);
  const metadata = await parquetMetadataAsync(file);
  const rows = Number(metadata.num_rows);
  for (let rowStart = 0; rowStart < rows; rowStart += batchSize) {
    const rowEnd = Math.min(rows, rowStart + batchSize);
    const batch = await parquetReadObjects({
      file,
      metadata,
      compressors,
      columns: [...columns],
      rowStart,
      rowEnd,
    });
    yield batch as readonly Readonly<Record<string, unknown>>[];
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function verifyLocalFile(
  path: string,
  expectedSize: number,
  expectedChecksum: string,
): Promise<void> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`Historical source is not a file: ${path}`);
  if (metadata.size !== expectedSize) {
    throw new Error(
      `File-size mismatch for ${path}: expected ${String(expectedSize)}, received ${String(metadata.size)}.`,
    );
  }
  const checksum = await sha256File(path);
  if (checksum !== expectedChecksum) throw new Error(`SHA-256 mismatch for ${path}.`);
}

function toColumnSchema(tree: SchemaTree): ParquetColumnSchema {
  const logical = tree.element.logical_type;
  return {
    name: tree.element.name,
    physicalType: tree.element.type ?? 'GROUP',
    logicalType: tree.element.converted_type ?? (logical === undefined ? null : logical.type),
    nullable: tree.element.repetition_type !== 'REQUIRED',
  };
}

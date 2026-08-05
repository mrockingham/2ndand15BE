import { z } from 'zod';

import { AppError } from '../../common/errors/app-error.js';

const statsCursorSchema = z.object({
  version: z.literal(1),
  context: z.enum(['SEASON', 'WEEK']),
  metric: z.string().min(1).max(64),
  value: z.number(),
  games: z.number().int().nonnegative(),
  displayName: z.string().min(1).max(160),
  playerId: z.uuid(),
  rowId: z.uuid(),
});

export type StatsCursor = z.infer<typeof statsCursorSchema>;

export function encodeStatsCursor(cursor: StatsCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeStatsCursor(
  encoded: string,
  expected: Pick<StatsCursor, 'context' | 'metric'>,
): StatsCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const cursor = statsCursorSchema.parse(parsed);
    if (cursor.context !== expected.context || cursor.metric !== expected.metric)
      throw new Error('Cursor context does not match the request.');
    return cursor;
  } catch (error) {
    throw new AppError({
      code: 'STATS_INVALID_CURSOR',
      message: 'The Stats Hub cursor is invalid for this request.',
      statusCode: 400,
      cause: error,
    });
  }
}

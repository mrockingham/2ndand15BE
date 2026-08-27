import { z } from 'zod';

import { AppError } from '../../common/errors/app-error.js';
import type { TeamRosterQuery } from './team-hub.schemas.js';

const nullableFilter = z.string().nullable();
const teamRosterCursorSchema = z.object({
  version: z.literal(1),
  teamId: z.uuid(),
  season: z.number().int().min(1920).max(2100),
  position: nullableFilter,
  positionGroup: nullableFilter,
  search: nullableFilter,
  sortPositionGroup: z.string().min(1).max(24),
  sortPosition: z.string().min(1).max(24),
  normalizedName: z.string().min(1).max(160),
  playerId: z.uuid(),
});

export type TeamRosterCursor = z.infer<typeof teamRosterCursorSchema>;

export function encodeTeamRosterCursor(cursor: TeamRosterCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeTeamRosterCursor(
  encoded: string,
  teamId: string,
  query: TeamRosterQuery,
): TeamRosterCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const cursor = teamRosterCursorSchema.parse(parsed);
    if (
      cursor.teamId !== teamId ||
      cursor.season !== query.season ||
      cursor.position !== (query.position ?? null) ||
      cursor.positionGroup !== (query.positionGroup ?? null) ||
      cursor.search !== (query.search ?? null)
    ) {
      throw new Error('Cursor filters do not match the request.');
    }
    return cursor;
  } catch (error) {
    throw new AppError({
      code: 'TEAM_ROSTER_INVALID_CURSOR',
      message: 'The team roster cursor is invalid for this request.',
      statusCode: 400,
      cause: error,
    });
  }
}

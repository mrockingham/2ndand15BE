import { z } from 'zod';
import { gameStatusSchema, seasonTypeSchema } from '../sports/normalized-game.js';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const dateValueSchema = z
  .string()
  .refine(
    (value) =>
      (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) ||
      isoDateTimeSchema.safeParse(value).success,
    'Must be an ISO 8601 date or timestamp.',
  );
export const gameIdParamsSchema = z.object({ gameId: z.uuid() });
export const teamGamesParamsSchema = z.object({ teamId: z.uuid() });
export const gameListQuerySchema = z
  .object({
    season: z.coerce.number().int().min(1920).max(2100).optional(),
    seasonType: seasonTypeSchema.optional(),
    week: z.coerce.number().int().min(1).max(22).optional(),
    startDate: dateValueSchema.optional(),
    endDate: dateValueSchema.optional(),
    teamId: z.uuid().optional(),
    status: gameStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.uuid().optional(),
  })
  .superRefine((query, context) => {
    if ((query.startDate === undefined) !== (query.endDate === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'startDate and endDate must be provided together.',
        path: [query.startDate === undefined ? 'startDate' : 'endDate'],
      });
      return;
    }
    if (query.startDate === undefined || query.endDate === undefined) return;
    const start = parseDateBound(query.startDate, false);
    const end = parseDateBound(query.endDate, true);
    if (end < start)
      context.addIssue({
        code: 'custom',
        message: 'endDate must not precede startDate.',
        path: ['endDate'],
      });
    else if (end.getTime() - start.getTime() > 31 * 86_400_000)
      context.addIssue({
        code: 'custom',
        message: 'Date ranges may not exceed 31 days.',
        path: ['endDate'],
      });
  });
export type GameListQuery = z.infer<typeof gameListQuerySchema>;
export function parseDateBound(value: string, endOfDay: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return new Date(value);
}

import { z } from 'zod';

const cursor = z.uuid();
export const playerIdParamsSchema = z.object({ playerId: z.uuid() });
export const playerListQuerySchema = z.object({
  search: z.string().trim().min(2).max(100).optional(),
  teamId: z.uuid().optional(),
  position: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .transform((value) => value.toUpperCase())
    .optional(),
  season: z.coerce.number().int().min(2020).max(2025).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: cursor.optional(),
});
export const playerStatsQuerySchema = z.object({
  season: z.coerce.number().int().min(2020).max(2025).optional(),
  week: z.coerce.number().int().min(1).max(22).optional(),
  seasonType: z.enum(['PRE', 'REG', 'POST']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: cursor.optional(),
});

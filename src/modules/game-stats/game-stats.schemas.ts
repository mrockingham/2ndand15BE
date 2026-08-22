import { z } from 'zod';

import { seasonTypeSchema } from '../sports/normalized-game.js';

export const currentGameStatsListQuerySchema = z.object({
  season: z.coerce.number().int().min(1920).max(2100).optional(),
  seasonType: seasonTypeSchema.optional(),
  week: z.union([z.coerce.number().int().min(1).max(22), z.literal('ALL')]).optional(),
  teamId: z.uuid().optional(),
});

export type CurrentGameStatsListQuery = z.infer<typeof currentGameStatsListQuerySchema>;

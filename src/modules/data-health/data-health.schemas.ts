import { z } from 'zod';

import { gameStatusSchema, seasonTypeSchema } from '../sports/normalized-game.js';

export const dataHealthGameIdParamsSchema = z.object({ gameId: z.uuid() }).strict();

export const dataHealthGameListQuerySchema = z
  .object({
    season: z.coerce.number().int().min(1920).max(2100).optional(),
    seasonType: seasonTypeSchema.optional(),
    week: z.coerce.number().int().min(1).max(22).optional(),
    teamId: z.uuid().optional(),
    gameStatus: gameStatusSchema.optional(),
    issuesOnly: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.uuid().optional(),
  })
  .strict();

export const dataHealthProbeListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(20).default(20),
  })
  .strict();

export type DataHealthGameListQuery = z.infer<typeof dataHealthGameListQuerySchema>;
export type DataHealthProbeListQuery = z.infer<typeof dataHealthProbeListQuerySchema>;

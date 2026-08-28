import { z } from 'zod';
import { seasonTypeSchema } from '../sports/normalized-game.js';

export const standingsQuerySchema = z.object({
  season: z.coerce.number().int().min(1920).max(2100),
  seasonType: seasonTypeSchema,
  view: z.enum(['division', 'conference', 'league']).default('division'),
  conference: z.enum(['AFC', 'NFC']).optional(),
  division: z.enum(['East', 'North', 'South', 'West']).optional(),
  teamId: z.uuid().optional(),
});

export type StandingsQuery = z.infer<typeof standingsQuerySchema>;
